// automation(Phase 4 无人值守自动化):capabilities.automation 反映 + budget 中间件装载 + batch API + 配置项 + opt-in 边界
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

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
