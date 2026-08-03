/**
 * 代理连接模块 —— 统一管理 LLM 接入,支持两种模式:
 *
 * - `proxy`(代理模式,上线用):浏览器只持用户 token,代理服务端注入真实 apiKey 转发到 LLM API。
 *   防止 apiKey 泄露;支持 token 过期自动刷新(401 重试)、自定义 headers、配额/限流错误透传。
 *
 * - `direct`(直连模式,开发用):浏览器直接持真实 apiKey 连 LLM API(仅开发环境,生产会泄露 key)。
 *   与 LLMConfig 等价,但走同一工厂便于 dev/prod 切换不改代码结构。
 *
 * 用法:
 * ```ts
 * // 上线(代理模式)
 * createChatSdk({ llm: createProxyLlm({ mode: 'proxy', baseUrl: '/api/llm', userToken, model: 'deepseek-chat' }), ... })
 * // 开发(直连模式)
 * createChatSdk({ llm: createProxyLlm({ mode: 'direct', apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), ... })
 * ```
 *
 * 两种模式返回的都是 BaseChatModel 实例,可直接传 createChatSdk({ llm })。
 * 代理模式额外能力:token 刷新(401 自动重试一次)、自定义 headers 注入。
 *
 * 兼容性说明:
 * - 内部用 ChatOpenAI,要求接口为 OpenAI Chat Completions 兼容格式(请求/响应/SSE 流)
 * - 自定义 fetch 经 configuration.fetch 传入 OpenAI client(已验证 @langchain/openai 1.5.x 透传)
 * - OpenAI SDK 实际传给 fetch 的是 string URL(buildURL().toString()),但本实现兼容 string|URL|Request
 * - chat completions 的 body 是 JSON string(可重复发送),401 重试复用同一 init 安全;
 *   若 body 为 ReadableStream(非 chat 场景)则跳过重试,避免 body 已消费导致重试失败
 */
import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export type ProxyLlmMode = 'proxy' | 'direct'

export interface ProxyLlmOptions {
  /** 接入模式:
   *  - `proxy`:代理转发(上线),浏览器传 userToken,服务端注入真实 apiKey
   *  - `direct`:直连(仅开发),浏览器持真实 apiKey */
  mode: ProxyLlmMode
  /** 代理/后端地址(proxy 模式必填,如 '/api/llm');直连时为 LLM API baseUrl */
  baseUrl?: string
  /** proxy 模式:用户 token(代理验证用;不传用占位 'proxy') */
  userToken?: string
  /** direct 模式:真实 LLM apiKey(仅开发环境,生产会泄露) */
  apiKey?: string
  /** 模型名(透传给代理/LLM) */
  model?: string
  temperature?: number
  maxTokens?: number
  /** proxy 模式:token 刷新(401 时自动调,返回新 token 重试一次) */
  refreshToken?: () => Promise<string>
  /** 附加 headers(注入每个请求;proxy 模式生效) */
  headers?: Record<string, string>
  /** direct 模式生产安全闸:生产环境(https + 非本地域)检测到 direct 模式时,
   *  - false/不传(默认):仅 console.warn 提醒 apiKey 泄露风险(向后兼容,不阻断)
   *  - true:直接 throw 阻断 —— 防 apiKey 进 bundle 泄露(集成方 opt-in 升级强安全;direct 本就标注「仅开发」) */
  throwOnDirectInProduction?: boolean
}

/** body 是否为可重复发送的类型(string/ArrayBuffer/Blob/FormData/URLSearchParams);ReadableStream 不可重复 */
function isRetryableBody(body: unknown): boolean {
  if (body == null) return true
  if (typeof body === 'string') return true
  if (body instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(body)) return true
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true
  if (body instanceof URLSearchParams) return true
  if (body instanceof FormData) return true
  return false // ReadableStream / 其他流式 → 不可重试
}

/**
 * 构造代理/直连 LLM 实例。返回 BaseChatModel,直接传 createChatSdk({ llm })。
 *
 * proxy 模式内部用自定义 fetch 注入 Authorization + 自定义 headers,并在 401 时刷新 token 重试一次。
 * direct 模式直接构造 ChatOpenAI(与 LLMConfig 等价),并在非开发环境 warn 提醒 key 泄露风险。
 */
export function createProxyLlm(opts: ProxyLlmOptions): BaseChatModel {
  const model = opts.model || 'gpt-3.5-turbo'
  const temperature = opts.temperature
  const maxTokens = opts.maxTokens
  const baseURL = opts.baseUrl

  if (opts.mode === 'direct') {
    // 直连模式:浏览器持真实 key,仅开发环境安全
    // 先算 isProd(try 只兜底 location 访问异常);判断 + throw/warn 必须在 try 外,
    // 否则 throwOnDirectInProduction 的 throw 会被下面的 catch 吞掉(opt-in 强安全闸失效)。
    let isProd = false
    try {
      isProd = typeof location !== 'undefined'
        && location.protocol === 'https:'
        && !['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname)
    } catch { /* location 不可用时静默,isProd 保持 false(开发环境正常直连) */ }
    if (isProd) {
      const msg = '[page-agent-sdk][proxyLlm] direct 模式在生产环境(https + 非本地)会泄露 apiKey(进 bundle),建议改用 proxy 模式'
      if (opts.throwOnDirectInProduction) {
        // opt-in 强安全闸:throwOnDirectInProduction:true → throw 阻断 direct 误用于生产(防 key 泄露)
        throw new Error(msg + '(throwOnDirectInProduction 已启用强安全闸;若确需生产直连,设为 false 显式承认风险)')
      }
      console.warn(msg)
    }
    if (!opts.apiKey) {
      throw new Error('[page-agent-sdk][proxyLlm] direct 模式需提供 apiKey(开发环境用真实 key)')
    }
    return new ChatOpenAI({
      apiKey: opts.apiKey,
      model,
      temperature,
      maxTokens,
      configuration: baseURL ? { baseURL } : undefined,
    })
  }

  // proxy 模式:浏览器只持 userToken,服务端注入真实 apiKey
  if (!baseURL) {
    console.warn('[page-agent-sdk][proxyLlm] proxy 模式未配 baseUrl,将打到页面 origin(通常不是预期);请传代理地址如 \'/api/llm\'')
  }
  let currentToken = opts.userToken || 'proxy'
  // token 刷新单例锁:并发 401 共享一次刷新,避免重复调 refreshToken
  let refreshPromise: Promise<string> | null = null

  function getRefreshedToken(): Promise<string> {
    if (!opts.refreshToken) return Promise.resolve(currentToken)
    if (!refreshPromise) {
      refreshPromise = opts.refreshToken().finally(() => { refreshPromise = null })
    }
    return refreshPromise
  }

  const customFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    // 兼容 string | URL | Request:从 Request 提取 url + headers
    let target: string
    let baseHeaders: HeadersInit | undefined
    if (typeof input === 'string') {
      target = input
      baseHeaders = init?.headers
    } else if (input instanceof URL) {
      target = input.toString()
      baseHeaders = init?.headers
    } else {
      // Request 对象:提取 url 与 headers(OpenAI SDK 实际传 string,此处仅作兼容保护)
      target = input.url
      baseHeaders = init?.headers ?? input.headers
    }

    const headers = new Headers(baseHeaders)
    headers.set('Authorization', `Bearer ${currentToken}`)
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v)
    }

    const doFetch = (): Promise<Response> => fetch(target, { ...init, headers })

    let resp = await doFetch()

    // 401 → 刷新 token 重试一次(仅当 body 可重复发送;流式 body 跳过避免已消费)
    if (resp.status === 401 && opts.refreshToken && isRetryableBody(init?.body)) {
      try {
        currentToken = await getRefreshedToken()
        headers.set('Authorization', `Bearer ${currentToken}`)
        resp = await doFetch()
      } catch {
        // 刷新失败:返回原 401 响应,由上层 retry 中间件处理
      }
    }
    return resp
  }

  return new ChatOpenAI({
    apiKey: currentToken,
    model,
    temperature,
    maxTokens,
    configuration: {
      baseURL: baseURL || '/',
      fetch: customFetch as unknown as typeof fetch,
    },
  })
}
