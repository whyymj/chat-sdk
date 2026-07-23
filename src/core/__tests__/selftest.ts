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
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../backends/storage'

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

console.log(`\n==== ${passed} passed, ${failed} failed ====`)
if (failed > 0) process.exit(1)
