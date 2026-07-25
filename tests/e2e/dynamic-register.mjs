// 动态注册:addDataSlot / removeDataSlot / listDataSlots + inspect().dataSlots 同步 + dataSlotOps 关闭 no-op
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:dynamic-register] 动态注册 addDataSlot / removeDataSlot / listDataSlots')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app.title', description: '标题', schema: z.string() }],
    })
    await sdk.mount()
    assert(sdk.listDataSlots().length === 1, '初始 1 个注册属性')
    sdk.addDataSlot({ path: 'app.count', description: '计数', schema: z.number() })
    assert(sdk.listDataSlots().length === 2, 'addDataSlot 后 listDataSlots 含 2 个')
    assert(sdk.listDataSlots().some((p) => p.path === 'app.count'), 'listDataSlots 含动态新增 path')
    assert(sdk.removeDataSlot('app.count') === true, 'removeDataSlot 存在的 path 返回 true')
    assert(sdk.listDataSlots().length === 1, 'removeDataSlot 后 listDataSlots 回到 1 个')
    assert(sdk.removeDataSlot('not.exist') === false, 'removeDataSlot 不存在 path 返回 false')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] dataSlotOps 关闭时 addDataSlot/removeDataSlot 为 no-op')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-noop', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, dataSlotOps: false },
    })
    await sdk.mount()
    sdk.addDataSlot({ path: 'app.x', description: 'x', schema: z.string() })
    assert(sdk.listDataSlots().length === 0, 'dataSlotOps:false → addDataSlot no-op(list 仍空)')
    assert(sdk.removeDataSlot('app.x') === false, 'dataSlotOps:false → removeDataSlot 返回 false')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] 动态注册与 inspect().dataSlots 同步')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-sync', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [{ path: 'app.base', description: '基础', schema: z.string() }],
    })
    await sdk.mount()
    assert(sdk.inspect().dataSlots.length === 1, '初始 1 个注册属性')
    sdk.addDataSlot({ path: 'app.dynamic', description: '动态', schema: z.number() })
    let info = sdk.inspect()
    assert(info.dataSlots.length === 2, 'addDataSlot 后 inspect().dataSlots 含 2 个')
    assert(info.dataSlots.some((p) => p.path === 'app.dynamic'), 'inspect().dataSlots 含动态新增 path')
    assert(sdk.removeDataSlot('app.dynamic') === true, 'removeDataSlot 存在的 path 返回 true')
    assert(!sdk.inspect().dataSlots.some((p) => p.path === 'app.dynamic'), 'removeDataSlot 后 inspect().dataSlots 不再含该 path')
    assert(sdk.inspect().dataSlots.length === 1, 'removeDataSlot 后 inspect().dataSlots 回到 1 个')
    assert(sdk.removeDataSlot('not.exist') === false, 'removeDataSlot 不存在 path 返回 false')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
