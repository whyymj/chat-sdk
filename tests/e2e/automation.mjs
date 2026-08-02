// automation(Phase 4 无人值守自动化):capabilities.automation 反映 + budget 中间件装载 + batch API + 配置项 + opt-in 边界
// + stub model 运行时测(quality-hardening §1):验证 stub 基建可驱动真实 agent ReAct 循环(后续 budget/错误恢复测的前置)
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:automation] stub model 驱动 agent ReAct 循环(工具调用→文本终止,验证 chunk/tool_calls 解析)')
  {
    // stub model 是后续 budget/错误恢复/subagent-writable/todos-tier 运行时测的基建,先验证它能驱动真实 agent 循环。
    // 队列:[调 echo 工具] → [纯文本终止];若 chunk tool_calls 解析失败,首轮拿到纯文本即终止 → echo 不执行 → 测试失败
    let echoCalled = null
    const echo = defineTool({
      name: 'echo',
      description: '回声工具(测试用)',
      schema: z.object({ msg: z.string() }),
      handler: async ({ msg }) => { echoCalled = msg; return `echo:${msg}` },
    })
    const model = stubModel(
      { toolCalls: [{ name: 'echo', args: { msg: 'hi' } }] },
      { text: '已完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-stub-verify', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo],
    })
    await sdk.mount()
    await sdk.send('调用 echo')
    assert(echoCalled === 'hi', `stub tool_calls chunk 解析正确 → echo 工具执行(args.msg="hi"),实际 echoCalled=${echoCalled}`)
    assert(model.calls >= 2, `stub 驱动 ≥2 轮 model 调用(工具调用轮 + 文本终止轮),实际 ${model.calls}`)
    sdk.unmount()
  }

  console.log('[e2e:automation] budget 资源预算闸端到端(stub 注入大 usage → 第二轮拦截 + emit BUDGET_EXCEEDED)')
  {
    // 时序:第一轮 wrapModelCall 检查 usage=0(放行)→ model 调用返回 toolCalls + usage.total_tokens=1000
    //      → afterModel 累加 usage=1000 → 工具执行 → 第二轮 wrapModelCall 检查 1000 > tokenBudget(500)
    //      → 返回 aborted(不调 model,model.calls 不增)+ emit BUDGET_EXCEEDED → agent 停止
    const events = []
    const model = stubModel(
      { toolCalls: [{ name: 'echo', args: { msg: 'x' } }], usage: { total_tokens: 1000 } },
      { text: '不该执行到第二轮' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-budget', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, automation: true }, tokenBudget: 500,
      tools: [defineTool({ name: 'echo', description: '测试用', schema: z.object({ msg: z.string() }), handler: async () => 'ok' })],
    })
    await sdk.mount()
    const off = sdk.hook((e) => events.push(e))
    await sdk.send('跑任务')
    const budgetErr = events.find((e) => e.type === 'error' && (e.code === 'BUDGET_EXCEEDED' || e.payload?.code === 'BUDGET_EXCEEDED'))
    assert(budgetErr, 'budget 超限 → emit BUDGET_EXCEEDED error 事件(资源预算闸端到端触发)')
    assert(model.calls === 1, `budget 在第二轮 model 调用前拦截(第一轮累计 usage=1000 > 上限 500,第二轮不调 model),实际 model.calls=${model.calls}`)
    off(); sdk.unmount()
  }

  console.log('[e2e:automation] capabilities.automation:true → budget 中间件装载 + batch API 暴露')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-on', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, tokenBudget: 50000, timeBudgetMs: 60000, maxAutoRetries: 2,
    })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(mws.includes('budget'), 'capabilities.automation:true → inspect().middleware 含 budget(资源预算闸装载)')
    assert(typeof sdk.batch === 'function', 'sdk.batch 为 function(批处理 API 暴露)')
    sdk.unmount()
  }

  console.log('[e2e:automation] 默认(未传 automation)→ budget 不装载(opt-in 默认关,no-op)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(!mws.includes('budget'), '未传 automation → middleware 不含 budget(opt-in 最远,默认关)')
    assert(typeof sdk.batch === 'function', 'sdk.batch 仍暴露(方法常驻;未开 checkpoint 时每任务前 save 跳过)')
    sdk.unmount()
  }

  console.log('[e2e:automation] automation + checkpoint 同开 → 两中间件均装载(batch 每任务前 checkpoint)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-cp', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, checkpoint: true, tokenBudget: 100000,
    })
    await sdk.mount()
    const mws = sdk.inspect().middleware
    assert(mws.includes('budget') && mws.includes('checkpoint'), 'automation + checkpoint 同开 → budget + checkpoint 中间件均装载')
    sdk.unmount()
  }

  console.log('[e2e:automation] automation:false 显式关 → budget 不装载(等同默认关)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-false', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: false }, tokenBudget: 50000,
    })
    await sdk.mount()
    assert(!sdk.inspect().middleware.includes('budget'), 'automation:false 显式关 → budget 不装载(=== true 才开)')
    sdk.unmount()
  }

  console.log('[e2e:automation] maxAutoRetries 配置 + automation → mount 成功(配置项生效不抛)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-auto-retry', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, automation: true }, maxAutoRetries: 3,
    })
    await sdk.mount()
    assert(sdk.inspect().middleware.includes('budget'), 'maxAutoRetries 配置 + automation → mount 成功(无人值守错误恢复配置项)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
