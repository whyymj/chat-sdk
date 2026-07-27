// 事件:hook 返回取消函数 / onEvent + hook 联动 / 多监听器 + off 重复调用安全
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:events] sdk.hook 返回取消函数')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hook', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
    })
    await sdk.mount()
    const off = sdk.hook(() => {})
    assert(typeof off === 'function', 'sdk.hook 返回取消函数(function)')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] onEvent + sdk.hook 联动(构造时 onEvent 与运行时 hook 均注册)')
  {
    globalThis.window.app = {}
    let onEventCount = 0, hookCount = 0
    const sdk = createChatSdk({
      ui: false, id: 'e2e-events', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
      onEvent: () => { onEventCount++ },
    })
    await sdk.mount()
    const off = sdk.hook(() => { hookCount++ })
    assert(typeof off === 'function' && onEventCount === 0 && hookCount === 0, 'onEvent + hook 均挂载,未触发前计数为 0')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] hook 多监听器 + off 重复调用安全')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-hook-multi', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let c1 = 0, c2 = 0
    const off1 = sdk.hook(() => { c1++ })
    const off2 = sdk.hook(() => { c2++ })
    assert(typeof off1 === 'function' && typeof off2 === 'function', '注册两个 hook 均返回取消函数')
    off1()
    off1()
    off2()
    assert(c1 === 0 && c2 === 0, '未触发事件前两监听器计数均为 0')
    sdk.unmount()
  }

  console.log('[e2e:events] sdk.usage 累计 token 用量(初始 0,字段齐全)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const u = sdk.usage
    assert(u && typeof u === 'object', 'sdk.usage 存在(对象)')
    assert(u.prompt_tokens === 0 && u.completion_tokens === 0 && u.total_tokens === 0, '初始用量全为 0(无 LLM 调用)')
    sdk.unmount()
  }

  console.log('[e2e:events] session_restored 事件类型可订阅(switchSession 切回已存会话不报错;真实快照触发需 LLM 造数据,e2e 用 FAKE_LLM 仅验证类型系统)')
  {
    let restored = null
    const sdk = createChatSdk({
      ui: false, id: 'e2e-restore', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'session_restored') restored = e },
    })
    await sdk.mount()
    const sid2 = await sdk.switchSession()  // 新建空会话(无快照,不发 session_restored)
    assert(typeof sid2 === 'string', 'switchSession 返回新会话 id')
    // 切回原会话(无快照不发事件,验证不报错 + 类型可订阅)
    await sdk.switchSession('e2e-restore')
    // restored 可能为 null(无快照)或对象(有快照);两种均合法,仅验证不报错
    assert(restored === null || (typeof restored.sessionId === 'string' && typeof restored.rounds === 'number'), 'session_restored 事件类型正确(有快照时含 sessionId/rounds,无快照时不发)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
