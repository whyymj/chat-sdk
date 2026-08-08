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
    // P1-5:switchSession 重置 mission(workingMemory 同链路 reset,selftest sec-38 覆盖;防旧会话 goal/path·hash 污染新会话)
    sdk.setMission({ goal: '旧会话的目标锚点' })
    assert(sdk.inspect().mission?.goal === '旧会话的目标锚点', 'P1-5 前置:setMission 置 mission(有值)')
    const newId = await sdk.switchSession()
    assert(typeof newId === 'string' && newId.length > 0, 'storage 开启 → switchSession 返回新 id(string)')
    assert(sdk.inspect().mission === undefined, 'P1-5 switchSession → mission 重置为 undefined(防旧 goal 污染新会话)')
    const fixedId = await sdk.switchSession('my-session-123')
    assert(fixedId === 'my-session-123', 'switchSession(id) 返回该 id')
    sdk.unmount()
  }

  console.log('[e2e:storage] session-history:listSessions / deleteSession / sessionId(S2-S4)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-history', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const id1 = await sdk.switchSession()
    const id2 = await sdk.switchSession()
    // S2:listSessions 返回历史会话数组
    const sessions = await sdk.listSessions()
    assert(Array.isArray(sessions) && sessions.length >= 2, 'S2 listSessions → 历史会话数组(≥2,含已建会话)')
    assert(sessions.every((s) => 'sessionId' in s && 'lastAccessed' in s), 'S2 SessionMeta 含 sessionId/lastAccessed 字段')
    // S4:sessionId 反映当前(=== 最后 switchSession 返回值)
    assert(sdk.sessionId === id2, 'S4 sdk.sessionId === 当前会话(最后 switchSession 返回值)')
    assert(sdk.inspect().sessionId === id2, 'S4 inspect().sessionId 反映当前会话')
    // S3:deleteSession 删非当前会话 → 列表减 1
    const before = (await sdk.listSessions()).length
    await sdk.deleteSession(id1)
    assert((await sdk.listSessions()).length === before - 1, 'S3 deleteSession(非当前) → 历史列表减 1')
    // S3:删当前会话被拒(不抛,需先切走)
    let delCurThrew = false
    try { await sdk.deleteSession(sdk.sessionId) } catch { delCurThrew = true }
    assert(!delCurThrew, 'S3 deleteSession(当前会话) → 不抛(warn 忽略,需先 switchSession 切走)')
    // Phase 6:sdk.sessions 响应式(switchSession/deleteSession 后自动 refresh,无需手动 listSessions/hook)
    assert(Array.isArray(sdk.sessions.value), 'Phase 6 sdk.sessions 是响应式 Ref<数组>')
    assert(sdk.sessions.value.length === (await sdk.listSessions()).length, 'Phase 6 sdk.sessions === listSessions(自动同步)')
    assert(sdk.sessions.value.some((s) => s.sessionId === sdk.sessionId), 'Phase 6 sdk.sessions 含当前会话(高亮依据)')
    // S2/S3 优雅降级:storage 未开启 → listSessions [] / deleteSession no-op
    const sdkNoStore = createChatSdk({ ui: false, id: 'e2e-history-nostore', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkNoStore.mount()
    assert((await sdkNoStore.listSessions()).length === 0, 'S2 storage 未开启 → listSessions 返回 [](优雅降级)')
    let nsThrew = false
    try { await sdkNoStore.deleteSession('x') } catch { nsThrew = true }
    assert(!nsThrew, 'S3 storage 未开启 → deleteSession no-op 不抛')
    sdkNoStore.unmount()
    sdk.unmount()
  }

  console.log('[e2e:storage] Phase 6 sdk.sessions 边界:切回旧会话不重复 + deleteSession 自动 refresh')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-sessions-dedup', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const id1 = await sdk.switchSession()
    const id2 = await sdk.switchSession()
    const lenAfterNew = sdk.sessions.value.length
    // 切回旧会话 id1 → sessions 不重复(只换 current,列表不变)
    await sdk.switchSession(id1)
    assert(sdk.sessions.value.length === lenAfterNew, 'Phase 6 切回旧会话 → sessions 不重复(列表不变,只换 current)')
    assert(sdk.sessionId === id1, 'Phase 6 切回后 sessionId === id1(当前会话切换)')
    // sessions 无重复 sessionId
    const sids = sdk.sessions.value.map((s) => s.sessionId)
    assert(new Set(sids).size === sids.length, 'Phase 6 sessions 无重复 sessionId')
    // deleteSession 后 sessions 自动 refresh(响应式,无需手动 listSessions)
    const lenBeforeDel = sdk.sessions.value.length
    await sdk.deleteSession(id2)
    assert(sdk.sessions.value.length === lenBeforeDel - 1, 'Phase 6 deleteSession 后 sessions 自动 refresh(响应式更新)')
    sdk.unmount()
  }

  console.log('[e2e:storage] context-persist-resilience:mission 跨 switchSession 持久化往返')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-mission-persist', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const idA = sdk.sessionId
    sdk.setMission({ goal: '会话A的目标锚点', acceptanceCriteria: ['改完首页'] })
    assert(sdk.inspect().mission?.goal === '会话A的目标锚点', '功能A 前置:setMission 置 mission(有值)')
    await sdk.switchSession() // 切到新会话(切走前 persist A 的 mission —— persistRuntime 仅 afterRound 触发,setMission 后未发消息即切会话靠此补存)
    assert(sdk.inspect().mission === undefined, '功能A 切到新会话 → mission 空(新会话无持久化目标)')
    await sdk.switchSession(idA) // 切回 A
    assert(sdk.inspect().mission?.goal === '会话A的目标锚点', '功能A 切回 A → mission 恢复(持久化往返:setMission 后切走不丢)')
    assert(sdk.inspect().mission?.acceptanceCriteria?.[0] === '改完首页', '功能A 切回 → mission 字段完整(criteria 恢复)')
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
