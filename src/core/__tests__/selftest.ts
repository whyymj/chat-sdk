/**
 * 自测脚本 —— 验证 SDK 核心逻辑(不依赖 LLM/浏览器)
 *
 * 覆盖:windowOps(范围控制/schema 校验/祖先读/序列化)、vfs、
 * todos/skills/permissions 中间件、middleware 执行器。
 *
 * 运行:npm test(esbuild bundle → node 跑)
 */
import { z } from 'zod'
import { createWindowOps } from '../tools/windowOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineWindowToolset } from '../toolsets'
import { createUsageHintsMiddleware } from '../harness/usageHints'
import { offloadLargeResult } from '../utils/offload'
import { createVfs, createVfsTools } from '../backends/vfs'
import { createTodosMiddleware } from '../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../harness/skills'
import { createPermissionsMiddleware } from '../harness/permissions'
import { createMemoryMiddleware } from '../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../harness/retry'
import { runPool } from '../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../harness/verify'
import { createApprovalMiddleware } from '../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../harness/checkpoint'
import { extractText } from '../mcp/client'
import { createInitialState as createState } from '../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../utils/modelCaps'
import { useContextManager } from '../composables/useContextManager'
import { resolveContextOptions } from '../sdk/contextPreset'
import { jpEval, searchJson } from '../tools/windowQuery'
import { createAgent, trimContextIfNeededImpl } from '../harness/createAgent'
import type { Middleware } from '../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
declare const process: { exit(code?: number): never }

// mock 宿主页面 window(windowOps 工具函数体的 window 解析到此)
;(globalThis as any).window = { app: { theme: 'light', count: 0 } }

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string): void {
  if (Boolean(cond)) {
    passed++
    console.log('  ✓', msg)
  } else {
    failed++
    console.error('  ✗ FAIL:', msg)
  }
}
async function invoke(tool: any, args: any): Promise<string> {
  return await tool.invoke(args)
}
const byName = (tools: any[]) => Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, any>

// ============ windowOps ============
console.log('\n[windowOps]')
{
  const tools = createWindowOps([
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
    { path: 'app.count', description: '计数', schema: z.number().int().min(0) },
  ])
  const t = byName(tools)
  const w = (globalThis as any).window

  let r = await invoke(t['set_window_prop'], { path: 'app.theme', value: '"dark"' })
  assert(w.app.theme === 'dark' && /已设置/.test(r), 'set 合法值生效 + 返回成功')

  r = await invoke(t['set_window_prop'], { path: 'app.theme', value: '"red"' })
  assert(/SCHEMA_INVALID/.test(r) && w.app.theme === 'dark', 'set 非法值被 schema 校验拦截(不写入,返回结构化错误码)')

  r = await invoke(t['set_window_prop'], { path: 'app.unknown', value: '1' })
  assert(/未在注册表中声明/.test(r), 'set 未注册属性被范围控制拒绝')

  // 字段白名单读模式(默认 true):仅注册 path 自身/后代可读,祖先(app)不可读
  r = await invoke(t['get_window_prop'], { path: 'app' })
  assert(/未注册|不可读|不暴露/.test(r), 'whitelist 默认:get 祖先路径(app)被拒(不暴露整体)')

  r = await invoke(t['get_window_prop'], { path: 'app.theme' })
  assert(/dark/.test(r), 'get 注册属性返回值')

  r = await invoke(t['get_window_prop'], { path: 'foo' })
  assert(/未注册/.test(r), 'get 未注册非祖先路径被拒')

  r = await invoke(t['list_window_props'], {})
  assert(/app\.theme/.test(r) && /app\.count/.test(r), 'list 列出全部注册属性')

  r = await invoke(t['set_window_prop'], { path: 'app.count', value: '5' })
  assert(w.app.count === 5, 'set count(integer)生效')

  r = await invoke(t['delete_window_prop'], { path: 'app.count' })
  assert(!('count' in w.app), 'delete 注册属性生效')

  r = await invoke(t['set_window_prop'], { path: 'app.count', value: '"not a number"' })
  assert(/SCHEMA_INVALID/.test(r), 'set 类型不符被校验拦截(结构化错误码)')
}

// ============ windowOps:edit + 快照 ============
console.log('\n[windowOps edit + snapshot]')
{
  const w = (globalThis as any).window
  // 扩展 mock window:加对象/数组容器(edit 仅作用于对象/数组)
  w.app.list = [{ id: 1, text: 'a' }, { id: 2, text: 'b' }]
  w.app.cfg = { a: 1, name: 'x' }

  const tools = createWindowOps([
    { path: 'app.cfg', description: '配置对象', schema: z.object({ a: z.number(), name: z.string(), extra: z.string().optional() }) },
    { path: 'app.list', description: '数组', schema: z.array(z.object({ id: z.number(), text: z.string() })) },
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
  ])
  const t = byName(tools)
  let r: string

  // edit set 子字段
  r = await invoke(t['edit_window_prop'], { path: 'app.cfg', op: 'set', jsonPath: 'a', value: '99' })
  assert(w.app.cfg.a === 99 && /已 edit/.test(r), 'edit set 子字段生效')

  // edit merge 合并
  r = await invoke(t['edit_window_prop'], { path: 'app.cfg', op: 'merge', value: '{"extra":"hi"}' })
  assert(w.app.cfg.extra === 'hi', 'edit merge 合并字段')

  // edit append 追加
  r = await invoke(t['edit_window_prop'], { path: 'app.list', op: 'append', value: '{"id":3,"text":"c"}' })
  assert(w.app.list.length === 3 && w.app.list[2].id === 3, 'edit append 追加元素')

  // edit remove 删字段
  r = await invoke(t['edit_window_prop'], { path: 'app.cfg', op: 'remove', jsonPath: 'extra' })
  assert(!('extra' in w.app.cfg), 'edit remove 删字段')

  // edit schema 失败 → live 不变(校验在副本,失败不入栈不落地)
  const beforeA = w.app.cfg.a
  r = await invoke(t['edit_window_prop'], { path: 'app.cfg', op: 'set', jsonPath: 'a', value: '"not a number"' })
  assert(/SCHEMA_INVALID/.test(r) && w.app.cfg.a === beforeA, 'edit 校验失败 live 未变(结构化错误码)')

  // edit 未注册拒绝
  r = await invoke(t['edit_window_prop'], { path: 'app.unknown', op: 'set', jsonPath: 'x', value: '1' })
  assert(/未在注册表中声明/.test(r), 'edit 未注册属性被拒')

  // edit 叶子属性拒绝(提示用 set_window_prop)
  r = await invoke(t['edit_window_prop'], { path: 'app.theme', op: 'set', jsonPath: 'x', value: '1' })
  assert(/仅适用于对象\/数组/.test(r), 'edit 叶子属性被拒')

  // 自动快照:set/edit 前自动入栈 → list 有记录
  r = await invoke(t['list_window_snapshots'], { path: 'app.cfg' })
  assert(/#1/.test(r) && /app\.cfg/.test(r), 'list_window_snapshots 列出自动快照')

  // 手动快照(命名检查点)
  r = await invoke(t['snapshot_window_prop'], { path: 'app.cfg', label: '检查点A' })
  assert(/检查点A/.test(r), 'snapshot_window_prop 手动快照')

  // restore 到 #1(初始 a=1),先破坏再回退
  w.app.cfg.a = 99999
  r = await invoke(t['restore_window_snapshot'], { path: 'app.cfg', id: 1 })
  assert(w.app.cfg.a === 1, 'restore_window_snapshot 回退到指定快照(初始 a=1)')

  // restore 不入栈:已有快照(含检查点A)保留
  r = await invoke(t['list_window_snapshots'], { path: 'app.cfg' })
  assert(/检查点A/.test(r), 'restore 不入栈(已有快照保留)')

  // get_window_prop 支持读后代子路径(精确读局部,而非整体)
  r = await invoke(t['get_window_prop'], { path: 'app.cfg.a' })
  assert(/app\.cfg\.a = 1/.test(r), 'get_window_prop 读后代子路径(局部)')

  // get_window_paths 批量读多路径
  r = await invoke(t['get_window_paths'], { paths: ['app.cfg.a', 'app.cfg.name', 'app.theme'] })
  assert(/app\.cfg\.a/.test(r) && /app\.cfg\.name/.test(r) && /app\.theme/.test(r), 'get_window_paths 批量读取多路径')

  // get_window_paths 未注册路径被拒并标记
  r = await invoke(t['get_window_paths'], { paths: ['app.unknown.x'] })
  assert(/未注册/.test(r), 'get_window_paths 未注册路径被拒并标记')

  // 清理 mock window 扩展字段,避免污染后续
  delete w.app.list
  delete w.app.cfg
}

// ============ windowOps:字段白名单读模式(子路径注册,LLM 不见完整 JSON)============
console.log('\n[windowOps whitelist]')
{
  // 模拟大 JSON:page 含很多字段,集成方只声明可操作的子路径
  ;(globalThis as any).window = {
    page: {
      title: '首页',
      secret: '不应暴露的内部数据',
      theme: { color: '#1f4d3a', mode: 'dark' },
      components: [
        { id: 1, type: 'card', price: 50, title: '卡片A', internal: 'x' },
        { id: 2, type: 'list', price: 200, title: '列表B', internal: 'y' },
      ],
    },
  }
  // 集成方只声明必要字段:叶子 + 数组(元素 schema 用 passthrough 只校验必要 key)
  const tools = createWindowOps([
    { path: 'page.title', description: '页面标题', schema: z.string() },
    { path: 'page.theme.color', description: '主题色', schema: z.string() },
    {
      path: 'page.components',
      description: '组件数组',
      schema: z.array(z.object({ id: z.number(), type: z.string(), price: z.number(), title: z.string() }).passthrough()),
    },
  ])
  const t = byName(tools)
  const w = (globalThis as any).window

  // list 只列声明字段(不含 secret/internal)
  let r = await invoke(t['list_window_props'], {})
  assert(/page\.title/.test(r) && /page\.theme\.color/.test(r) && /page\.components/.test(r), 'list 只列声明的可操作子路径')

  // get 声明叶子:可读
  r = await invoke(t['get_window_prop'], { path: 'page.theme.color' })
  assert(/1f4d3a/.test(r), 'whitelist: get 声明叶子可读')

  // get 后代(声明数组的元素字段):可读
  r = await invoke(t['get_window_prop'], { path: 'page.components.0.price' })
  assert(/50/.test(r), 'whitelist: get 声明数组的后代字段可读')

  // get 未声明的祖先(整个 page):被拒,不暴露 secret
  r = await invoke(t['get_window_prop'], { path: 'page' })
  assert(!/secret/.test(r) && /未注册|不可读|不暴露/.test(r), 'whitelist: get 未声明祖先(page)被拒,不暴露 secret')

  // get 未声明的兄弟字段(page.secret):被拒
  r = await invoke(t['get_window_prop'], { path: 'page.secret' })
  assert(/未注册|不可读/.test(r), 'whitelist: get 未声明字段(secret)被拒')

  // set 声明叶子:只写该叶子,只校验其 schema,不传完整 JSON
  r = await invoke(t['set_window_prop'], { path: 'page.theme.color', value: '"#000000"' })
  assert(w.page.theme.color === '#000000' && /已设置/.test(r), 'whitelist: set 声明叶子生效(只写叶子)')

  // edit 声明数组的元素字段:增量 patch,元素 schema 用 passthrough 放行 internal
  r = await invoke(t['edit_window_prop'], { path: 'page.components', op: 'set', jsonPath: '1.price', value: '180' })
  assert(w.page.components[1].price === 180 && w.page.components[1].internal === 'y', 'whitelist: edit 增量改元素字段,passthrough 保留未声明字段')

  // set 未声明字段:被拒
  r = await invoke(t['set_window_prop'], { path: 'page.secret', value: '"leaked"' })
  assert(/未在注册表中声明/.test(r) && w.page.secret === '不应暴露的内部数据', 'whitelist: set 未声明字段被拒(不泄露)')

  // whitelist:false 回退原行为:祖先读可用
  const toolsLegacy = createWindowOps(
    [{ path: 'page.title', description: '标题', schema: z.string() }],
    { whitelist: false },
  )
  const tLegacy = byName(toolsLegacy)
  r = await invoke(tLegacy['get_window_prop'], { path: 'page' })
  assert(/title/.test(r), 'whitelist:false → 祖先读回退可用(整体读)')
}

// ============ 工具报错机制(结构化 ERROR:{json},供 LLM 排查)============
console.log('\n[tool errors]')
{
  ;(globalThis as any).window = { app: { theme: 'dark', count: 5, cfg: { a: 1 } } }
  const tools = createWindowOps([
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
    { path: 'app.count', description: '计数', schema: z.number().int().min(0) },
    { path: 'app.cfg', description: '配置', schema: z.object({ a: z.number(), name: z.string().optional() }) },
  ])
  const t = byName(tools)

  // 未注册:结构化错误码 + hint
  let r = await invoke(t['set_window_prop'], { path: 'app.unknown', value: '1' })
  assert(/^ERROR: \{.*"error":\s*"NOT_REGISTERED"/.test(r), '未注册 → ERROR json 含 error=NOT_REGISTERED')
  assert(/"hint"/.test(r), '错误含 hint(可操作建议)')

  // schema 失败:details 含 zod issues(path/expected/received)
  r = await invoke(t['set_window_prop'], { path: 'app.count', value: '"x"' })
  assert(/"error":\s*"SCHEMA_INVALID"/.test(r), 'schema 失败 → error=SCHEMA_INVALID')
  const detailMatch = r.match(/"details":\s*(\[[^\]]*\])/)
  assert(detailMatch && /expected/.test(detailMatch[1]) && /received/.test(detailMatch[1]), 'schema 失败 details 含 zod issue 的 expected/received')

  // JSON 解析失败:带原解析错误 + 预览
  r = await invoke(t['set_window_prop'], { path: 'app.count', value: '{bad' })
  assert(/"error":\s*"JSON_PARSE"/.test(r) && /预览|bad/.test(r), 'JSON 解析失败 → error=JSON_PARSE + 预览')

  // edit 非对象:NOT_OBJECT + hint 指向 set
  r = await invoke(t['edit_window_prop'], { path: 'app.theme', op: 'set', jsonPath: 'x', value: '1' })
  assert(/"error":\s*"NOT_OBJECT"/.test(r) && /set_window_prop/.test(r), 'edit 叶子 → NOT_OBJECT + hint 指向 set_window_prop')

  // edit 不安全路径:PATH_UNSAFE
  r = await invoke(t['edit_window_prop'], { path: 'app.cfg', op: 'set', jsonPath: '__proto__.x', value: '1' })
  assert(/"error":\s*"PATH_UNSAFE"/.test(r), 'edit __proto__ → PATH_UNSAFE')

  // query 语法错误:JSONPATH_SYNTAX + details.expr
  r = await invoke(t['query_window_prop'], { path: 'app.cfg', expr: '$[?(@.x==' })
  assert(/"error":\s*"JSONPATH_SYNTAX"/.test(r) && /"expr"/.test(r), 'query 语法错 → JSONPATH_SYNTAX + details.expr')

  // 正常成功:不是 ERROR 前缀
  r = await invoke(t['get_window_prop'], { path: 'app.theme' })
  assert(!/^ERROR:/.test(r) && /dark/.test(r), '正常读不返回 ERROR 前缀')
}

// ============ vfs 报错(正则/glob 不抛,edit 多匹配给位置)============
console.log('\n[vfs errors]')
{
  const vfs = createVfs({ 'a.txt': 'line1 foo\nline2 foo\nline3 bar' })
  const tools = createVfsTools(vfs)
  const t = byName(tools)

  // grep 非法正则:返回 toolError 而非抛异常
  let r = await invoke(t['vfs_grep'], { pattern: '(' })
  assert(/"error":\s*"REGEX_INVALID"/.test(r), 'vfs_grep 非法正则 → REGEX_INVALID(不抛异常)')

  // glob 正常匹配(globToRegex 转义所有特殊字符,几乎不抛;try-catch 为防御)
  r = await invoke(t['vfs_glob'], { pattern: '*.txt' })
  assert(/a\.txt/.test(r), 'vfs_glob 正常匹配 *.txt')

  // edit 多匹配:AMBIGUOUS_MATCH + matches 位置
  r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'foo', newString: 'baz' })
  assert(/"error":\s*"AMBIGUOUS_MATCH"/.test(r) && /"matches"/.test(r), 'vfs_edit 多匹配 → AMBIGUOUS_MATCH + matches 位置')

  // edit 未找到:NO_MATCH
  r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'nope', newString: 'x' })
  assert(/"error":\s*"NO_MATCH"/.test(r), 'vfs_edit 未找到 → NO_MATCH')

  // read 未找到:NOT_FOUND
  r = await invoke(t['vfs_read'], { path: 'missing.txt' })
  assert(/"error":\s*"NOT_FOUND"/.test(r), 'vfs_read 未找到 → NOT_FOUND')
}

// ============ offload(大结果外存)============
console.log('\n[offload]')
{
  // 小结果原样
  const small = offloadLargeResult('hello', { toolName: 't', vfsAvailable: true, files: {} })
  assert(small === 'hello', '小结果(≤阈值)原样返回')

  // 大结果 + vfs 可用 → 外存 + 预览引用
  const big = 'x'.repeat(10000)
  const files: Record<string, { content: string; updatedAt: number }> = {}
  const offloaded = offloadLargeResult(big, { toolName: 'get_x', vfsAvailable: true, files, threshold: 6000 })
  const keys = Object.keys(files)
  assert(/已转存到虚拟工作区/.test(offloaded) && keys.length === 1, '大结果+vfs可用 → 外存并返回预览引用')
  assert(files[keys[0]].content === big && /get_x/.test(keys[0]), '外存内容完整 + 文件名含工具名')

  // 大结果 + vfs 不可用 → 按放行上限:≤上限完整放行(不截断),>上限才截断兜底
  const passThrough = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 20000 })
  assert(passThrough === big, 'vfs 不可用 + 结果 ≤ 放行上限 → 完整放行(不截断)')
  const stillTruncated = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 5000 })
  assert(/已截断/.test(stillTruncated) && stillTruncated.length < big.length, 'vfs 不可用 + 结果 > 放行上限 → 截断兜底')
  const defaultTrunc = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000 })
  assert(/已截断/.test(defaultTrunc), 'vfs 不可用 + 未传 passThrough → 默认截断(= threshold)')
}

// ============ vfs ============
console.log('\n[vfs]')
{
  const store = createVfs({ 'notes.md': '# hello\nworld\nfoo bar baz' })
  const t = byName(createVfsTools(store))

  let r = await invoke(t['vfs_write'], { path: 'a.txt', content: 'line1\nline2\nline3' })
  assert(/已写入/.test(r), 'vfs_write')

  r = await invoke(t['vfs_read'], { path: 'a.txt' })
  assert(/line1/.test(r), 'vfs_read')

  r = await invoke(t['vfs_ls'], {})
  assert(/notes\.md/.test(r) && /a\.txt/.test(r), 'vfs_ls 列文件')

  r = await invoke(t['vfs_glob'], { pattern: '*.md' })
  assert(/notes\.md/.test(r) && !/a\.txt/.test(r), 'vfs_glob *.md 精确匹配')

  r = await invoke(t['vfs_grep'], { pattern: 'foo' })
  assert(/foo bar/.test(r), 'vfs_grep 内容搜索')

  r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'line2', newString: 'LINE2' })
  assert(/已替换/.test(r), 'vfs_edit 唯一替换')

  r = await invoke(t['vfs_read'], { path: 'a.txt', offset: 1, limit: 1 })
  assert(/LINE2/.test(r), 'vfs_read 分页(offset/limit)')

  // 内存上限 + LRU 淘汰:maxBytes 极小,写入超限 → 淘汰到 ≤ watermark(剩 2 个,无关哪个被删)
  const store2 = createVfs({}, { maxBytes: 30 })
  const t2 = byName(createVfsTools(store2))
  await invoke(t2['vfs_write'], { path: 'a.txt', content: 'A'.repeat(10) })
  await invoke(t2['vfs_write'], { path: 'b.txt', content: 'B'.repeat(10) })
  await invoke(t2['vfs_write'], { path: 'c.txt', content: 'C'.repeat(10) })
  await invoke(t2['vfs_write'], { path: 'd.txt', content: 'D'.repeat(10) }) // 总 40 > 30
  assert(Object.keys(store2.files).length === 2, 'vfs maxBytes 淘汰:超限后 LRU 删到 ≤ watermark(剩 2 个)')
}

// ============ todos 中间件 ============
console.log('\n[todos middleware]')
{
  const mw = createTodosMiddleware()
  assert(mw.augmentPrompt?.(createState()) === undefined, '空 todos → augmentPrompt 无段')

  const wt = mw.tools!.find((x) => x.name === 'write_todos')!
  let r = await invoke(wt, { todos: [{ content: '任务一', status: 'in_progress' }] })
  assert(/已更新/.test(r), 'write_todos 整表替换')

  const seg = mw.augmentPrompt?.(createState())
  assert(seg?.includes('任务一') && /任务清单/.test(seg || ''), '更新后 todos 注入 prompt')

  // 并行拒绝(beforeModel 未重置计数 → 第 2 次拒绝)
  const next = async () => ({ content: 'ok', status: 'done' as const })
  await mw.wrapToolCall!({ id: '1', name: 'write_todos', args: {}, state: createState() }, next)
  const r2 = await mw.wrapToolCall!({ id: '2', name: 'write_todos', args: {}, state: createState() }, next)
  assert(/并行/.test(r2.content) && r2.status === 'error', '并行 write_todos 被拒')
}

// ============ skills 中间件 ============
console.log('\n[skills middleware]')
{
  const mw = createSkillsMiddleware([
    defineSkill({ name: 'demo', description: '演示', getContent: () => 'SKILL FULL CONTENT' }),
  ])
  const seg = mw.augmentPrompt?.(createState())
  assert(seg?.includes('demo') && /Skills/.test(seg || ''), 'skills 索引注入 system prompt')

  const ls = mw.tools!.find((x) => x.name === 'load_skill')!
  let r = await invoke(ls, { name: 'demo' })
  assert(/SKILL FULL CONTENT/.test(r), 'load_skill 返回全文')

  r = await invoke(ls, { name: 'demo' })
  assert(/已在本轮加载|无需重复/.test(r), 'load_skill 重复加载被防')

  r = await invoke(ls, { name: 'nope' })
  assert(/未找到/.test(r), 'load_skill 未知名报错')
}

// ============ permissions 中间件 ============
console.log('\n[permissions middleware]')
{
  const mw = createPermissionsMiddleware([
    { operations: ['write'], scopes: ['app.secret'], mode: 'deny' },
  ])
  const next = async () => ({ content: 'ok', status: 'done' as const })
  let r = await mw.wrapToolCall!({ id: '1', name: 'set_window_prop', args: { path: 'app.secret' }, state: createState() }, next)
  assert(/权限拒绝/.test(r.content) && r.status === 'error', 'permissions deny 命中')

  r = await mw.wrapToolCall!({ id: '2', name: 'set_window_prop', args: { path: 'app.theme' }, state: createState() }, next)
  assert(r.content === 'ok', 'permissions 未命中规则默认 allow')

  r = await mw.wrapToolCall!({ id: '3', name: 'custom_tool', args: {}, state: createState() }, next)
  assert(r.content === 'ok', 'permissions 不影响非 window/vfs 工具')
}

// ============ memory 中间件 ============
console.log('\n[memory middleware]')
{
  const mw = createMemoryMiddleware('记住:用中文')
  const s = mw.beforeAgent?.(createState()) as any
  assert(s?.memory === '记住:用中文', 'memory beforeAgent 注入 state')
  assert(mw.augmentPrompt?.({ ...createState(), memory: '记住:用中文' })?.includes('记住:用中文'), 'memory augmentPrompt 渲染')
}

// ============ middleware 执行器 ============
console.log('\n[middleware executor]')
{
  const s = applyUpdate(createState(), { memory: 'x' })
  assert(s.memory === 'x', 'applyUpdate 合并更新')

  const order: string[] = []
  const mws = [
    { name: 'a', beforeAgent: () => { order.push('a'); return undefined } },
    { name: 'b', beforeAgent: () => { order.push('b'); return undefined } },
  ] as any
  await runBeforeAgent(mws, createState())
  assert(order[0] === 'a' && order[1] === 'b', 'beforeAgent 正序执行')

  const afterOrder: string[] = []
  const mws2 = [
    { name: 'a', afterModel: () => { afterOrder.push('a'); return undefined } },
    { name: 'b', afterModel: () => { afterOrder.push('b'); return undefined } },
  ] as any
  runAfterModel(mws2, { message: {} as any, toolCalls: [], content: '' }, createState())
  assert(afterOrder[0] === 'b' && afterOrder[1] === 'a', 'afterModel 逆序执行')
}

// ============ storage(持久化 + 配额 + 淘汰 + 隔离)============
console.log('\n[storage]')
{
  // 纯函数
  assert(encodeKey('db', 'a1', 's1', 'messages') === 'v:1::db::a1::s1::messages', 'encodeKey 复合前缀')
  assert(estimateBytes({ a: '中' }) > 0, 'estimateBytes 中文+对象 > 0')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert(estimateBytes(cyclic) === 0, 'estimateBytes 不可序列化(循环引用)返回 0')

  // isQuotaError(运行时降级判定)
  assert(isQuotaError({ name: 'QuotaExceededError' }) === true, 'isQuotaError 识别 QuotaExceededError')
  assert(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }) === true, 'isQuotaError 识别 Firefox 配额错误名')
  assert(isQuotaError(new Error('x')) === false, 'isQuotaError 普通错误返回 false')
  assert(isQuotaError(null) === false, 'isQuotaError null 安全返回 false')

  // 默认配额按后端类型(WebStorage 贴合浏览器 ~5MB 上限并留余量)
  assert(defaultMaxBytesFor('local') === 4 * 1024 * 1024 && defaultMaxBytesFor('session') === 4 * 1024 * 1024, '默认配额:local/session = 4MB')
  assert(defaultMaxBytesFor('indexed') === 50 * 1024 * 1024 && defaultMaxBytesFor('memory') === 50 * 1024 * 1024, '默认配额:indexed/memory = 50MB')

  // LRU 选择
  const metas = [
    { agentId: 'a', sessionId: '1', createdAt: 0, lastAccessed: 1, bytes: 60 },
    { agentId: 'a', sessionId: '2', createdAt: 0, lastAccessed: 2, bytes: 60 },
    { agentId: 'a', sessionId: '3', createdAt: 0, lastAccessed: 3, bytes: 60 },
  ]
  const victims = selectForEviction(metas, 100, 0.9)
  assert(victims.length === 2 && victims[0].sessionId === '1', 'selectForEviction LRU 淘汰最旧两个')

  // MemoryBackend 基本读写
  const mb = createMemoryBackend()
  await mb.set('k', { x: 1 })
  assert((((await mb.get('k')) as { x: number } | undefined)?.x) === 1, 'MemoryBackend set/get')
  await mb.set('k2', 2)
  await mb.del('k2')
  assert((await mb.get('k2')) === undefined, 'MemoryBackend del')
  await mb.set('pre_a', 1)
  await mb.set('pre_b', 2)
  await mb.set('other', 3)
  await mb.clearPrefix('pre_')
  assert((await mb.get('pre_a')) === undefined && (await mb.get('other')) === 3, 'MemoryBackend clearPrefix 范围删')

  // SessionStore(无 indexedDB 环境自动降级 memory)
  const s = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 1000000, debounceMs: 10 })
  await s.ready
  const sid1 = await s.createSession('agentA')
  await s.save('agentA', sid1, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] })
  await s.flush()
  const snap1 = await s.load('agentA', sid1)
  assert(!!snap1 && snap1.messages.length === 1 && snap1.messages[0].content === 'hi', 'save/load 对话历史 round-trip')

  // agentB 隔离 agentA
  const sid2 = await s.createSession('agentB')
  const snap2 = await s.load('agentB', sid2)
  assert(snap2 === undefined || (snap2.messages?.length ?? 0) === 0, 'agentB 隔离 agentA 数据')

  // listSessions 按 agentId 过滤
  const list = await s.listSessions('agentA')
  assert(list.length === 1 && list[0].sessionId === sid1, 'listSessions 按 agentId 过滤')

  // deleteSession 后 load 返回 undefined
  await s.deleteSession('agentA', sid1)
  assert((await s.load('agentA', sid1)) === undefined, 'deleteSession 后 load 返回 undefined')

  // debounce + flush:连续 save 同 kind 只落最后值
  const s4 = createSessionStore({ debounceMs: 100 })
  await s4.ready
  const sid4 = await s4.createSession('d')
  await s4.save('d', sid4, { memory: 'first' })
  await s4.save('d', sid4, { memory: 'second' })
  await s4.flush()
  const snap4 = await s4.load('d', sid4)
  assert(snap4?.memory === 'second', 'debounce:连续 save 同 kind 只落最后值(flush 立即)')

  // 单会话软上限:超限拒写 + quota 事件
  const s3 = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 100, debounceMs: 10 })
  await s3.ready
  let quotaHit = false
  s3.onEvent((e) => {
    if (e.type === 'quota') quotaHit = true
  })
  const sid3 = await s3.createSession('q')
  await s3.save('q', sid3, { memory: 'X'.repeat(200) })
  await s3.flush()
  const snap3 = await s3.load('q', sid3)
  assert(quotaHit && (!snap3 || snap3.memory === ''), '单会话超软上限 → quota 事件 + memory 拒写')

  // LRU 淘汰:小配额下多会话,最旧被整会话删
  const s2 = createSessionStore({ maxBytes: 300, maxBytesPerSession: 1000000, debounceMs: 10 })
  await s2.ready
  const a = await s2.createSession('x')
  await s2.save('x', a, { memory: 'A'.repeat(200) })
  await s2.flush()
  const b = await s2.createSession('x')
  await s2.save('x', b, { memory: 'B'.repeat(200) })
  await s2.flush()
  const c = await s2.createSession('x')
  await s2.save('x', c, { memory: 'C'.repeat(200) })
  await s2.flush()
  assert((await s2.load('x', a)) === undefined, 'LRU 淘汰最旧会话 a')
  assert((await s2.load('x', b)) === undefined, 'LRU 淘汰次旧会话 b')
  assert((await s2.load('x', c)) !== undefined, '最新会话 c 保留')

  // 降级:无 indexedDB 环境 ready=false + degraded 事件
  const s5 = createSessionStore()
  let degraded = false
  s5.onEvent((e) => {
    if (e.type === 'degraded') degraded = true
  })
  const ok5 = await s5.ready
  assert(ok5 === false && degraded, '无 indexedDB → 降级 memory(ready=false + degraded 事件)')

  // 并发 commit 不丢 meta 增量(同会话多 kind 并发 save → per-session 串行队列保证)
  const s6 = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 1000000, debounceMs: 10 })
  await s6.ready
  const sid6 = await s6.createSession('c')
  await Promise.all([
    s6.save('c', sid6, { messages: [{ role: 'user', content: 'm'.repeat(100), timestamp: 1 }] }),
    s6.save('c', sid6, { todos: [{ content: 't'.repeat(100), status: 'pending' }] }),
    s6.save('c', sid6, { memory: 'M'.repeat(100) }),
  ])
  await s6.flush()
  const list6 = await s6.listSessions('c')
  assert(list6.length === 1 && list6[0].bytes > 280, '并发 commit:多 kind 并发 save 不丢 meta 增量(>280 字节)')

  // 手选后端:sessionStorage(mock)与显式 memory
  const mockStorage = () => {
    const m = new Map<string, string>()
    return {
      get length() {
        return m.size
      },
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
      removeItem: (k: string) => {
        m.delete(k)
      },
      clear: () => {
        m.clear()
      },
    }
  }
  ;(globalThis as any).sessionStorage = mockStorage()
  const s7 = createSessionStore({ backend: 'session', debounceMs: 10 })
  const ok7 = await s7.ready
  assert(ok7 === true, 'backend:session → ready=true(持久)')
  const sid7 = await s7.createSession('web')
  await s7.save('web', sid7, { memory: 'hello' })
  await s7.flush()
  const snap7 = await s7.load('web', sid7)
  assert(snap7?.memory === 'hello', 'backend:session → sessionStorage save/load round-trip')

  let memDegraded = false
  const s8 = createSessionStore({ backend: 'memory' })
  s8.onEvent((e) => {
    if (e.type === 'degraded') memDegraded = true
  })
  const ok8 = await s8.ready
  assert(ok8 === false && !memDegraded, 'backend:memory → 显式内存后端(ready=false,非降级不触发 degraded)')

  // 运行时 QuotaExceeded:mock sessionStorage setItem 超量抛错 → 淘汰最旧 + 降级 memory + degraded 事件 + 数据不丢
  const quotaStorage = () => {
    const m = new Map<string, string>()
    return {
      get length() {
        return m.size
      },
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        if (m.size >= 2) {
          // 模拟浏览器配额超限
          const e = new Error('quota exceeded')
          ;(e as Error & { name: string }).name = 'QuotaExceededError'
          throw e
        }
        m.set(k, v)
      },
      removeItem: (k: string) => {
        m.delete(k)
      },
      clear: () => {
        m.clear()
      },
    }
  }
  ;(globalThis as any).sessionStorage = quotaStorage()
  const s9 = createSessionStore({ backend: 'session', debounceMs: 10 })
  let runtimeDegraded = false
  s9.onEvent((e) => {
    if (e.type === 'degraded') runtimeDegraded = true
  })
  await s9.ready
  const sid9 = await s9.createSession('q9') // 写 1 条 meta
  await s9.save('q9', sid9, { memory: 'X'.repeat(50) }) // 写 memory 成功 + 写 meta 撞配额
  await s9.flush()
  await new Promise((r) => setTimeout(r, 20)) // 等 degraded emit 的微任务
  const snap9 = await s9.load('q9', sid9)
  assert(runtimeDegraded && snap9?.memory === 'X'.repeat(50), '运行时 QuotaExceeded → 淘汰+降级 memory(degraded 事件)+ 数据不丢(load 可读)')

  // backend:local → localStorage round-trip(对称已测的 session;IdbBackend 需真实 IndexedDB,仅手动验证)
  ;(globalThis as any).localStorage = mockStorage()
  const s10 = createSessionStore({ backend: 'local', debounceMs: 10 })
  assert((await s10.ready) === true, 'backend:local → ready=true(持久,路由 localStorage)')
  const sid10 = await s10.createSession('weblocal')
  await s10.save('weblocal', sid10, { memory: 'hello-local' })
  await s10.flush()
  const snap10 = await s10.load('weblocal', sid10)
  assert(snap10?.memory === 'hello-local', 'backend:local → localStorage save/load round-trip')
}

// ============ retry(模型调用重试 + abort 判定) ============
console.log('\n[retry]')
{
  // isAbort
  assert(isAbort({ name: 'AbortError' }) === true, 'isAbort: name===AbortError 命中')
  assert(isAbort(new Error('net')) === false, 'isAbort: 普通 Error 非 abort')
  const ac = new AbortController()
  assert(isAbort(new Error('x'), ac.signal) === false, 'isAbort: 未 aborted 的 signal 不算')
  ac.abort()
  assert(isAbort(new Error('x'), ac.signal) === true, 'isAbort: signal.aborted 命中')

  // isRetryable(必须先排除 abort 再判 status)
  assert(isRetryable({}) === true, 'isRetryable: 网络错误(status undefined)可重试')
  assert(isRetryable({ name: 'TimeoutError' }) === true, 'isRetryable: 超时可重试')
  assert(isRetryable({ status: 429 }) === true, 'isRetryable: 429 可重试')
  assert(isRetryable({ lc_error_code: 'MODEL_RATE_LIMIT' }) === true, 'isRetryable: MODEL_RATE_LIMIT 可重试')
  assert(isRetryable({ status: 500 }) === true, 'isRetryable: 500 可重试')
  assert(isRetryable({ status: 503 }) === true, 'isRetryable: 503 可重试')
  assert(isRetryable({ status: 400 }) === false, 'isRetryable: 400 不重试(参数错误)')
  assert(isRetryable({ status: 401 }) === false, 'isRetryable: 401 不重试(鉴权)')
  assert(isRetryable({ status: 404 }) === false, 'isRetryable: 404 不重试')
  assert(isRetryable({ name: 'AbortError' }) === false, 'isRetryable: AbortError 不重试(即使 status undefined)')
  assert(isRetryable(null) === false, 'isRetryable: null 不重试')

  // withRetry(baseDelayMs:0 避免真实退避等待)
  const r1 = await withRetry(() => Promise.resolve('ok'), { baseDelayMs: 0 })
  assert(r1 === 'ok', 'withRetry: 首次成功直接返回')

  let calls = 0
  const r2 = await withRetry(
    async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('net'), { status: undefined })
      return 'recovered'
    },
    { baseDelayMs: 0 },
  )
  assert(r2 === 'recovered' && calls === 3, 'withRetry: 网络错误重试 2 次后第 3 次成功')

  // 4xx 不可重试:立即抛,只调 1 次
  let calls4xx = 0
  let threw4xx = false
  try {
    await withRetry(async () => {
      calls4xx++
      throw Object.assign(new Error('bad'), { status: 400 })
    }, { baseDelayMs: 0 })
  } catch (e: any) {
    threw4xx = e.status === 400
  }
  assert(threw4xx && calls4xx === 1, 'withRetry: 4xx 不重试,立即抛')

  // AbortError 不重试:立即抛,只调 1 次
  let callsAbort = 0
  let threwAbort = false
  try {
    await withRetry(async () => {
      callsAbort++
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }, { baseDelayMs: 0 })
  } catch (e: any) {
    threwAbort = e.name === 'AbortError'
  }
  assert(threwAbort && callsAbort === 1, 'withRetry: AbortError 不重试,立即抛')

  // 达到 maxRetries 仍失败:抛错,maxRetries+1 次尝试
  let callsMax = 0
  let threwMax = false
  try {
    await withRetry(async () => {
      callsMax++
      throw new Error('net')
    }, { maxRetries: 2, baseDelayMs: 0 })
  } catch (e: any) {
    threwMax = /net/.test(e.message)
  }
  assert(threwMax && callsMax === 3, 'withRetry: 达上限抛错(maxRetries=2 → 3 次尝试)')

  // 退避回调被触发(验证 onRetry 调用次数 = 重试次数)
  let retryNotified = 0
  try {
    await withRetry(
      async () => {
        throw Object.assign(new Error('net'), { status: undefined })
      },
      { maxRetries: 2, baseDelayMs: 0, onRetry: () => retryNotified++ },
    )
  } catch {
    /* 预期抛错 */
  }
  assert(retryNotified === 2, 'withRetry: onRetry 回调在每次重试前触发(2 次)')
}

// ============ pool(并发池:createAgent 同轮工具 / subagent 多子任务 共用) ============
console.log('\n[pool]')
{
  // limit=1 串行:顺序执行 + 顺序结果
  const order: string[] = []
  const r1 = await runPool(['a', 'b', 'c'], 1, async (x) => {
    order.push(x)
    return x.toUpperCase()
  })
  assert(JSON.stringify(r1) === JSON.stringify(['A', 'B', 'C']), 'runPool: limit=1 串行,结果按顺序回填')
  assert(JSON.stringify(order) === JSON.stringify(['a', 'b', 'c']), 'runPool: limit=1 严格串行执行')

  // limit>1 并发:结果仍按原顺序回填(并发完成顺序无关)
  const r2 = await runPool([1, 2, 3, 4], 4, async (x) => x * 10)
  assert(JSON.stringify(r2) === JSON.stringify([10, 20, 30, 40]), 'runPool: 并发结果按原顺序回填')

  // 并发上限:同时执行的任务不超过 limit
  let active = 0
  let maxActive = 0
  await runPool([1, 2, 3, 4, 5], 2, async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise((r) => setTimeout(r, 10))
    active--
  })
  assert(maxActive >= 2, 'runPool: 并发确实发生(峰值 ' + maxActive + ')')
  assert(maxActive <= 2, 'runPool: 并发不超过 limit')

  // signal 已 aborted:串行分支不执行,结果全 undefined
  const ac = new AbortController()
  ac.abort()
  let ran = false
  const r3 = await runPool(
    [1, 2, 3],
    1,
    async () => {
      ran = true
      return 0
    },
    ac.signal,
  )
  assert(!ran && r3.every((x) => x === undefined), 'runPool: signal aborted 时串行不启动(结果全 undefined)')
}

// ============ subagent(子 agent 中间件结构 + wrapToolCall) ============
console.log('\n[subagent]')
{
  const mw = createSubagentMiddleware({ llm: { apiKey: 'test' }, allTools: [] })
  assert(mw.name === 'subagent', 'subagent: 中间件 name=subagent')
  assert((mw.tools?.length ?? 0) === 2, 'subagent: 贡献 spawn_agent + spawn_agents 两个工具')
  const names = (mw.tools || []).map((t: any) => t.name)
  assert(names.includes('spawn_agent') && names.includes('spawn_agents'), 'subagent: 工具名为 spawn_agent / spawn_agents')
  assert(typeof mw.wrapToolCall === 'function', 'subagent: 有 wrapToolCall(捕获主 signal 供子 agent 继承)')

  // wrapToolCall 透传 next(不阻塞工具执行,且捕获 signal 不影响正常调用)
  const probe = { v: false }
  await mw.wrapToolCall!({ id: '1', name: 'x', args: {}, state: createState() }, async () => {
    probe.v = true
    return { content: 'ok', status: 'done' as const }
  })
  assert(probe.v, 'subagent: wrapToolCall 透传 next(不阻塞工具执行)')
}

// ============ mcp(extractText 纯函数:MCP callTool 结果 → 文本) ============
console.log('\n[mcp]')
{
  assert(extractText({ content: [{ type: 'text', text: 'hello' }] }) === 'hello', 'extractText: 单 text 提取')
  assert(
    extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }) === 'a\nb',
    'extractText: 多 text 换行拼接',
  )
  assert(extractText({ content: [{ type: 'image', data: 'abc123' }] }) === '[image:abc123…]', 'extractText: image 占位')
  assert(extractText({ content: [] }) === '', 'extractText: 空 content → 空串')
  assert(extractText({} as any) === '', 'extractText: 无 content 字段 → 空串')
  const err = extractText({ content: [{ type: 'text', text: '失败原因' }], isError: true })
  assert(/工具错误/.test(err) && /失败原因/.test(err), 'extractText: isError 标注"工具错误"')
  assert(extractText({ content: [{ type: 'resource', resource: { text: 'res' } }] }) === 'res', 'extractText: resource.text 提取')
}

// ============ beforeReturn 自纠钩子(runBeforeReturn 执行器:agent 返回前拦截自纠) ============
console.log('\n[beforeReturn 自纠钩子]')
{
  // stream 自纠循环本身依赖 LLM,按惯例手动验证(同 subagent/mcp);此处覆盖纯函数 runBeforeReturn 的拼接逻辑(= 自纠触发条件)
  const state = createState()
  assert(state.verifyAttempts === 0, 'createInitialState 初始化 verifyAttempts=0(自纠计数起点)')

  const ctx = { messages: [], state, response: { message: {}, toolCalls: [], content: 'r' } } as any

  let fb = await runBeforeReturn(
    [
      { name: 'a', beforeReturn: () => null },
      { name: 'b', beforeReturn: () => null },
    ],
    ctx,
  )
  assert(fb === null, '所有钩子返回 null → 放行 return(不自纠)')

  fb = await runBeforeReturn(
    [
      { name: 'a', beforeReturn: () => '问题1' },
      { name: 'b', beforeReturn: () => '问题2' },
    ],
    ctx,
  )
  assert(fb === '问题1\n\n问题2', '多个 feedback 正序拼接(任一非 null 即触发自纠)')

  fb = await runBeforeReturn(
    [
      { name: 'a', beforeReturn: () => null },
      { name: 'b', beforeReturn: () => '问题2' },
    ],
    ctx,
  )
  assert(fb === '问题2', '跳过 null 钩子,只拼接非 null feedback')

  fb = await runBeforeReturn([{ name: 'a' }, { name: 'b' }], ctx)
  assert(fb === null, '中间件无 beforeReturn 钩子 → 放行 return')

  fb = await runBeforeReturn([{ name: 'a', beforeReturn: async () => '异步问题' }], ctx)
  assert(fb === '异步问题', '支持异步 beforeReturn 钩子')
}

// ============ verify 中间件(createVerifyMiddleware:check → beforeReturn 包装) ============
console.log('\n[verify 中间件]')
{
  const ctx = { messages: [], state: createState(), response: { message: {}, toolCalls: [], content: 'r' } } as any

  const mwOk = createVerifyMiddleware({ check: () => ({ ok: true }) })
  assert((await mwOk.beforeReturn!(ctx)) === null, 'check ok=true → beforeReturn 放行(返回 null)')

  const mwFail = createVerifyMiddleware({ check: () => ({ ok: false, feedback: '内容太少' }) })
  assert((await mwFail.beforeReturn!(ctx)) === '内容太少', 'check ok=false + feedback → 回灌 feedback')

  const mwNoFb = createVerifyMiddleware({ check: () => ({ ok: false }) })
  const noFbResult = await mwNoFb.beforeReturn!(ctx)
  assert(noFbResult !== null && /未通过验证/.test(noFbResult), 'check ok=false 无 feedback → 默认文案')

  const mwAsync = createVerifyMiddleware({ check: async () => ({ ok: false, feedback: '异步问题' }) })
  assert((await mwAsync.beforeReturn!(ctx)) === '异步问题', '支持异步 check')

  assert(mwOk.name === 'verify', '中间件 name=verify')
}

// ============ approval 中间件(人工确认:wrapToolCall 拦截 → approval_request → resolve) ============
console.log('\n[approval 中间件]')
{
  const mw = createApprovalMiddleware({ tools: ['set_window_prop'] })
  assert(mw.name === 'approval', '中间件 name=approval')

  let captured: any = null
  const mkCtx = (name: string, args: any, signal?: AbortSignal): any => ({
    name,
    args,
    signal,
    emit: (e: any) => { captured = e },
  })

  // 1. 不需确认的工具 → 直接 next,不发事件
  let nextCalled = false
  await mw.wrapToolCall!(mkCtx('get_window_prop', { path: 'a' }), async () => { nextCalled = true; return { content: 'ok', status: 'done' } })
  assert(nextCalled && !captured, '非确认工具 → 放行 next,不发 approval_request')

  // 2. 需确认 → 发 approval_request,resolve(true) → 执行 next
  captured = null
  let execResult = { content: 'written', status: 'done' as const }
  let p = mw.wrapToolCall!(mkCtx('set_window_prop', { path: 'a', value: 1 }), async () => execResult)
  assert(captured?.type === 'approval_request' && captured.toolName === 'set_window_prop', '确认工具 → 发 approval_request 事件')
  captured.resolve(true)
  let r = await p
  assert(r.content === 'written' && r.status === 'done', 'resolve(true) → 执行工具,返回真实结果')

  // 3. resolve(false) → 返回 error(不执行 next)
  captured = null
  let denied = false
  let p2 = mw.wrapToolCall!(mkCtx('set_window_prop', { path: 'b', value: 2 }), async () => { denied = true; return { content: 'x', status: 'done' } })
  captured.resolve(false)
  let r2 = await p2
  assert(r2.status === 'error' && !denied, 'resolve(false) → 返回 error 且不执行工具')

  // 4. abort 联动:signal 已 aborted → 自动拒绝
  const ac = new AbortController(); ac.abort()
  captured = null
  let p3 = mw.wrapToolCall!(mkCtx('set_window_prop', { path: 'c' }, ac.signal), async () => ({ content: 'x', status: 'done' }))
  let r3 = await p3
  assert(r3.status === 'error', 'signal 已 abort → 自动拒绝')

  // 5. 超时自动拒绝
  const mwT = createApprovalMiddleware({ tools: ['set_window_prop'], timeoutMs: 30 })
  captured = null
  let p4 = mwT.wrapToolCall!(mkCtx('set_window_prop', { path: 'd' }), async () => ({ content: 'x', status: 'done' }))
  let r4 = await p4
  assert(r4.status === 'error', 'timeoutMs 超时 → 自动拒绝')

  // 6. confirm 自定义判定(优先于 tools)
  const mwC = createApprovalMiddleware({ tools: ['set_window_prop'], confirm: (n) => n === 'edit_window_prop' })
  captured = null
  await mwC.wrapToolCall!(mkCtx('set_window_prop', { path: 'e' }), async () => ({ content: 'ok', status: 'done' }))
  assert(!captured, 'confirm 优先于 tools:set_window_prop 不在 confirm 命中 → 放行不发事件')
  captured = null
  let p5 = mwC.wrapToolCall!(mkCtx('edit_window_prop', { path: 'f' }), async () => ({ content: 'ok', status: 'done' }))
  assert(captured?.type === 'approval_request', 'confirm 命中 edit_window_prop → 发确认事件')
  captured.resolve(true)
  assert((await p5).content === 'ok', 'confirm 命中后 resolve(true) → 执行')

  // 7. 不传 tools/confirm → 所有工具都确认
  const mwAll = createApprovalMiddleware({})
  captured = null
  let p6 = mwAll.wrapToolCall!(mkCtx('any_tool', {}), async () => ({ content: 'ok', status: 'done' }))
  assert(captured?.type === 'approval_request', '无 tools/confirm → 所有工具都确认')
  captured.resolve(true)
  await p6

  // 8. tools 空数组 → 不确认任何工具(放行)
  const mwEmpty = createApprovalMiddleware({ tools: [] })
  captured = null
  let nextHit = false
  await mwEmpty.wrapToolCall!(mkCtx('any_tool', {}), async () => { nextHit = true; return { content: 'ok', status: 'done' } })
  assert(!captured && nextHit, 'tools 空数组 → 不确认任何工具,直接放行')
}

// ============ humanConfirm 中间件(LLM 主动征询:request_human_confirmation) ============
console.log('\n[humanConfirm 中间件]')
{
  const tool = createHumanConfirmTool()
  assert(tool.name === HUMAN_CONFIRM_TOOL_NAME, '工具 name=request_human_confirmation')
  assert(/不确定|多种|高风险/.test(tool.description), '工具描述含触发场景(不确定/多方案/高风险)')

  const mw = createHumanConfirmMiddleware()
  assert(mw.name === 'humanConfirm', '中间件 name=humanConfirm')

  let captured: any = null
  const mkCtx = (name: string, args: any, signal?: AbortSignal): any => ({
    name, args, signal, emit: (e: any) => { captured = e },
  })

  // 1. 非 humanConfirm 工具 → 放行 next
  captured = null
  let hit = false
  await mw.wrapToolCall!(mkCtx('get_window_prop', {}), async () => { hit = true; return { content: 'ok', status: 'done' } })
  assert(hit && !captured, '非 humanConfirm 工具 → 放行不发事件')

  // 2. resolve(true) → 同意
  captured = null
  let p = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '改红色还是蓝色?', recommendation: '红色' }), async () => ({ content: 'x', status: 'done' }))
  assert(captured?.type === 'approval_request' && captured.args?.question === '改红色还是蓝色?', 'humanConfirm → 发 approval_request(带 question)')
  captured.resolve(true)
  let r = await p
  assert(/用户同意了方案\(红色\)/.test(r.content), 'resolve(true) → 返回同意(含推荐)')

  // 3. resolve(false) → 拒绝
  captured = null
  let p2 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '删掉?' }), async () => ({ content: 'x', status: 'done' }))
  captured.resolve(false)
  let r2 = await p2
  assert(/用户拒绝/.test(r2.content), 'resolve(false) → 返回拒绝')

  // 4. resolve(string) → 选方案
  captured = null
  let p3 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '选方案', options: ['A', 'B'] }), async () => ({ content: 'x', status: 'done' }))
  captured.resolve('B')
  let r3 = await p3
  assert(/用户选择了:B/.test(r3.content), 'resolve(string) → 返回所选方案')

  // 5. abort 联动:进入时已 abort → 拒绝
  const ac = new AbortController(); ac.abort()
  captured = null
  let p4 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: 'x' }, ac.signal), async () => ({ content: 'x', status: 'done' }))
  let r4 = await p4
  assert(/用户拒绝/.test(r4.content), 'signal 已 abort → 自动拒绝')
}

// ============ checkpoint 中间件(会话级回滚:save/list/restore + 自动存档中间件) ============
console.log('\n[checkpoint 中间件]')
{
  // 模拟 window 注册属性 + vfs + todos + messages
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).CP = { page: { title: '原标题', theme: 'light', list: [1, 2, 3] } }
  const messages: any[] = [
    { role: 'user', content: '你好', timestamp: Date.now() },
  ]
  const vfsFiles: Record<string, any> = { 'a.txt': { content: 'AAA', bytes: 3, updatedAt: 1 } }
  const vfsStore = { files: vfsFiles } as any
  let curTodos = [{ content: 't1', status: 'pending' }]
  const todosMw = { reset: (t: any[]) => { curTodos = t.map((x) => ({ ...x })) } }
  const mgr = createCheckpointManager({
    windowPaths: ['CP.page'],
    vfsStore,
    todosMw: todosMw as any,
    getTodos: () => curTodos,
    messages: messages as any,
    maxCheckpoints: 3,
  })

  // 1. 初始无 checkpoint
  assert(mgr.list().length === 0 && !mgr.canRestore(), '初始无 checkpoint,canRestore=false')

  // 2. save → 存档(含 window 全量 + vfs + todos + messages)
  const id1 = mgr.save('auto')
  assert(mgr.list().length === 1 && mgr.canRestore(), 'save 后有 checkpoint,canRestore=true')
  assert(mgr.list()[0].label === 'auto', 'list 元信息含 label')

  // 3. 改动 window/vfs/todos/messages 后 restore → 全部还原
  ;(globalThis as any).CP.page.title = '被改坏的标题'
  ;(globalThis as any).CP.page.theme = 'dark'
  ;(globalThis as any).CP.page.list.push(99)
  delete vfsFiles['a.txt']; vfsFiles['b.txt'] = { content: 'BBB', bytes: 3, updatedAt: 2 }
  curTodos[0].status = 'completed'; curTodos.push({ content: 't2', status: 'pending' })
  messages.push({ role: 'assistant', content: '坏回复', timestamp: Date.now() })

  const ok = mgr.restore()
  assert(ok, 'restore 成功返回 true')
  assert((globalThis as any).CP.page.title === '原标题', 'restore 还原 window 标题')
  assert((globalThis as any).CP.page.theme === 'light', 'restore 还原 window theme')
  assert((globalThis as any).CP.page.list.length === 3 && !(globalThis as any).CP.page.list.includes(99), 'restore 还原 window 数组(就地清空+重填)')
  assert(Object.keys(vfsFiles).includes('a.txt') && !('b.txt' in vfsFiles), 'restore 还原 vfs(清空+重填)')
  assert(curTodos.length === 1 && curTodos[0].status === 'pending', 'restore 还原 todos')
  assert(messages.length === 1 && messages[0].content === '你好', 'restore 还原对话历史(去掉坏回复)')

  // 4. FIFO 限长:maxCheckpoints=3
  mgr.save(); mgr.save(); mgr.save(); mgr.save()
  assert(mgr.list().length === 3, 'FIFO 限长:maxCheckpoints=3,超出丢弃最旧')

  // 5. restore 指定 id
  const list = mgr.list()
  const targetId = list[0].id
  mgr.restore(targetId)
  assert(true, 'restore(id) 不抛')

  // 6. 无 checkpoint 时 restore 返回 false
  const mgr2 = createCheckpointManager({ windowPaths: [], vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
  assert(mgr2.restore() === false, '无 checkpoint 时 restore 返回 false')

  // 7. 自动存档中间件:beforeAgent 重置标记,beforeModel 首次触发 save
  const autoMgr = createCheckpointManager({ windowPaths: [], vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
  const cpMw = createCheckpointMiddleware(autoMgr)
  assert(cpMw.name === 'checkpoint', '中间件 name=checkpoint')
  // beforeAgent 返回 undefined(不修改 state)
  assert(cpMw.beforeAgent!({} as any) === undefined, 'beforeAgent 返回 undefined')
  // beforeModel 首次 → save(产生 checkpoint)
  assert(cpMw.beforeModel!({ messages: [], state: {} as any }) === undefined, 'beforeModel 返回 undefined')
  assert(autoMgr.list().length === 1, 'beforeModel 首次触发 save')
  // beforeModel 再次(同轮)→ 不重复 save
  cpMw.beforeModel!({ messages: [], state: {} as any })
  assert(autoMgr.list().length === 1, '同轮 beforeModel 再次不重复 save')
  // beforeAgent 重置标记 → 下一轮 beforeModel 再次 save
  cpMw.beforeAgent!({} as any)
  cpMw.beforeModel!({ messages: [], state: {} as any })
  assert(autoMgr.list().length === 2, '下一轮 beforeAgent 重置后 beforeModel 再次 save')

  // 清理
  delete (globalThis as any).CP
  delete (globalThis as any).window
}



// ============ createWriteBackCheck(写后读回验证) ============
console.log('\n[createWriteBackCheck]')
{
  const schemas = { 'app.theme': z.enum(['light', 'dark']), 'app.count': z.number().int() }
  const mkAi = (toolCalls: any[]) => ({ tool_calls: toolCalls, content: '' }) as any

  // 1. 无写操作 → ok
  let win: any = { app: { theme: 'dark', count: 0 } }
  let check = createWriteBackCheck({ window: win, schemas })
  let r = await check({ messages: [mkAi([])], state: createState() })
  assert(r.ok === true, '本轮无写操作 → ok 放行')

  // 2. set 后读回符合 schema → ok
  win = { app: { theme: 'dark', count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'set_window_prop', args: { path: 'app.theme' } }])], state: createState() })
  assert(r.ok === true, 'set 后读回符合 schema → ok')

  // 3. set 后读回为空 → feedback(未生效)
  win = { app: { theme: undefined, count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'set_window_prop', args: { path: 'app.theme' } }])], state: createState() })
  const fb3 = r.feedback
  assert(r.ok === false && !!fb3 && /读回为空/.test(fb3), 'set 后读回为空 → feedback(未生效)')

  // 4. set 后读回不符合 schema → feedback
  win = { app: { theme: 'red', count: 0 } } // 'red' 不在 enum
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'set_window_prop', args: { path: 'app.theme' } }])], state: createState() })
  const fb4 = r.feedback
  assert(r.ok === false && !!fb4 && /不符合 schema/.test(fb4), 'set 后读回不符合 schema → feedback')

  // 5. delete 后读回 undefined → ok(删除成功)
  win = { app: { theme: undefined, count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'delete_window_prop', args: { path: 'app.theme' } }])], state: createState() })
  assert(r.ok === true, 'delete 后读回空 → ok(删除成功)')

  // 6. delete 后读回仍有值 → feedback(未删干净)
  win = { app: { theme: 'dark', count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'delete_window_prop', args: { path: 'app.theme' } }])], state: createState() })
  const fb6 = r.feedback
  assert(r.ok === false && !!fb6 && /删除后读回仍有值/.test(fb6), 'delete 后读回仍有值 → feedback(未删干净)')

  // 7. edit_window_prop 后读回符合 schema → ok
  win = { app: { theme: 'dark', count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({ messages: [mkAi([{ name: 'edit_window_prop', args: { path: 'app.theme', jsonPath: '', op: 'set' } }])], state: createState() })
  assert(r.ok === true, 'edit 后读回符合 schema → ok')

  // 8. 写被合法拒绝(ToolMessage "校验失败")→ 不误报(ok)
  const mkTool = (callId: string, content: string) => ({ tool_call_id: callId, content }) as any
  win = { app: { theme: undefined, count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({
    messages: [
      mkAi([{ id: 'c1', name: 'set_window_prop', args: { path: 'app.theme' } }]),
      mkTool('c1', '校验失败:值不符合 enum'),
      mkAi([]),
    ],
    state: createState(),
  })
  assert(r.ok === true, '写被合法拒绝(校验失败)→ 不误报"未生效"')

  // 9. set 在更早轮、最近一轮是 get → 仍验证该 set(扫描所有写,非仅最近一轮)
  win = { app: { theme: undefined, count: 0 } }
  check = createWriteBackCheck({ window: win, schemas })
  r = await check({
    messages: [
      mkAi([{ id: 'c1', name: 'set_window_prop', args: { path: 'app.theme' } }]),
      mkTool('c1', '已设置 app.theme = "dark"'),
      mkAi([{ id: 'c2', name: 'get_window_prop', args: { path: 'app.count' } }]),
      mkTool('c2', '0'),
      mkAi([]),
    ],
    state: createState(),
  })
  const fb9 = r.feedback
  assert(r.ok === false && !!fb9 && /读回为空/.test(fb9), 'set 在更早轮、最近是 get → 仍验证该 set')
}

// ============ 对抗式验证(isAdversarialClean verdict 判定) ============
console.log('\n[adversarial verdict 判定]')
{
  // runAdversarial 整体依赖 LLM(createAgent + invoke),按惯例手动验证;此处测 verdict 判定纯函数
  assert(isAdversarialClean('无问题') === true, 'verdict "无问题" → 放行(返回 true)')
  assert(isAdversarialClean('经过审查,没有问题。') === true, 'verdict "没有问题" → 放行')
  assert(isAdversarialClean('未发现问题') === true, 'verdict "未发现问题" → 放行')
  assert(isAdversarialClean('回复缺少价格字段,请补充') === false, 'verdict 含具体问题 → 触发自纠(返回 false)')
  assert(isAdversarialClean('逻辑矛盾:前后说法不一致') === false, 'verdict 含问题 → 触发自纠')
}

// ============ toolsets + selectBuiltinTools(内置工具集导出 + caps 筛选)============
console.log('\n[toolsets + selectBuiltinTools]')
{
  // fetchTools 静态预设(工具数组)
  assert(fetchTools.length === fetchDocTools.length && fetchTools[0].name === 'fetch_document', 'fetchTools 静态预设含 fetch_document')

  // defineWindowToolset 工厂(依赖 windowProps,故为工厂)
  const props = [{ path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) }]
  const wt = defineWindowToolset(props)
  assert(wt.length === 13 && wt[0].name === 'list_window_props', 'defineWindowToolset 工厂产出 13 个 window 工具(10 原有 + query/search/eval)')

  // selectBuiltinTools:默认全装(windowOps + fetch)
  const winOps = createWindowOps(props)
  const all = selectBuiltinTools(undefined, winOps, fetchDocTools)
  assert(all.length === winOps.length + fetchDocTools.length, 'selectBuiltinTools 默认全装(windowOps + fetch)')

  // windowOps:false → 不含 window 工具,fetch 仍在
  const noWin = selectBuiltinTools({ windowOps: false }, winOps, fetchDocTools)
  assert(noWin.length === fetchDocTools.length && noWin.every((t) => t.name === 'fetch_document'), 'windowOps:false → 只剩 fetch_document')

  // fetch:false → 不含 fetch,window 仍在
  const noFetch = selectBuiltinTools({ fetch: false }, winOps, fetchDocTools)
  assert(noFetch.length === winOps.length && noFetch.every((t) => t.name !== 'fetch_document'), 'fetch:false → 只剩 window 工具')

  // 两者都关 → 空
  const none = selectBuiltinTools({ windowOps: false, fetch: false }, winOps, fetchDocTools)
  assert(none.length === 0, 'windowOps + fetch 都关 → 工具池空')
}

// ============ usageHints 中间件(能力用法默认提示,克制注入)============
console.log('\n[usageHints middleware]')
{
  // 全开 → 含 planning/snapshot/spawn 三条提示
  const mwFull = createUsageHintsMiddleware({ planning: true, subagent: true }, true)
  const segFull = mwFull.augmentPrompt?.(createState()) || ''
  assert(/write_todos/.test(segFull) && /restore_window_snapshot/.test(segFull) && /spawn_agent/.test(segFull), '能力全开 → 注入 planning/snapshot/spawn 用法')

  // planning 关 → 无 write_todos 提示
  const mwNoPlan = createUsageHintsMiddleware({ planning: false, subagent: true }, true)
  const segNoPlan = mwNoPlan.augmentPrompt?.(createState()) || ''
  assert(!/write_todos/.test(segNoPlan), 'planning 关 → 不注入 write_todos 提示')

  // hasWindowOps=false → 无 snapshot 提示
  const mwNoWin = createUsageHintsMiddleware({ planning: true, subagent: true }, false)
  const segNoWin = mwNoWin.augmentPrompt?.(createState()) || ''
  assert(!/restore_window_snapshot/.test(segNoWin), '无 window 工具 → 不注入 snapshot 提示')

  // 全关(planning/subagent 关 + 无 window)→ undefined(不增上下文)
  const mwNone = createUsageHintsMiddleware({ planning: false, subagent: false }, false)
  assert(mwNone.augmentPrompt?.(createState()) === undefined, '全关 → augmentPrompt 返回 undefined(不增上下文)')

  assert(mwFull.name === 'usageHints', '中间件 name=usageHints')
}

// ============ skills 文档源(doc:http 远程 / vfs 本地)============
console.log('\n[skills 文档源]')
{
  // resolveDocKind 判定来源
  assert(resolveDocKind('https://host/g.md') === 'http', 'resolveDocKind: https → http')
  assert(resolveDocKind('http://host/g.md') === 'http', 'resolveDocKind: http → http')
  assert(resolveDocKind('//host/g.md') === 'http', 'resolveDocKind: 协议相对 // → http')
  assert(resolveDocKind('vfs://skills/g.md') === 'vfs', 'resolveDocKind: vfs:// → vfs')
  assert(resolveDocKind('skills/g.md') === 'vfs', 'resolveDocKind: 裸路径 → vfs')
  assert(resolveDocKind('/skills/g.md') === 'vfs', 'resolveDocKind: /abs 路径 → vfs')

  // normalizeVfsPath 去前缀 + 规范化
  assert(normalizeVfsPath('vfs://skills/g.md') === 'skills/g.md', 'normalizeVfsPath: 去 vfs:// 前缀')
  assert(normalizeVfsPath('/skills/g.md') === 'skills/g.md', 'normalizeVfsPath: 去前导 /')
  assert(normalizeVfsPath('skills//g.md') === 'skills/g.md', 'normalizeVfsPath: 合并重复斜杠')

  // readSkillDoc vfs 分支(http 分支含 fetch,运行时手动验证)
  const vfsOk = await readSkillDoc('vfs://skills/g.md', () => '# 指南\n正文')
  assert(vfsOk.ok && vfsOk.content === '# 指南\n正文', 'readSkillDoc: vfs 文档存在 → 返回内容')

  const vfsMiss = await readSkillDoc('vfs://skills/missing.md', () => undefined)
  assert(!vfsMiss.ok && /未找到/.test(vfsMiss.error), 'readSkillDoc: vfs 文档不存在 → 未找到')

  const vfsNoInst = await readSkillDoc('skills/g.md')
  assert(!vfsNoInst.ok && /vfs 未启用/.test(vfsNoInst.error), 'readSkillDoc: vfs 路径但未注入 readVfs → 提示未启用')

  // load_skill 整体:doc 优先于 getContent
  const mw = createSkillsMiddleware([defineSkill({ name: 'doc-skill', description: 'd', doc: 'vfs://x.md' })], {
    readVfs: () => '文档正文',
  })
  const loadTool = byName(mw.tools || [])
  const r1 = await invoke(loadTool.load_skill, { name: 'doc-skill' })
  assert(/文档正文/.test(r1), 'load_skill: doc 源 → 读取文档注入(优先于 getContent)')
  const r2 = await invoke(loadTool.load_skill, { name: 'doc-skill' })
  assert(/已在本轮加载/.test(r2), 'load_skill: 重复加载 → 提示无需重复')
}

// ============ subagents 预声明(子 agent → use_<id> 委派工具)============
console.log('\n[subagents 预声明]')
{
  const mw = createSubagentsMiddleware(
    [
      { id: 'researcher', description: '调研专家' },
      { id: 'writer', description: '文案撰写' },
      { id: 'bad-id!', description: '不合法 id' },
      { id: 'researcher', description: '重复 id' },
    ],
    { llm: { apiKey: 'x' }, allTools: [] },
  )
  const names = (mw.tools as any[]).map((t) => t.name)
  assert(names.includes('use_researcher') && names.includes('use_writer'), 'subagents → 每个 config 生成 use_<id> 工具')
  assert(names.length === 2, '不合法 id + 重复 id 被跳过(剩 2 个)')
  const seg = mw.augmentPrompt?.(createState()) || ''
  assert(/use_researcher.*调研专家/.test(seg), 'augmentPrompt 注入子 agent 索引(use_<id>: desc)')
  assert(mw.name === 'subagents', '中间件 name=subagents')
}

// ============ 模型能力自适应 + token 估算 + offload 阈值 ============
console.log('\n[模型能力自适应]')
{
  // resolveModelCaps:声明优先覆盖表
  const declared = resolveModelCaps({ model: 'deepseek-chat', contextWindow: 1000000, maxOutputTokens: 4096 })
  assert(declared.contextWindow === 1000000 && declared.maxOutputTokens === 4096, 'resolveModelCaps: 声明优先覆盖表')

  // 表匹配
  const ds = resolveModelCaps({ model: 'deepseek-chat' })
  assert(ds.contextWindow === 131072 && ds.maxOutputTokens === 8192, 'resolveModelCaps: deepseek-chat 表匹配 128K/8K')
  const dsr = resolveModelCaps({ model: 'deepseek-reasoner' })
  assert(dsr.contextWindow === 65536, 'resolveModelCaps: deepseek-reasoner 64K')
  const dsv4 = resolveModelCaps({ model: 'deepseek-v4-flash' })
  assert(dsv4.contextWindow === 1048576 && dsv4.maxOutputTokens === 393216, 'resolveModelCaps: deepseek-v4 表匹配 1M/384K(flash 命中 v4 条目)')
  const gpt = resolveModelCaps({ model: 'gpt-4o' })
  assert(gpt.contextWindow === 131072 && gpt.maxOutputTokens === 16384, 'resolveModelCaps: gpt-4o 128K/16K')

  // 修正后的 2026 实测档(GLM/Kimi/Qwen 旧档曾失真)
  const glm52 = resolveModelCaps({ model: 'glm-5.2' })
  assert(glm52.contextWindow === 1048576 && glm52.maxOutputTokens === 65536, 'resolveModelCaps: glm-5.2 1M/64K')
  const glm45 = resolveModelCaps({ model: 'glm-4.5' })
  assert(glm45.contextWindow === 131072 && glm45.maxOutputTokens === 98304, 'resolveModelCaps: glm-4.5 128K/96K(输出非 8K)')
  const glm4 = resolveModelCaps({ model: 'glm-4' })
  assert(glm4.maxOutputTokens === 4096, 'resolveModelCaps: glm-4 4K 输出(与 4.5 区分)')
  const kimi = resolveModelCaps({ model: 'kimi-k2.6' })
  assert(kimi.contextWindow === 262144 && kimi.maxOutputTokens === 32768, 'resolveModelCaps: kimi-k2 256K/32K(非 128K/8K)')
  const qmax = resolveModelCaps({ model: 'qwen-max' })
  assert(qmax.contextWindow === 32768 && qmax.maxOutputTokens === 8192, 'resolveModelCaps: qwen-max 默认 32K/8K(128K 需申请,取保守)')

  // 缺省(未知模型 / 无 model)
  const unk = resolveModelCaps({ model: 'unknown-xyz' })
  assert(unk.contextWindow === 32768 && unk.maxOutputTokens === 4096, 'resolveModelCaps: 未知模型 → 缺省 32K/4K')
  assert(resolveModelCaps({}).contextWindow === 32768, 'resolveModelCaps: 无 model → 缺省')

  // estimateTokens 量级
  assert(estimateTokens('a'.repeat(1000)) === 250, 'estimateTokens: 1000 英文字符 → 250 token')
  assert(estimateTokens('中'.repeat(100)) === 150, 'estimateTokens: 100 中文字符 → 150 token')
  assert(estimateTokens('a'.repeat(400) + '中'.repeat(200)) === 400, 'estimateTokens: 混合 → 400 token')

  // offloadThresholdChars clamp [2000, 20000]
  assert(offloadThresholdChars(1000000) === 20000, 'offloadThreshold: 1M → 20000(上限)')
  assert(offloadThresholdChars(32768) === 2000, 'offloadThreshold: 32K → 2000(下限)')
  assert(offloadThresholdChars(131072) === 4588, 'offloadThreshold: 128K → 4588')

  // offloadPassThroughChars(vfs 不可用时的放行上限)clamp [offloadThreshold, 200000]
  assert(offloadPassThroughChars(1000000) === 200000, 'offloadPassThrough: 1M → 200000(上限,几乎不截断)')
  assert(offloadPassThroughChars(32768) === 22938, 'offloadPassThrough: 32K → 22938(~20%)')
  assert(offloadPassThroughChars(131072) === 91750, 'offloadPassThrough: 128K → 91750(~20%)')
  assert(offloadPassThroughChars(1000) >= offloadThresholdChars(1000), 'offloadPassThrough: 下限 ≥ offloadThreshold')
}

// ============ token 驱动压缩(大模型自适应)============
console.log('\n[token 驱动压缩]')
{
  const mkMsgs = (n: number) => {
    const out: any[] = []
    for (let i = 0; i < n; i++) {
      out.push({ role: 'user', content: 'u' + i + 'x'.repeat(300), timestamp: i * 2 })
      out.push({ role: 'assistant', content: 'a' + i + 'y'.repeat(300), timestamp: i * 2 + 1 })
    }
    return out
  }

  // token 模式:小历史不触发
  const cmSmall = useContextManager({ contextWindow: 100000 })
  const rSmall = await cmSmall.compress(mkMsgs(3))
  assert(rSmall.stats.triggered === false, 'token 模式:小历史不触发压缩')

  // token 模式:大历史触发,保留最近窗口
  const cmBig = useContextManager({ contextWindow: 800, summaryThresholdRatio: 0.5, windowRatio: 0.4 })
  const rBig = await cmBig.compress(mkMsgs(6))
  assert(rBig.stats.triggered === true, 'token 模式:大历史触发压缩')
  assert(rBig.stats.roundsSummarized >= 1, 'token 模式:至少摘 1 轮')
  assert(rBig.stats.compressedMessages < rBig.stats.originalMessages, 'token 模式:压缩后消息更少')
  assert(/token-window/.test(rBig.stats.strategy), 'token 模式:strategy 含 token-window')
  assert(rBig.messages[0].role === 'system', 'token 模式:首条为摘要 system 消息')

  // 轮数模式(无 contextWindow):现状兼容
  const cmRounds = useContextManager({ summaryThresholdRounds: 2, windowRounds: 1 })
  const rRounds = await cmRounds.compress(mkMsgs(4))
  assert(rRounds.stats.triggered === true, '轮数模式:超阈值触发')
  assert(/window/.test(rRounds.stats.strategy) && !/token/.test(rRounds.stats.strategy), '轮数模式:strategy 为 window+ 非 token')

  // 显式 contextWindow:0 关闭 token 模式回退轮数
  const cmZero = useContextManager({ contextWindow: 0, summaryThresholdRounds: 2, windowRounds: 1 })
  const rZero = await cmZero.compress(mkMsgs(4))
  assert(rZero.stats.triggered === true && !/token/.test(rZero.stats.strategy), 'contextWindow:0 → 回退轮数模式')
}

// ============ 压缩预设档位 resolveContextOptions ============
console.log('\n[context preset]')
{
  // auto 默认:LLM 摘要开、召回 3、阈值 0.5、窗口 0.4
  const auto = resolveContextOptions({}, 1_048_576)
  assert(auto.enableLLMSummary === true, 'preset auto: enableLLMSummary 默认 true')
  assert(auto.recallTopK === 3, 'preset auto: recallTopK=3')
  assert(auto.summaryThresholdRatio === 0.5, 'preset auto: threshold=0.5')
  assert(auto.windowRatio === 0.4, 'preset auto: window=0.4')
  assert(auto.contextWindow === 1_048_576, 'preset auto: contextWindow 回退模型表值')

  // conservative:更晚触发、保留更多、召回 2、关 LLM 摘要(省成本)
  const cons = resolveContextOptions({ contextPreset: 'conservative' }, 131072)
  assert(cons.enableLLMSummary === false, 'preset conservative: enableLLMSummary=false(零成本索引摘要)')
  assert(cons.summaryThresholdRatio === 0.7, 'preset conservative: threshold=0.7')
  assert(cons.windowRatio === 0.5, 'preset conservative: window=0.5')
  assert(cons.recallTopK === 2, 'preset conservative: recallTopK=2')

  // aggressive:更早触发、保留少、召回 5、LLM 摘要开
  const agg = resolveContextOptions({ contextPreset: 'aggressive' }, 32768)
  assert(agg.summaryThresholdRatio === 0.3, 'preset aggressive: threshold=0.3')
  assert(agg.windowRatio === 0.3, 'preset aggressive: window=0.3')
  assert(agg.recallTopK === 5, 'preset aggressive: recallTopK=5')
  assert(agg.enableLLMSummary === true, 'preset aggressive: enableLLMSummary=true')

  // 细参覆盖 preset:aggressive 但单独把召回调到 8
  const override = resolveContextOptions({ contextPreset: 'aggressive', contextOptions: { recallTopK: 8 } }, 32768)
  assert(override.recallTopK === 8, 'preset 覆盖:contextOptions.recallTopK 覆盖 preset')
  assert(override.summaryThresholdRatio === 0.3, 'preset 覆盖:未覆盖字段仍用 preset(aggressive 0.3)')

  // 细参覆盖 enableLLMSummary:conservative 关 LLM,但用户强制开
  const forceLlm = resolveContextOptions({ contextPreset: 'conservative', contextOptions: { enableLLMSummary: true } }, 131072)
  assert(forceLlm.enableLLMSummary === true, 'preset 覆盖:contextOptions.enableLLMSummary 强制覆盖 preset(false)')

  // contextWindow 显式 0:关闭 token 模式回退轮数(保留用户显式值)
  const zeroWin = resolveContextOptions({ contextOptions: { contextWindow: 0 } }, 1_048_576)
  assert(zeroWin.contextWindow === 0, 'preset:contextOptions.contextWindow=0 保留(回退轮数模式)')

  // contextOptions:false 视为空,用 preset 默认
  const falseOpts = resolveContextOptions({ contextOptions: false }, 131072)
  assert(falseOpts.enableLLMSummary === true && falseOpts.recallTopK === 3, 'contextOptions:false → 用 auto preset 默认')
}

// ============ 大 JSON 查询/搜索(query_window_prop / search_window_prop)============
console.log('\n[window query + search]')
{
  const data = {
    components: [
      { type: 'card', title: '商品卡片A', price: 50, stock: 3 },
      { type: 'list', title: '列表B', price: 200, stock: 0 },
      { type: 'card', title: '商品卡片C', price: 80, stock: 5 },
    ],
    meta: { total: 3, owner: { name: '张三', city: '北京' } },
  }
  ;(globalThis as any).window = { page: data }
  const tools = createWindowOps([
    { path: 'page', description: '页面', schema: z.any() },
  ])
  const t = byName(tools)

  // jpEval 纯函数:过滤数组(需先 .components 再过滤)
  let nodes = jpEval(data, '$.components[?(@.type=="card" && @.price<100)]')
  assert(nodes.length === 2 && nodes[0].index === 0 && nodes[1].index === 2, 'jpEval: 过滤 card 且 price<100 → 命中 index 0/2')

  // 递归找后代
  nodes = jpEval(data, '$..title')
  assert(nodes.length === 3 && nodes.some((n) => n.value === '商品卡片C'), 'jpEval: $..title 递归找全部 title')

  // 点号路径 + 索引
  nodes = jpEval(data, '$.components.1.title')
  assert(nodes.length === 1 && nodes[0].value === '列表B', 'jpEval: $.components.1.title 精确定位')

  // 通配
  nodes = jpEval(data, '$.components[*].type')
  assert(nodes.length === 3, 'jpEval: $.components[*].type 通配展开')

  // 工具包装:query_window_prop
  let r = await invoke(t['query_window_prop'], { path: 'page', expr: '$.components[?(@.stock==0)]' })
  let parsed = JSON.parse(r)
  assert(parsed.matched === 1 && parsed.results[0].index === 1, 'query_window_prop: stock==0 → 命中 index 1')

  // 工具包装:未注册属性拒绝
  r = await invoke(t['query_window_prop'], { path: 'nope', expr: '$' })
  assert(/未注册/.test(r), 'query_window_prop: 未注册属性被拒')

  // 工具包装:语法错误返回错误信息(不抛)
  r = await invoke(t['query_window_prop'], { path: 'page', expr: '$[?(@.x==' })
  assert(/JSONPath/.test(r), 'query_window_prop: 语法错误返回错误信息')

  // searchJson 子串
  let hits = searchJson(data, '卡片')
  assert(hits.length === 2, 'searchJson: substring "卡片" → 命中 2 个 title')

  // searchJson 模糊(记不清)
  hits = searchJson(data, '商品卡A', { mode: 'fuzzy', fuzzyThreshold: 2 })
  assert(hits.length >= 1, 'searchJson: fuzzy "商品卡A" 近似命中 "商品卡片A"')

  // searchJson 正则
  hits = searchJson(data, '^商品', { mode: 'regex' })
  assert(hits.length === 2, 'searchJson: regex ^商品 → 命中 2')

  // 工具包装:search_window_prop
  r = await invoke(t['search_window_prop'], { path: 'page', query: '北京' })
  parsed = JSON.parse(r)
  assert(parsed.matched === 1 && /北京/.test(parsed.results[0].value), 'search_window_prop: 命中 owner.city')

  // 工具数量:10 + 3 新工具 = 13
  assert(tools.length === 13, 'createWindowOps: 含 13 个工具(10 原有 + query/search/eval)')

  // eval_window_script 工具存在(node 无 Worker,仅校验装配 + 未注册拒绝)
  assert(!!t['eval_window_script'], 'eval_window_script 工具已装配')
  r = await invoke(t['eval_window_script'], { path: 'nope', script: 'data' })
  assert(/未注册/.test(r), 'eval_window_script: 未注册属性被拒')
}

// ============ 树形(递归 children)声明与读写 ============
console.log('\n[window tree: 递归 children]')
{
  // 递归 schema:节点含 children(自引用 z.lazy),passthrough 放行未声明字段
  const TreeNode: z.ZodType = z.object({
    id: z.number(),
    type: z.string(),
    text: z.string().optional(),
    children: z.array(z.lazy(() => TreeNode)).optional(),
  }).passthrough()

  ;(globalThis as any).window = {
    page: {
      components: [
        { id: 1, type: 'container', children: [
          { id: 2, type: 'card', text: 'A', children: [{ id: 4, type: 'card', text: 'A1' }] },
          { id: 3, type: 'card', text: 'B' },
        ] },
        { id: 5, type: 'card', text: 'C' },
      ],
    },
  }
  const tools = createWindowOps([
    { path: 'page.components', description: '组件树(递归 children)', schema: z.array(TreeNode) },
  ])
  const t = byName(tools)
  const w = (globalThis as any).window

  // 递归查所有 card(任意深度):$..*[?(@.type=="card")]
  let r = await invoke(t['query_window_prop'], { path: 'page.components', expr: '$..*[?(@.type=="card")]' })
  let parsed = JSON.parse(r)
  assert(parsed.matched === 3, '树查询: $..*[?(@.type=="card")] 递归找全部 3 个 card(任意深度)')
  // 父子同现不误判 [Circular]
  assert(!/\[Circular\]/.test(r), '树查询: 父子同现不被误判为 [Circular](各自独立序列化)')
  assert(parsed.results.some((x: any) => x.value.id === 4), '树查询: 最深 card#4 值完整返回(id=4)')

  // 增量改深层节点文本(jsonPath 定位)
  r = await invoke(t['edit_window_prop'], { path: 'page.components', op: 'set', jsonPath: '0.children.0.children.0.text', value: '"A1-改"' })
  assert(/已 edit/.test(r) && w.page.components[0].children[0].children[0].text === 'A1-改', 'edit: jsonPath 深层定位改子节点文本')

  // 递归 schema 校验:append 缺 id 的非法节点被拒
  r = await invoke(t['edit_window_prop'], { path: 'page.components', op: 'append', jsonPath: '0.children', value: '{"type":"bad"}' })
  assert(/SCHEMA_INVALID/.test(r), 'edit: 递归 schema 拒绝非法节点(缺 id),校验穿透到 children')

  // passthrough:节点可有未声明字段(extra/style)
  r = await invoke(t['edit_window_prop'], { path: 'page.components', op: 'merge', jsonPath: '1', value: '{"extra":"ok","style":{"color":"red"}}' })
  assert(w.page.components[1].extra === 'ok' && w.page.components[1].style?.color === 'red', 'edit: passthrough 保留未声明的额外字段')
}

// ============ 安全:merge 原型污染 + jsonPath 边界 ============
console.log('\n[security: merge 原型污染 + jsonPath 边界]')
{
  ;(globalThis as any).window = { page: { a: 1, items: ['x'] } }
  const tools = createWindowOps([
    { path: 'page', description: 'p', schema: z.object({ a: z.number(), items: z.array(z.string()) }).passthrough() },
  ])
  const t = byName(tools)
  const w = (globalThis as any).window

  // merge value 含 __proto__/constructor:不应污染 Object.prototype,不应给目标加 own 危险键
  let r = await invoke(t['edit_window_prop'], { path: 'page', op: 'merge', jsonPath: '', value: '{"__proto__":{"polluted":true},"constructor":{"x":1},"b":2}' })
  assert(w.page.b === 2, 'merge: 正常键 b 落地')
  assert(!Object.prototype.hasOwnProperty.call(w.page, '__proto__'), 'merge: 目标无 __proto__ own 属性')
  assert(!Object.prototype.hasOwnProperty.call(w.page, 'constructor'), 'merge: 目标无 constructor own 属性')
  assert(({} as any).polluted === undefined, 'merge: 未污染 Object.prototype(__proto__ 未生效)')
  assert(({} as any).x === undefined, 'merge: 未污染 Object.prototype(constructor 未生效)')

  // jsonPath 含 __proto__ 段:一律拒绝(PATH_UNSAFE)
  r = await invoke(t['edit_window_prop'], { path: 'page', op: 'set', jsonPath: '__proto__.polluted', value: 'true' })
  assert(/PATH_UNSAFE/.test(r), 'edit: jsonPath 含 __proto__ 被拒')
  assert(({} as any).polluted === undefined, 'edit: __proto__ jsonPath 未造成污染')

  // set 越界数组索引:schema 校验在副本上拦截稀疏空洞,不写入
  r = await invoke(t['edit_window_prop'], { path: 'page', op: 'set', jsonPath: 'items.5', value: '"y"' })
  assert(/SCHEMA_INVALID|PATCH_FAILED/.test(r), 'edit: set 越界数组索引被 schema 拦截(不产生稀疏空洞)')
  assert(w.page.items.length === 1 && w.page.items[0] === 'x', 'edit: 越界 set 未改动原数组')
}

// ============ ReAct 循环健壮性(收口综合 / afterAgent 兜底 / 逐轮 trim)============
console.log('\n[harness loop: 收口综合 + afterAgent 兜底 + 逐轮 trim]')
{
  // mock LLM:按 scripts 顺序返回响应(支持 tool_calls 或纯文本);不绑工具(allTools 空时 createAgent 不调 bindTools)
  class MockLLM extends BaseChatModel {
    scripts: Array<{ content?: string; toolCalls?: Array<{ id?: string; name: string; args?: any }> }>
    idx = 0
    constructor(scripts: any[]) { super({}); this.scripts = scripts }
    _llmType(): string { return 'mock' }
    async *_streamResponseChunks(_messages: any, _options: any): AsyncGenerator<any> {
      const s = this.scripts[this.idx++] ?? { content: '完成。' }
      const tcc = (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: JSON.stringify(tc.args ?? {}), index: i }))
      yield { text: s.content ?? '', message: new AIMessageChunk({ content: s.content ?? '', tool_call_chunks: tcc }), generationInfo: {} }
    }
    async _generate(_messages: any, _options: any): Promise<any> {
      const s = this.scripts[this.idx++] ?? { content: '完成。' }
      const msg = new AIMessage({ content: s.content ?? '', tool_calls: (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: tc.args ?? {} })) })
      return { generations: [{ text: s.content ?? '', message: msg }], llmOutput: {} }
    }
  }

  // ① 收口综合:工具轮耗尽(末尾是 ToolMessage)→ 强制再跑一轮综合,返回最终回答而非"请简化问题"
  const mockA = new MockLLM([
    { toolCalls: [{ name: 'noop', args: {} }] },
    { toolCalls: [{ name: 'noop', args: {} }] },
    { content: '最终综合回答' },
  ])
  const agentA = createAgent({ llm: mockA as any, maxToolRounds: 2, maxRetries: 0 })
  let finalA = ''
  await agentA.stream([{ role: 'user', content: '做点事', timestamp: Date.now() }], (e) => { if (e.type === 'done') finalA = e.content }, undefined)
  assert(finalA === '最终综合回答', '收口综合:工具轮耗尽后强制再跑一轮综合,返回最终回答(非"请简化问题")')

  // ② afterAgent 兜底:模型抛错时 stream reject,但 afterAgent 经 finally 仍执行(中间件清理不跳过)
  class ThrowingLLM extends MockLLM {
    async *_streamResponseChunks(): AsyncGenerator<any> { throw new Error('boom') }
    async _generate(): Promise<any> { throw new Error('boom') }
  }
  let afterAgentRan = false
  const mw: Middleware = { name: 'rec', afterAgent: () => { afterAgentRan = true; return undefined } }
  const agentB = createAgent({ llm: new ThrowingLLM([]) as any, middleware: [mw], maxToolRounds: 5, maxRetries: 0 })
  let threwB = false
  try { await agentB.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined) } catch { threwB = true }
  assert(threwB, '异常路径:模型抛错时 stream 仍 reject(错误不被吞)')
  assert(afterAgentRan, '异常路径:afterAgent 经 finally 兜底仍执行(中间件清理不跳过)')

  // ②+ 压缩统计捕获:createAgent 在 compressInput 后把 stats 写入 state.lastCompression
  let capturedStats: any = undefined
  const compressMw: Middleware = {
    name: 'fake-compress',
    compressInput: async (msgs) => ({ messages: msgs, stats: { triggered: true, roundsTotal: 4, roundsSummarized: 2, roundsRecalled: 1, originalMessages: 8, compressedMessages: 5, strategy: 'token-window+llm_summary' } }),
    afterAgent: (st) => { capturedStats = st.lastCompression },
  }
  const agentC = createAgent({ llm: new MockLLM([{ content: 'ok' }]) as any, middleware: [compressMw], maxToolRounds: 2, maxRetries: 0 })
  await agentC.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined)
  assert(capturedStats && capturedStats.triggered === true && capturedStats.strategy === 'token-window+llm_summary', '压缩统计:compressInput stats 写入 state.lastCompression(afterAgent 可观测)')

  // ③ 逐轮 trim 纯函数:tool 结果累积超放行上限 → 最早 ToolMessage 压缩为占位摘要(保留 tool_call_id)
  const big = 'x'.repeat(1000)
  const msgs = [new SystemMessage('sys'), new HumanMessage('q'), new ToolMessage({ tool_call_id: '1', content: big }), new ToolMessage({ tool_call_id: '2', content: big })]
  const out = trimContextIfNeededImpl(msgs, 1500)
  assert(out.length === 4, 'trim: 消息数不变(只压内容不删消息)')
  const total = out.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
  assert(total < 2000, 'trim: 总字符从 ~2004 降到阈值附近(<2000)')
  assert(out[0].content === 'sys' && out[1].content === 'q', 'trim: system/human 原样保留')
  assert(/已自动压缩/.test(out[2].content as string), 'trim: 最早 ToolMessage 压缩为占位摘要')
  assert((out[2] as any).tool_call_id === '1', 'trim: 保留 tool_call_id(结构完整,模型仍能对应)')
  const out2 = trimContextIfNeededImpl(msgs, 5000)
  assert(out2 === msgs, 'trim: 未超阈值原样返回同引用')

  // keep 自适应:小阈值保留首 100,大阈值保留首 400(clamp)
  const smallKeep = trimContextIfNeededImpl(msgs, 1500)
  assert(/保留首 100/.test(smallKeep[2].content as string), 'trim: keep 自适应(小阈值→100)')
  const bigMsgs = [new SystemMessage('s'), new HumanMessage('q'), new ToolMessage({ tool_call_id: '1', content: 'x'.repeat(300000) })]
  const bigKeep = trimContextIfNeededImpl(bigMsgs, 200000)
  assert(/保留首 400/.test(bigKeep[2].content as string), 'trim: keep 自适应(大阈值→400)')
}

console.log(`\n==== ${passed} passed, ${failed} failed ====`)
if (failed > 0) process.exit(1)
