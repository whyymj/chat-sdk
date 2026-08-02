/**
 * sec-39:环境探查工具 inspect_env + safeSerialize + getEnvSummary(排查调试默认工具)
 * - safeSerialize:基本类型/截断/function/symbol/bigint/array/object/深度/循环/DOM/getter
 * - getEnvSummary:结构(location/navigator/viewport/document);传 mock win
 * - inspect_env:invoke key 读 window 属性 / 不存在 / 无参环境摘要
 */
import { inspectEnvTool, safeSerialize, getEnvSummary } from '../../tools/envTool'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== safeSerialize 纯函数 =====
  console.log('\n[inspect_env · safeSerialize]')
  // ✓ 基本类型直传(不变形)
  assert(safeSerialize('hello') === 'hello', '✓ safeSerialize → string 直传')
  assert(safeSerialize(42) === 42, '✓ safeSerialize → number 直传')
  assert(safeSerialize(true) === true, '✓ safeSerialize → boolean 直传')
  assert(safeSerialize(null) === null && safeSerialize(undefined) === undefined, '✓ safeSerialize → null/undefined 直传')

  // ✓ string 超长截断
  const truncated = safeSerialize('a'.repeat(3000), 3, 100) as string
  assert(typeof truncated === 'string' && truncated.endsWith('…(已截断)') && truncated.length === 100 + '…(已截断)'.length, '✓ safeSerialize → string 超 maxLen 截断 + 标记')

  // ✓ function / symbol / bigint 标记化(不展开)
  assert(safeSerialize(function foo() {}) === '[Function: foo]', '✓ safeSerialize → function 标记名')
  assert(safeSerialize(() => {}) === '[Function: anonymous]', '✓ safeSerialize → 匿名函数标记')
  assert(safeSerialize(Symbol('x')) === 'Symbol(x)', '✓ safeSerialize → symbol toString')
  assert(safeSerialize(123n) === '123n', '✓ safeSerialize → bigint 加 n 后缀')

  // ✓ array 递归 + 超 100 截断
  const arr = safeSerialize([1, 2, 3]) as unknown[]
  assert(Array.isArray(arr) && arr.length === 3 && arr[0] === 1, '✓ safeSerialize → array 递归序列化')
  const bigArr = safeSerialize(Array.from({ length: 150 }, (_, i) => i)) as unknown[]
  assert(Array.isArray(bigArr) && bigArr.length === 101 && String(bigArr[100]).includes('共 150'), '✓ safeSerialize → array >100 截断 + 总数提示')

  // ✓ object 超 50 键截断
  const bigObj: Record<string, number> = {}
  for (let i = 0; i < 60; i++) bigObj[`k${i}`] = i
  const bigSer = safeSerialize(bigObj) as Record<string, unknown>
  assert(Object.keys(bigSer).length === 51 && typeof bigSer['…'] === 'string', '✓ safeSerialize → object >50 键截断(51 含 … 提示)')

  // ✓ 嵌套深度用尽 → 截断
  const deepSer = safeSerialize({ a: { b: { c: { d: 1 } } } }, 1) as Record<string, unknown>
  assert(JSON.stringify(deepSer).includes('(对象,已截断)'), '✓ safeSerialize → 深度用尽截断')

  // ✓ 循环引用 → [Circular](不栈溢出)
  const cyclic: Record<string, unknown> = { name: 'root' }
  cyclic.self = cyclic
  const cyclicSer = safeSerialize(cyclic) as Record<string, unknown>
  assert(cyclicSer.self === '[Circular]', '✓ safeSerialize → 循环引用标记 [Circular]')

  // ✓ DOM-like → 标记(不展开)
  assert(safeSerialize({ tagName: 'DIV', nodeType: 1 }) === '[Element: <div>]', '✓ safeSerialize → DOM 元素标记 tag')
  assert(safeSerialize({ nodeType: 3, nodeName: '#text' }) === '[Node: #text]', '✓ safeSerialize → DOM 节点标记 nodeName')

  // ✓ getter 抛错 → 兜底(不中断)
  const withBadGetter: Record<string, unknown> = {}
  Object.defineProperty(withBadGetter, 'x', { get() { throw new Error('boom') }, enumerable: true })
  assert((safeSerialize(withBadGetter) as Record<string, unknown>).x === '(getter 抛错)', '✓ safeSerialize → getter 抛错兜底')

  // ===== getEnvSummary(传 mock win) =====
  console.log('\n[inspect_env · getEnvSummary]')
  const mockWin = {
    location: { href: 'https://test.com/x', origin: 'https://test.com', pathname: '/x' },
    navigator: { userAgent: 'TestUA', language: 'zh-CN', onLine: true },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
    document: { title: 'T', readyState: 'complete', characterSet: 'UTF-8' },
  } as unknown as Window & typeof globalThis
  const sum = getEnvSummary(mockWin) as Record<string, Record<string, unknown>>
  assert(sum.location.href === 'https://test.com/x' && sum.navigator.userAgent === 'TestUA', '✓ getEnvSummary → location/navigator 读取')
  assert(sum.viewport.innerWidth === 1280 && sum.viewport.devicePixelRatio === 2, '✓ getEnvSummary → viewport 读取')
  assert((sum.document as Record<string, unknown>).title === 'T' && (sum.document as Record<string, unknown>).readyState === 'complete', '✓ getEnvSummary → document 读取')

  // ===== inspect_env 工具 invoke =====
  // 重设全局 window 确保自包含(前序 sec-17 等可能把 window 改成 globalThis,无 app 键)
  ;(globalThis as any).window = { app: { theme: 'light', count: 0 } }
  console.log('\n[inspect_env · tool invoke]')
  // ✓ key 读 window 属性
  const appParsed = JSON.parse(await invoke(inspectEnvTool, { key: 'app' }))
  assert(appParsed.exists === true && appParsed.type === 'object', '✓ inspect_env({key:"app"}) → exists + type=object')
  assert(appParsed.value.theme === 'light' && appParsed.value.count === 0, '✓ inspect_env({key:"app"}) → 读到 window.app 值')

  // ✓ key 不存在
  const nope = JSON.parse(await invoke(inspectEnvTool, { key: 'nope_not_there' }))
  assert(nope.exists === false, '✓ inspect_env({key:不存在}) → exists:false')

  // ✓ 无参 → 环境摘要(含 location/navigator/viewport/document 四段)
  const envNoArg = JSON.parse(await invoke(inspectEnvTool, {}))
  assert(envNoArg.location !== undefined && envNoArg.navigator !== undefined && envNoArg.viewport !== undefined && envNoArg.document !== undefined, '✓ inspect_env() 无参 → 返回四段环境摘要')
}
