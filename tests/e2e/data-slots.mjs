// dataSlots:schema 类型(8 种) + 嵌套 path + 空 / 多 / 不传
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:data-slots] 各 schema 类型 + 嵌套 path')
  {
    globalThis.window.app = { nested: { items: ['a'] }, flag: false }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-schema-types', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [
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
    const paths = sdk.inspect().dataSlots.map((p) => p.path)
    assert(paths.length === 8, '8 种 schema 类型 + 嵌套 path 全部注册成功')
    assert(paths.includes('app.nested.items'), '嵌套 path(app.nested.items) 注册成功')
    sdk.unmount()
  }

  console.log('[e2e:data-slots] 空 dataSlots:mount 成功')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-empty-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, dataSlots: [] })
    await sdk.mount()
    assert(sdk.inspect().dataSlots.length === 0, '空 dataSlots → inspect().dataSlots 为空')
    sdk.unmount()
  }

  console.log('[e2e:data-slots] 多 dataSlots:inspect().dataSlots 含全部')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-multi-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      dataSlots: [
        { path: 'app.title', description: '标题', schema: z.string() },
        { path: 'app.count', description: '计数', schema: z.number() },
        { path: 'app.items', description: '列表', schema: z.array(z.string()) },
      ],
    })
    await sdk.mount()
    const paths = sdk.inspect().dataSlots.map((p) => p.path)
    assert(paths.length === 3 && paths.includes('app.title') && paths.includes('app.count') && paths.includes('app.items'), '多 dataSlots → inspect().dataSlots 含全部 3 个')
    sdk.unmount()
  }

  console.log('[e2e:data-slots] 不传 dataSlots:mount 成功')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-no-props', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().dataSlots.length === 0, '不传 dataSlots → inspect().dataSlots 为空')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
