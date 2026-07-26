// systemPrompt 相关:默认 / 自定义覆盖 / 能力概述 / reliableWriteRules 拼接
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, systemPromptHelpers } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:systemprompt] 默认 systemPrompt + inspect.systemPrompt')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const info = sdk.inspect()
    assert(typeof info.systemPrompt === 'string' && info.systemPrompt.length > 0, 'inspect().systemPrompt 为非空字符串')
    assert(/reliableWriteRules|改前先|增量 patch|可靠写入/.test(info.systemPrompt), '默认 systemPrompt 含 reliableWriteRules 关键词')
    assert(/JSON 操作助手/.test(info.systemPrompt), '默认 systemPrompt 含「JSON 操作助手」身份')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 自定义 systemPrompt 完全覆盖默认')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-custom', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    assert(sdk.inspect().systemPrompt.startsWith('你是定制助手。') && /可操作数据/.test(sdk.inspect().systemPrompt), '自定义 systemPrompt 完全覆盖默认(data schema 仍自动追加「可操作数据」段)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 默认 systemPrompt 含能力概述(范围控制/schema 校验/快照/增量 patch)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-default-detail', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(/范围控制|注册表/.test(sp), '默认 systemPrompt 含「范围控制/注册表」能力说明')
    assert(/schema 校验|校验/.test(sp), '默认 systemPrompt 含「schema 校验」能力说明')
    assert(/快照|回退/.test(sp), '默认 systemPrompt 含「快照/回退」能力说明')
    assert(/增量 patch|增量/.test(sp), '默认 systemPrompt 含「增量 patch」能力说明')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] 自定义 systemPrompt + systemPromptHelpers.reliableWriteRules 拼接(常见用法)')
  {
    const custom = '你是商品页编辑助手。'
    const sdk = createChatSdk({
      ui: false, id: 'e2e-custom-merge', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: `${custom}\n${systemPromptHelpers.reliableWriteRules}`,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.startsWith('你是商品页编辑助手。'), '自定义 systemPrompt 保留(拼在前)')
    assert(/可靠写入规则|改任何字段前|增量改|write 的 patch/.test(sp), '拼接后含 reliableWriteRules(用户自行拼入)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules:true → 自定义 systemPrompt 末尾自动追加 reliableWriteRules')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-rwr', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      appendReliableWriteRules: true,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.startsWith('你是定制助手。'), '自定义 systemPrompt 保留(在前)')
    assert(/可靠写入规则|改任何字段前/.test(sp), 'appendReliableWriteRules:true → 末尾自动追加 reliableWriteRules')
    assert(!/你是一个 JSON 操作助手/.test(sp), 'appendReliableWriteRules 不引入默认身份(只追加规则段,不替换默认 prompt)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules 默认 false → 自定义 systemPrompt 不自动追加(向后兼容)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-off', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      systemPrompt: '你是定制助手。',
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(!/可靠写入规则|改任何字段前/.test(sp), 'appendReliableWriteRules 默认 false → 不自动追加(向后兼容,需显式开启)')
    sdk.unmount()
  }

  console.log('[e2e:systemprompt] appendReliableWriteRules 对默认 prompt 无效(默认已内置,不重复追加)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-append-default', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      appendReliableWriteRules: true,  // 不传 systemPrompt,此项应无效(默认 prompt 已含,不重复)
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    const matches = sp.match(/可靠写入规则/g) || []
    assert(matches.length === 1, '不传 systemPrompt 时 appendReliableWriteRules 无效(默认 prompt 只含一份 reliableWriteRules,不重复)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
