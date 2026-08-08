// LLM provider 配置(Anthropic 开箱):provider 字段 + constructLlm + setLlm 同步契约
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:llm-provider] provider:anthropic → mount 成功(动态 import @langchain/anthropic,仅实例化不调真实 API)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-anthropic', storage: 'memory',
      llm: { provider: 'anthropic', apiKey: 'sk-ant-fake', model: 'claude-sonnet-4-5-20250929', contextWindow: 200000 },
      capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().model === 'claude-sonnet-4-5-20250929', 'provider:anthropic → mount 成功 + inspect().model 反映 claude')
    sdk.unmount()
  }

  console.log('[e2e:llm-provider] provider 缺省 → openai 分支(向后兼容,现状不变)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-openai-default', storage: 'memory',
      llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'gpt-4o', contextWindow: 200000 },
      capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().model === 'gpt-4o', 'provider 缺省(undefined)→ openai 分支(向后兼容)')
    sdk.unmount()
  }

  console.log('[e2e:llm-provider] provider:openai 显式 → 等价缺省(openai 构造)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-openai-explicit', storage: 'memory',
      llm: { provider: 'openai', apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'gpt-4o', contextWindow: 200000 },
      capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().model === 'gpt-4o', 'provider:openai 显式 → openai 构造(mount 成功)')
    sdk.unmount()
  }

  console.log('[e2e:llm-provider] setLlm provider:anthropic → throw(同步契约;动态 import 无法同步,提示传实例)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setllm-anthropic', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try {
      sdk.setLlm({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-4-5-20250929', contextWindow: 200000 })
    } catch { threw = true }
    assert(threw, 'setLlm({ provider:anthropic }) → throw(同步契约保护,提示传 BaseChatModel 实例)')
    sdk.unmount()
  }

  console.log('[e2e:llm-provider] setLlm provider:openai(缺省)→ 同步构造不 throw + model 更新')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-setllm-openai', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try {
      sdk.setLlm({ apiKey: 'sk-fake2', baseUrl: 'http://fake', model: 'gpt-4o-mini', contextWindow: 200000 })
    } catch { threw = true }
    assert(!threw, 'setLlm openai(缺省 provider)→ 同步 constructOpenLlmSync 不 throw')
    assert(sdk.inspect().model === 'gpt-4o-mini', 'setLlm openai → inspect().model 更新')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
