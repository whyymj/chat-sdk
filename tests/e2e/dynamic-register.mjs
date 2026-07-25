// 动态注册:addWindowProp / removeWindowProp / listWindowProps + inspect().windowProps 同步 + windowOps 关闭 no-op
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:dynamic-register] 动态注册 addWindowProp / removeWindowProp / listWindowProps')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      windowProps: [{ path: 'app.title', description: '标题', schema: z.string() }],
    })
    await sdk.mount()
    assert(sdk.listWindowProps().length === 1, '初始 1 个注册属性')
    sdk.addWindowProp({ path: 'app.count', description: '计数', schema: z.number() })
    assert(sdk.listWindowProps().length === 2, 'addWindowProp 后 listWindowProps 含 2 个')
    assert(sdk.listWindowProps().some((p) => p.path === 'app.count'), 'listWindowProps 含动态新增 path')
    assert(sdk.removeWindowProp('app.count') === true, 'removeWindowProp 存在的 path 返回 true')
    assert(sdk.listWindowProps().length === 1, 'removeWindowProp 后 listWindowProps 回到 1 个')
    assert(sdk.removeWindowProp('not.exist') === false, 'removeWindowProp 不存在 path 返回 false')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] windowOps 关闭时 addWindowProp/removeWindowProp 为 no-op')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-noop', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, windowOps: false },
    })
    await sdk.mount()
    sdk.addWindowProp({ path: 'app.x', description: 'x', schema: z.string() })
    assert(sdk.listWindowProps().length === 0, 'windowOps:false → addWindowProp no-op(list 仍空)')
    assert(sdk.removeWindowProp('app.x') === false, 'windowOps:false → removeWindowProp 返回 false')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] 动态注册与 inspect().windowProps 同步')
  {
    globalThis.window.app = {}
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-sync', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      windowProps: [{ path: 'app.base', description: '基础', schema: z.string() }],
    })
    await sdk.mount()
    assert(sdk.inspect().windowProps.length === 1, '初始 1 个注册属性')
    sdk.addWindowProp({ path: 'app.dynamic', description: '动态', schema: z.number() })
    let info = sdk.inspect()
    assert(info.windowProps.length === 2, 'addWindowProp 后 inspect().windowProps 含 2 个')
    assert(info.windowProps.some((p) => p.path === 'app.dynamic'), 'inspect().windowProps 含动态新增 path')
    assert(sdk.removeWindowProp('app.dynamic') === true, 'removeWindowProp 存在的 path 返回 true')
    assert(!sdk.inspect().windowProps.some((p) => p.path === 'app.dynamic'), 'removeWindowProp 后 inspect().windowProps 不再含该 path')
    assert(sdk.inspect().windowProps.length === 1, 'removeWindowProp 后 inspect().windowProps 回到 1 个')
    assert(sdk.removeWindowProp('not.exist') === false, 'removeWindowProp 不存在 path 返回 false')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
