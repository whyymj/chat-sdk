import { detectGarbledToolCall } from '../../harness/createAgent'
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
}
