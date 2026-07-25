// windowProps:schema 类型(8 种) + 嵌套 path + 空 / 多 / 不传
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:window-props] 各 schema 类型 + 嵌套 path')
  {
    globalThis.window.app = { nested: { items: ['a'] }, flag: false }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-schema-types', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      windowProps: [
        { path: 'app.title', description: '字符串', schema: z.string() },
        { path: 'app.count', description: '数字', schema: z.number() },
        { path: 'app.flag', description: '布尔', schema: z.boolean() },
        { path: 'app.tags', description: '数组', schema: z.array(z.string()) },
        { path: 'app.meta', description: '对象', schema: z.object({ k: z.string() }) },
        { path: 'app.map', description: 'record', schema: z.record(z.string(), z.any()) },
        { path: 'app.level', description: '枚举', schema: z.enum(['a', 'b', 'c']) },
        { path: 'app.nested.items', description: '嵌套 path', schema: z.array(z.string()) },
      ],
    })
    await sdk.mount()
    const paths = sdk.inspect().windowProps.map((p) => p.path)
    assert(paths.length === 8, '8 种 schema 类型 + 嵌套 path 全部注册成功')
    assert(paths.includes('app.nested.items'), '嵌套 path(app.nested.items) 注册成功')
    sdk.unmount()
  }

  console.log('[e2e:window-props] 空 windowProps:mount 成功')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-empty-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, windowProps: [] })
    await sdk.mount()
    assert(sdk.inspect().windowProps.length === 0, '空 windowProps → inspect().windowProps 为空')
    sdk.unmount()
  }

  console.log('[e2e:window-props] 多 windowProps:inspect().windowProps 含全部')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-multi-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      windowProps: [
        { path: 'app.title', description: '标题', schema: z.string() },
        { path: 'app.count', description: '计数', schema: z.number() },
        { path: 'app.items', description: '列表', schema: z.array(z.string()) },
      ],
    })
    await sdk.mount()
    const paths = sdk.inspect().windowProps.map((p) => p.path)
    assert(paths.length === 3 && paths.includes('app.title') && paths.includes('app.count') && paths.includes('app.items'), '多 windowProps → inspect().windowProps 含全部 3 个')
    sdk.unmount()
  }

  console.log('[e2e:window-props] 不传 windowProps:mount 成功')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-no-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().windowProps.length === 0, '不传 windowProps → inspect().windowProps 为空')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
