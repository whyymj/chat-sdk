import { z } from 'zod'
import { createWindowOps } from '../../tools/windowOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineWindowToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../../harness/skills'
import { createPermissionsMiddleware } from '../../harness/permissions'
import { createMemoryMiddleware } from '../../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { runPool } from '../../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../../harness/verify'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../../harness/checkpoint'
import { extractText } from '../../mcp/client'
import { createInitialState as createState } from '../../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../../utils/modelCaps'
import { useContextManager } from '../../composables/useContextManager'
import { resolveContextOptions } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/windowQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// windowOps:edit + 快照
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
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
}
