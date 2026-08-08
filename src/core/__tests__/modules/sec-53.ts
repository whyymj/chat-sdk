import { constructLlmFromConfig, constructOpenLlmSync } from '../../llm/constructLlm'
import { extractTextDelta, extractReasoningDelta, extractUsage } from '../../utils/contentParts'
import type { TestCtx } from './_ctx'

// LLM 构造工厂 constructLlm(Anthropic 开箱:provider 抽离,openai 同步 / anthropic 动态 import)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[LLM 构造工厂 constructLlm · provider 抽离]')
  {
    // constructOpenLlmSync:同步构造 OpenAI 协议 LLM(供 setLlm 等同步契约场景)
    const llm = constructOpenLlmSync({ apiKey: 'sk-test', model: 'gpt-4' })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'constructOpenLlmSync → OpenAI 实例(invoke 可用)')
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI'), 'constructOpenLlmSync → ChatOpenAI 实例(constructor 含 OpenAI)')
  }
  {
    // constructLlmFromConfig 显式 provider:'openai' → async 返回 ChatOpenAI 实例
    const llm = await constructLlmFromConfig({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI'), 'constructLlmFromConfig provider:openai → ChatOpenAI 实例')
  }
  {
    // constructLlmFromConfig 缺省 provider(undefined)→ openai 分支(向后兼容,非 Anthropic)
    const llm = await constructLlmFromConfig({ apiKey: 'sk-test', model: 'gpt-4' })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI') && !name.includes('Anthropic'), 'constructLlmFromConfig 缺省 provider → openai 分支(向后兼容)')
  }
  {
    // constructLlmFromConfig provider:'anthropic' → 动态 import → ChatAnthropic 实例(仅实例化,不调真实 API)
    const llm = await constructLlmFromConfig({
      provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet-20241022', baseUrl: 'https://api.anthropic.com',
    })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('Anthropic'), 'constructLlmFromConfig provider:anthropic → ChatAnthropic 实例(动态 import)')
    // baseUrl → anthropicApiUrl 透传(实例属性或 lc_kwargs)
    const apiUrl = (llm as any).anthropicApiUrl || (llm as any).lc_kwargs?.anthropicApiUrl
    assert(!!apiUrl, 'constructLlmFromConfig anthropic baseUrl → anthropicApiUrl 透传')
  }
  {
    // constructLlmFromConfig anthropic 传 extraConfig → clientOptions 透传(构造不抛错)
    const llm = await constructLlmFromConfig({
      provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-sonnet', extraConfig: { headers: { 'X-Test': '1' } },
    })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'constructLlmFromConfig anthropic extraConfig → clientOptions 透传不抛错')
  }
  {
    // ConstructOpts 覆盖 temperature/maxTokens(summary/title 用不同值,覆盖 LLMConfig)
    const llm = constructOpenLlmSync({ apiKey: 'sk', model: 'gpt-4', temperature: 0.7 }, { temperature: 0, maxTokens: 30 })
    const kw = (llm as any).lc_kwargs || {}
    assert(kw.temperature === 0, 'ConstructOpts.temperature 覆盖 LLMConfig.temperature(0.7 → 0)')
    assert(kw.maxTokens === 30, 'ConstructOpts.maxTokens 覆盖(缺省 LLMConfig.maxTokens → 30)')
  }
  {
    // constructOpenLlmSync extraBody → modelKwargs 透传(DeepSeek thinking 等)
    const llm = constructOpenLlmSync({ apiKey: 'sk', model: 'deepseek', extraBody: { thinking: { type: 'enabled' } } })
    const kw = (llm as any).lc_kwargs || {}
    assert(!!kw.modelKwargs && kw.modelKwargs.thinking?.type === 'enabled', 'constructOpenLlmSync extraBody → modelKwargs 透传')
  }
  console.log('\n[streaming provider 兼容 · contentParts 纯函数]')
  {
    // extractTextDelta:兼容 string(OpenAI/DeepSeek)+ parts 数组(Anthropic)
    assert(extractTextDelta({ content: 'hello' } as any) === 'hello', 'extractTextDelta string content → 原样返回(OpenAI/DeepSeek)')
    assert(extractTextDelta({ content: [{ type: 'text', text: 'hi' }, { type: 'text', text: '!' }] } as any) === 'hi!', 'extractTextDelta parts 数组 → 拼 text(Anthropic)')
    assert(extractTextDelta({ content: [{ type: 'thinking', thinking: '内部思考' }] } as any) === '', 'extractTextDelta parts 含 thinking → 跳过(只取 text)')
    assert(extractTextDelta({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }] } as any) === 'a', 'extractTextDelta parts 含 tool_use → 跳过非 text')
    assert(extractTextDelta({ content: 123 } as any) === '', 'extractTextDelta 非字符串/数组 → 空(兜底)')
  }
  {
    // extractReasoningDelta:兼容 additional_kwargs(DeepSeek)+ thinking parts(Anthropic)
    assert(extractReasoningDelta({ additional_kwargs: { reasoning_content: 'r1' } } as any) === 'r1', 'extractReasoningDelta additional_kwargs.reasoning_content(DeepSeek)')
    assert(extractReasoningDelta({ additional_kwargs: { reasoning: 'r2' } } as any) === 'r2', 'extractReasoningDelta additional_kwargs.reasoning(兼容)')
    assert(extractReasoningDelta({ content: [{ type: 'thinking', thinking: 'th1' }] } as any) === 'th1', 'extractReasoningDelta thinking parts(Anthropic)')
    assert(extractReasoningDelta({ content: [{ type: 'thinking_delta', delta: 'th2' }] } as any) === 'th2', 'extractReasoningDelta thinking_delta parts(Anthropic 流式)')
    assert(extractReasoningDelta({ content: '纯文本无推理' } as any) === '', 'extractReasoningDelta 无推理 → 空')
  }
  {
    // extractUsage:兼容 additional_kwargs(OpenAI/DeepSeek)+ response_metadata(Anthropic)
    assert(extractUsage({ additional_kwargs: { usage: { total_tokens: 10 } } } as any)?.total_tokens === 10, 'extractUsage additional_kwargs.usage(OpenAI/DeepSeek)')
    assert(extractUsage({ response_metadata: { usage: { total_tokens: 20 } } } as any)?.total_tokens === 20, 'extractUsage response_metadata.usage(Anthropic)')
    assert(extractUsage({ response_metadata: { token_usage: { total_tokens: 30 } } } as any)?.total_tokens === 30, 'extractUsage response_metadata.token_usage(兼容)')
    assert(extractUsage({} as any) === undefined, 'extractUsage 无 usage → undefined')
  }
}
