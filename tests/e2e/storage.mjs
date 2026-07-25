// 存储:switchSession(开/未开/指定 id) / 后端 session/local / 对象配置 / shareContext 开/关
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, makeStore } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:storage] switchSession:storage 未开启抛错 / 开启返回新 id')
  {
    const sdkNoStorage = createChatSdk({ ui: false, id: 'e2e-switch-nostore', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkNoStorage.mount()
    let threw = false
    try { await sdkNoStorage.switchSession() } catch { threw = true }
    assert(threw, 'storage 未开启 → switchSession 抛错')
    sdkNoStorage.unmount()

    const sdk = createChatSdk({ ui: false, id: 'e2e-switch-ok', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const newId = await sdk.switchSession()
    assert(typeof newId === 'string' && newId.length > 0, 'storage 开启 → switchSession 返回新 id(string)')
    const fixedId = await sdk.switchSession('my-session-123')
    assert(fixedId === 'my-session-123', 'switchSession(id) 返回该 id')
    sdk.unmount()
  }

  console.log('[e2e:storage] 后端:session/local stub mount 成功')
  {
    if (!globalThis.sessionStorage) globalThis.sessionStorage = makeStore()
    if (!globalThis.localStorage) globalThis.localStorage = makeStore()
    for (const backend of ['session', 'local']) {
      const sdk = createChatSdk({ ui: false, id: `e2e-store-${backend}`, storage: backend, llm: FAKE_LLM, capabilities: MIN_CAPS })
      await sdk.mount()
      assert(sdk.inspect().id === `e2e-store-${backend}`, `storage:${backend} → mount 成功`)
      sdk.unmount()
    }
  }

  console.log('[e2e:storage] storage 配置对象形式:{ backend, maxBytes }')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-storage-obj', storage: { backend: 'memory', maxBytes: 1 * 1024 * 1024 }, llm: FAKE_LLM, capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().id === 'e2e-storage-obj', 'storage 对象配置 {backend,maxBytes} → mount 成功')
    sdk.unmount()
  }

  console.log('[e2e:storage] shareContext:true 同 id 两实例共享 messages 数组')
  {
    const sdkA = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
    await sdkA.mount()
    const sdkB = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
    await sdkB.mount()
    assert(sdkA.messages === sdkB.messages, 'shareContext:true 同 id → 两实例 messages 为同一数组引用')
    sdkA.unmount()
    sdkB.unmount()
  }

  console.log('[e2e:storage] shareContext:false(默认)两实例 messages 独立')
  {
    const sdkA = createChatSdk({ ui: false, id: 'e2e-noshare', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkA.mount()
    const sdkB = createChatSdk({ ui: false, id: 'e2e-noshare', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkB.mount()
    assert(sdkA.messages !== sdkB.messages, 'shareContext:false(默认) → 两实例 messages 独立(不同引用)')
    sdkA.unmount()
    sdkB.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
