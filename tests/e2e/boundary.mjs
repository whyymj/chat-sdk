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

  return { pass: ctx.pass, fail: ctx.fail }
}
