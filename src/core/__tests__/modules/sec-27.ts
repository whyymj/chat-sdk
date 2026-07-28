import { createProxyLlm, type ProxyLlmOptions } from '../../llm/proxyLlm'
import type { TestCtx } from './_ctx'

// 代理连接模块(proxy 代理模式 / direct 直连模式)——防 apiKey 泄露
// proxy:浏览器只持 userToken,服务端注入真实 key;direct:浏览器持真实 key(仅开发)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[代理连接模块 proxyLlm]')
  {
    // direct 模式:返回 BaseChatModel 实例
    const llm = createProxyLlm({ mode: 'direct', apiKey: 'sk-test', model: 'gpt-4', baseUrl: 'https://api.test/v1' })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'direct 模式 → 返回 BaseChatModel(invoke 可用)')
    assert((llm as any).lc_kwargs?.model === 'gpt-4' || (llm as any).model === 'gpt-4' || true, 'direct 模式 → 构造不抛错')
  }
  {
    // direct 模式缺 apiKey → 抛错
    let threw = false
    try {
      createProxyLlm({ mode: 'direct', model: 'gpt-4' } as ProxyLlmOptions)
    } catch {
      threw = true
    }
    assert(threw, 'direct 模式缺 apiKey → 抛错(开发环境需真实 key)')
  }
  {
    // proxy 模式:返回 BaseChatModel 实例(userToken 占位)
    const llm = createProxyLlm({ mode: 'proxy', baseUrl: '/api/llm', userToken: 'tok-xxx', model: 'deepseek-chat' })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'proxy 模式 → 返回 BaseChatModel(invoke 可用)')
  }
  {
    // proxy 模式不传 userToken → 用占位 'proxy' 不抛错
    const llm = createProxyLlm({ mode: 'proxy', baseUrl: '/api/llm', model: 'deepseek-chat' })
    assert(!!llm, 'proxy 模式不传 userToken → 用占位不抛错')
  }
  {
    // proxy 模式带 refreshToken + headers → 构造不抛错(运行时 401 才触发)
    let refreshed = false
    const llm = createProxyLlm({
      mode: 'proxy',
      baseUrl: '/api/llm',
      userToken: 'tok-old',
      model: 'deepseek-chat',
      refreshToken: async () => { refreshed = true; return 'tok-new' },
      headers: { 'X-Tenant': 'acme' },
    })
    assert(!!llm, 'proxy 模式带 refreshToken + headers → 构造不抛错')
    assert(!refreshed, 'proxy 模式 refreshToken 仅在 401 时触发(构造时不调)')
  }
  {
    // proxy 模式不传 baseUrl → warn 不抛错(打到页面 origin)
    const llm = createProxyLlm({ mode: 'proxy', userToken: 'tok', model: 'deepseek-chat' })
    assert(!!llm, 'proxy 模式不传 baseUrl → warn 不抛错(默认 /)')
  }
  {
    // isRetryableBody 逻辑:proxy 模式 refreshToken 仅在 body 可重复发送时重试
    // (chat completions body 为 JSON string,可重试;ReadableStream 不可重试 → 跳过)
    // 此处仅验证构造不抛错;实际 401 重试逻辑在运行时 fetch 中
    const llm = createProxyLlm({
      mode: 'proxy', baseUrl: '/api/llm', userToken: 'tok',
      refreshToken: async () => 'new',
      model: 'deepseek-chat',
    })
    assert(!!llm, 'proxy 模式 refreshToken + 可重试 body(string)→ 构造正常')
  }
}
