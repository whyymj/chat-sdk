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

  return { pass: ctx.pass, fail: ctx.fail }
}
