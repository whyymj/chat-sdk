// data:schema 类型(8 种字段)+ 嵌套字段 + 空 / 不传
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:data] 单主对象 schema 含 8 种字段类型 + 嵌套字段')
  {
    const bind = { title: 't', count: 1, flag: false, tags: ['a'], meta: { k: 'v' }, map: { x: 1 }, level: 'a', nested: { items: ['a'] } }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-schema-types', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: {
        schema: z.object({
          title: z.string(),
          count: z.number(),
          flag: z.boolean(),
          tags: z.array(z.string()),
          meta: z.object({ k: z.string() }),
          map: z.record(z.string(), z.any()),
          level: z.enum(['a', 'b', 'c']),
          nested: z.object({ items: z.array(z.string()) }),
        }),
        bind,
        description: '应用配置(8 种字段类型 + 嵌套)',
      },
    })
    await sdk.mount()
    const info = sdk.inspect().data
    assert(!!info && info.description === '应用配置(8 种字段类型 + 嵌套)', '单 data schema 含 8 种字段类型 + 嵌套 → inspect().data.description 反映')
    assert(!!info?.schema, 'inspect().data.schema 存在')
    sdk.unmount()
  }

  console.log('[e2e:data] 不传 data:mount 成功 + inspect().data undefined')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-no-data', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().data === undefined, '不传 data → inspect().data 为 undefined')
    sdk.unmount()
  }

  console.log('[e2e:data] 单 data(多字段):inspect().data 反映')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-multi-fields', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: {
        schema: z.object({ title: z.string(), count: z.number(), items: z.array(z.string()) }),
        bind: { title: 't', count: 1, items: ['a'] },
        description: '多字段配置',
      },
    })
    await sdk.mount()
    const info = sdk.inspect().data
    assert(!!info && info.description === '多字段配置', '单 data 多字段 → inspect().data.description 反映')
    sdk.unmount()
  }

  console.log('[e2e:data] 数组子项删除 splice:length 递减、元素前移、无稀疏空位(fix-dataops-write-correctness)')
  {
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const bind = { components: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const tools = createDataOps({
      schema: z.object({ components: z.array(z.object({ id: z.number() })) }),
      bind,
      description: '数组组件',
    })
    const byName = (xs) => Object.fromEntries(xs.map((t) => [t.name, t]))
    const t = byName(tools)
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    assert(bind.components.length === 2 && bind.components[0].id === 2 && bind.components[1].id === 3, 'delete_data 删数组首项 → length 3→2、元素前移([1,2,3]→[2,3]),无 empty 槽')
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    assert(bind.components.length === 0, 'delete_data 连续删 → 2→1→0,length 一路递减无残留空位')
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
