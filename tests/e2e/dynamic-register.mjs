// 单主对象:setData / getData + inspect().data 同步 + dataOps 关闭 no-op
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:dynamic-register] setData / getData 运行时替换主数据配置')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '初始' },
    })
    await sdk.mount()
    assert(sdk.getData()?.description === '初始', '初始 getData 返回初始 config')
    sdk.setData({ schema: z.object({ count: z.number() }), bind: { count: 5 }, description: '改后' })
    assert(sdk.getData()?.description === '改后' && sdk.getData()?.bind?.count === 5, 'setData 换 config 后 getData 反映新值')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] dataOps 关闭时 setData 忽略 + getData 返回 undefined')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-noop', storage: 'memory', llm: FAKE_LLM,
      capabilities: { ...MIN_CAPS, dataOps: false },
    })
    await sdk.mount()
    sdk.setData({ schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'x' })
    assert(sdk.getData() === undefined, 'dataOps:false → setData 忽略,getData 返回 undefined')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] setData 与 inspect().data 同步')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-sync', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ base: z.string() }), bind: { base: 'b' }, description: '基础' },
    })
    await sdk.mount()
    assert(sdk.inspect().data?.description === '基础', '初始 inspect().data 反映初始 config')
    sdk.setData({ schema: z.object({ dynamic: z.number() }), bind: { dynamic: 1 }, description: '动态' })
    let info = sdk.inspect()
    assert(info.data?.description === '动态', 'setData 后 inspect().data 反映新 config(description)')
    sdk.unmount()
  }

  console.log('[e2e:dynamic-register] setData 后 inspect().systemPrompt 反映新 schema(验证 A4 动态化已修 Bug)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-dyn-sysprompt', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ oldField: z.string().describe('旧字段说明') }), bind: { oldField: 'a' }, description: '旧配置' },
    })
    await sdk.mount()
    const before = sdk.inspect().systemPrompt
    assert(before.includes('旧字段说明'), '初始 systemPrompt 含旧 schema 字段说明')
    sdk.setData({ schema: z.object({ newField: z.string().describe('新字段说明') }), bind: { newField: 'b' }, description: '新配置' })
    const after = sdk.inspect().systemPrompt
    assert(after.includes('新字段说明'), 'setData 换 schema 后 systemPrompt 反映新字段说明(A4 动态化已修 Bug)')
    assert(!after.includes('旧字段说明'), 'setData 换 schema 后 systemPrompt 不再含旧字段说明')
    assert(after.includes('新配置'), 'setData 后 systemPrompt 含新 description')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
