/**
 * LLM 构造工厂 —— 按 provider 分支收口(Anthropic 开箱支持)。
 *
 * - `openai`(默认,向后兼容):同步 `new ChatOpenAI`(兼容 OpenAI/DeepSeek 协议)
 * - `anthropic`:动态 `import('@langchain/anthropic')` + `new ChatAnthropic`(走 Claude 原生协议)
 *
 * 动态 import 复用 MCP 模式(optional peerDep;不用 Anthropic 时不加载,不强求集成方安装)。
 * `constructLlmFromConfig` 是 async(承载 Anthropic 动态 import):
 *   - 主 LLM 走 `createChatSdk` 的 `initDone`(async IIFE)零破坏
 *   - summaryLlm/titleLlm 走 lazy 构造(首次 invoke 时 await,保 `resolveLlm` 同步签名)
 *
 * `constructOpenLlmSync`(同步 openai 分支)供 `setLlm`(同步契约)使用 ——
 * setLlm 切 Anthropic 需传 BaseChatModel 实例(动态 import 无法同步,实例路径天然支持任意 provider)。
 */
import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMConfig } from '../sdk/createChatSdk'

/** 构造选项:覆盖 LLMConfig 的 temperature/maxTokens(summary/title 用不同值) */
export interface ConstructOpts {
  temperature?: number
  maxTokens?: number
}

/**
 * 同步构造 OpenAI 协议 LLM(供 setLlm 等同步契约场景)。
 * 仅 openai 分支;Anthropic 无同步构造(动态 import 本质 async)。
 */
export function constructOpenLlmSync(cfg: LLMConfig, opts: ConstructOpts = {}): BaseChatModel {
  return new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature ?? cfg.temperature,
    maxTokens: opts.maxTokens ?? cfg.maxTokens,
    configuration: {
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      ...cfg.extraConfig,
    },
    ...(cfg.extraBody ? { modelKwargs: cfg.extraBody } : {}),
  })
}

/**
 * 按 provider 分支构造 LLM(openai 同步 / anthropic 动态 import)。
 * 缺省 provider → openai(向后兼容)。
 *
 * Anthropic 注:`extraBody`(OpenAI modelKwargs 语义,如 DeepSeek thinking)不通用 ——
 * Claude extended thinking 走 ChatAnthropic 的 `thinking` 字段(非请求 body 额外参数),
 * 故 extraBody 不透传;集成方需 thinking 时用预构造 ChatAnthropic 实例(`llm: new ChatAnthropic({ thinking: {...} })`)。
 */
export async function constructLlmFromConfig(cfg: LLMConfig, opts: ConstructOpts = {}): Promise<BaseChatModel> {
  const provider = cfg.provider ?? 'openai'
  if (provider === 'openai') return constructOpenLlmSync(cfg, opts)

  // anthropic:动态 import(optional peerDep;不用时不加载)
  const { ChatAnthropic } = await import('@langchain/anthropic')
  return new ChatAnthropic({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature ?? cfg.temperature,
    maxTokens: opts.maxTokens ?? cfg.maxTokens,
    // anthropicApiUrl = baseUrl(Anthropic SDK 的 baseURL 别名);clientOptions 透传 extraConfig(fetch/headers 等)
    ...(cfg.baseUrl ? { anthropicApiUrl: cfg.baseUrl } : {}),
    ...(cfg.extraConfig ? { clientOptions: cfg.extraConfig } : {}),
  })
}
