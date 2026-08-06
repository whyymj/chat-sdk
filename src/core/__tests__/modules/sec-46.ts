import type { TestCtx } from './_ctx'
import { detectGarbledToolCall, parseGarbledToolCalls } from '../../harness/createAgent'

/**
 * sec-46 —— DSML/伪 XML 工具调用解析收紧白盒单测(fix-write-safety-bypass P0-2)。
 * detectGarbledToolCall/parseGarbledToolCalls 此前无白盒单测;收紧「守卫标记必择 + 围栏剥离」后补。
 *
 * 现状 bug:纯文本/围栏内 `<invoke name=>` 无 DeepSeek 守卫标记也被 parseGarbledToolCalls 解析
 * → createAgent 直接补 toolCalls 执行(数据被写入)。收紧后:无守卫 → 返回 null 交 garbled-retry 回灌。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-46] DSML/伪 XML 工具调用解析收紧(fix-write-safety-bypass P0-2)')

  // ① 代码围栏内的 <invoke> 示例 → 剥离围栏后不解析(null,不当真执行)
  const fenced = '示例如下:\n```xml\n<invoke name="set_data"><parameter name="jsonPath">title</parameter><parameter name="value">x</parameter></invoke>\n```\n仅供参考'
  assert(parseGarbledToolCalls(fenced) === null, 'P0-2 → ✅ 代码围栏内 <invoke> 示例不解析(剥离围栏 → null,不当真执行)')

  // ② 纯文本 <invoke>(无守卫标记)→ null(不自动执行,降级 garbled-retry 回灌)
  const plain = '<invoke name="set_data"><parameter name="jsonPath">title</parameter><parameter name="value">x</parameter></invoke>'
  assert(parseGarbledToolCalls(plain) === null, 'P0-2 → ✅ 纯文本 <invoke>(无 DeepSeek 守卫标记)不自动执行 → null(降级 garbled-retry)')

  // ③ 带强守卫标记(<｜tool_calls｜>)的 DSML → 正常解析执行(免重试能力保留,不回归)
  const guarded = '<｜tool_calls｜>\n<invoke name="set_data"><parameter name="jsonPath">title</parameter><parameter name="value">x</parameter></invoke>'
  const pg = parseGarbledToolCalls(guarded)
  assert(pg !== null && pg.length === 1 && pg[0].name === 'set_data', 'P0-2 → ✅ 带守卫标记(<｜tool_calls｜>)的 DSML 正常解析执行(免重试保留)')
  assert(pg !== null && (pg[0].args as any).jsonPath === 'title' && (pg[0].args as any).value === 'x', 'P0-2 → 守卫 DSML 参数正确解析(jsonPath/value)')

  // ④ DeepSeek 变体守卫标记(<｜tool｜>)→ 放行解析
  const guarded2 = '<｜tool｜><invoke name="write"><parameter name="patch">{"op":"set","jsonPath":"a"}</parameter></invoke>'
  const pg2 = parseGarbledToolCalls(guarded2)
  assert(pg2 !== null && pg2.length === 1 && pg2[0].name === 'write', 'P0-2 → ✅ 变体守卫标记(<｜tool｜>)放行解析')

  // ⑤ detectGarbledToolCall 保持宽松(认 <invoke> 进 garbled 流程 → 配合 parse 返回 null 走 garbled-retry 回灌,不静默丢弃)
  assert(detectGarbledToolCall(plain) === true, 'P0-2 → detectGarbledToolCall 仍认 <invoke>(进 garbled-retry 回灌,而非当普通文本静默丢弃)')
  assert(detectGarbledToolCall('普通回复,无任何工具标记') === false, 'P0-2 → detectGarbledToolCall 普通文本返 false')
}
