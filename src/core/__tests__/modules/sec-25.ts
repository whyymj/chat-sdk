import { detectGarbledToolCall, parseGarbledToolCalls } from '../../harness/createAgent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  assert(detectGarbledToolCall('<｜tool_calls｜>') === true, 'DeepSeek tool_calls tag detected')
  assert(detectGarbledToolCall('<invoke name="set_data">') === true, 'invoke name tag detected')
  assert(detectGarbledToolCall('<tool_call>') === true, 'tool_call tag detected')
  assert(detectGarbledToolCall('<function_call>') === true, 'function_call tag detected')
  // DeepSeek-v4 长 tool-call 链下退化的 DSML / tool 段标记(实测 ?deep=1 暴露,此前漏匹配致静默截断)
  assert(detectGarbledToolCall('<｜｜DSML｜｜>invoke') === true, 'DeepSeek-v4 DSML tag detected(长 tool-call 链退化标记)')
  assert(detectGarbledToolCall('<｜｜DSML｜｜>') === true, 'DSML tag alone detected')
  assert(detectGarbledToolCall('<｜tool｜>') === true, 'DeepSeek tool segment tag detected')
  assert(detectGarbledToolCall('<｜tool_begin｜>') === true, 'DeepSeek tool_begin tag detected')
  assert(detectGarbledToolCall('') === false, 'empty content not garbled')
  assert(detectGarbledToolCall('normal reply text') === false, 'normal text not garbled')
  assert(detectGarbledToolCall('please use set_data to update') === false, 'normal mention of tool name not garbled')
  assert(detectGarbledToolCall('已为你把标题改成「测试」。') === false, 'normal Chinese reply not garbled')

  // ===== parseGarbledToolCalls(#95 升级:检测重试 → 解析为 tool_call) =====
  // 简单 invoke + 参数
  const p1 = parseGarbledToolCalls('<invoke name="read"><parameter name="jsonPath">title</parameter></invoke>')
  assert(p1 !== null && p1.length === 1 && p1[0].name === 'read', '✓ parseGarbledToolCalls → 解析 invoke + 单 tool_call')
  assert(p1![0].args.jsonPath === 'title', '✓ parseGarbledToolCalls → 参数 jsonPath=title(string)')

  // DSML 变体(<｜｜DSML｜｜invoke> + <｜｜DSML｜｜parameter>)+ 值类型(boolean/JSON)
  const p2 = parseGarbledToolCalls('<｜｜DSML｜｜invoke name="write"><｜｜DSML｜｜parameter name="dryRun" string="false">true</｜｜DSML｜｜parameter><｜｜DSML｜｜parameter name="value" string="false">{"title":"x"}</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke>')
  assert(p2 !== null && p2[0].name === 'write', '✓ parseGarbledToolCalls → DSML 变体解析(DeepSeek-v4 格式)')
  assert(p2![0].args.dryRun === true, '✓ parseGarbledToolCalls → 参数值 boolean(true)')
  assert((p2![0].args.value as any).title === 'x', '✓ parseGarbledToolCalls → 参数值 JSON 对象(parse)')

  // 截断(参数未闭合,值不完整) → null(交重试,不补错值)
  const p3 = parseGarbledToolCalls('<invoke name="write"><parameter name="value">{"title":"x"')
  assert(p3 === null, '✓ parseGarbledToolCalls → 截断(参数未闭合) → null(交重试,不补错值)')

  // 多 invoke → 多 tool_call
  const p4 = parseGarbledToolCalls('<invoke name="read"><parameter name="jsonPath">a</parameter></invoke><invoke name="write"><parameter name="value">1</parameter></invoke>')
  assert(p4 !== null && p4.length === 2 && p4[0].name === 'read' && p4[1].name === 'write', '✓ parseGarbledToolCalls → 多 invoke(2 个 tool_call)')

  // 非 garbled → null(不误解析)
  assert(parseGarbledToolCalls('normal text 无工具调用') === null, '✓ parseGarbledToolCalls → 非 garbled → null')
  assert(parseGarbledToolCalls('') === null, '✓ parseGarbledToolCalls → 空 → null')
}
