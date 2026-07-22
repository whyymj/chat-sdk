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
import { offloadLargeResult } from '../utils/offload'
import { createVfs, createVfsTools } from '../backends/vfs'
import { createTodosMiddleware } from '../harness/todos'
import { createSkillsMiddleware, defineSkill } from '../harness/skills'
import { createPermissionsMiddleware } from '../harness/permissions'
import { createMemoryMiddleware } from '../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel } from '../harness/middleware'
import { createInitialState as createState } from '../harness/state'

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
  assert(/校验失败/.test(r) && w.app.theme === 'dark', 'set 非法值被 schema 校验拦截(不写入)')

  r = await invoke(t['set_window_prop'], { path: 'app.unknown', value: '1' })
  assert(/未在注册表中声明/.test(r), 'set 未注册属性被范围控制拒绝')

  r = await invoke(t['get_window_prop'], { path: 'app' })
  assert(/theme/.test(r), 'get 祖先路径(page)可读整体')

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
  assert(/校验失败/.test(r), 'set 类型不符被校验拦截')
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
  assert(/校验失败/.test(r) && w.app.cfg.a === beforeA, 'edit 校验失败 live 未变')

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

  // 大结果 + vfs 不可用 → 硬截断兜底
  const truncated = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000 })
  assert(/已截断/.test(truncated) && truncated.length < big.length, 'vfs 不可用 → 硬截断兜底')
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

console.log(`\n==== ${passed} passed, ${failed} failed ====`)
if (failed > 0) process.exit(1)
