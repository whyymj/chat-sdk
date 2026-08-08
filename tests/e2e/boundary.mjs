// 边界:checkpoint 空操作 / messages 初始 / id 不传 warn / mount 重复 + unmount 后 inspect
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:boundary] restoreLastCheckpoint / listCheckpoints:无 checkpoint 时空操作')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-ckpt', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.restoreLastCheckpoint() === false, '无 checkpoint → restoreLastCheckpoint 返回 false')
    assert(Array.isArray(sdk.listCheckpoints()) && sdk.listCheckpoints().length === 0, '无 checkpoint → listCheckpoints 返回空数组')
    sdk.unmount()
  }

  console.log('[e2e:boundary] messages 响应式数组:初始为空数组')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-msgs', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(Array.isArray(sdk.messages) && sdk.messages.length === 0, 'messages 初始为空数组')
    sdk.unmount()
  }

  console.log('[e2e:boundary] 错误场景:id 不传 → warn + 生成随机 id')
  {
    const sdk = createChatSdk({ ui: false, storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const info = sdk.inspect()
    assert(typeof info.id === 'string' && info.id.length > 0, 'id 不传 → 生成随机 id(非空)')
    sdk.unmount()
  }

  console.log('[e2e:boundary] mount 边界:重复 mount 安全 / unmount 后 inspect 仍可调')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-mount-bound', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try { await sdk.mount() } catch (e) { threw = true }
    assert(!threw, '重复 mount 不抛错(幂等安全)')
    sdk.unmount()
    let inspectOk = true
    try { sdk.inspect() } catch { inspectOk = false }
    assert(inspectOk, 'unmount 后 inspect() 仍可调(返回静态信息)')
  }

  console.log('[e2e:boundary] hide/show:不卸载保留 agent,hide 后 mount 直接 show 不重建')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-hide-show', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    // headless 无 DOM,hide/show 不操作 DOM 但应不抛错;模拟 drawer 关闭保留 agent 的语义
    let threw = false
    try { sdk.hide(); sdk.show(); } catch { threw = true }
    assert(!threw, 'hide()/show() 不抛错(headless 无 DOM 安全)')
    // hide 后再 mount 应幂等(已挂载则 show,不重建)
    let threw2 = false
    try { await sdk.mount() } catch { threw2 = true }
    assert(!threw2, 'hide 后再 mount 幂等安全(已挂载则 show 不重建)')
    sdk.unmount()
  }

  console.log('[e2e:boundary] harden-context-resilience:小窗口模型(<200K)启动 → throw')
  {
    let threw = false
    try {
      createChatSdk({ ui: false, id: 'e2e-smallwin', storage: 'memory', llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'deepseek' }, capabilities: MIN_CAPS })
    } catch { threw = true }
    assert(threw, 'createChatSdk({model:deepseek 128K}) → throw(<200K 硬约束)')
    // 声明 contextWindow ≥200K 则放行(声明优先于查表)
    let threw2 = false
    try {
      const ok = createChatSdk({ ui: false, id: 'e2e-smallwin-ok', storage: 'memory', llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'deepseek', contextWindow: 200000 }, capabilities: MIN_CAPS })
      ok.unmount()
    } catch { threw2 = true }
    assert(!threw2, 'createChatSdk({model:deepseek + contextWindow:200000 声明}) → 放行(声明优先)')
  }

  console.log('[e2e:boundary] harden-context-resilience:setLlm 切小窗口模型(<200K)→ throw')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setllm-small', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    let threw = false
    try { sdk.setLlm({ apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'gpt-4o' }) } catch { threw = true }
    assert(threw, 'setLlm({model:gpt-4o 128K 无声明}) → throw(<200K 硬约束)')
    sdk.unmount()
  }

  console.log('[e2e:boundary] harden-context-resilience:setLlm 声明 ≥200K 窗口 → 放行(声明优先于查表)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setllm-ok', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try { sdk.setLlm({ apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'deepseek', contextWindow: 500000 }) } catch { threw = true }
    assert(!threw, 'setLlm({model:deepseek + contextWindow:500000 声明}) → 放行(声明优先,不 throw)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
