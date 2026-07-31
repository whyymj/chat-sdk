/**
 * LLM 解析纯/半纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期二)。
 * 含 isChatModel(实例判定)/ extractText(响应文本提取)/ buildSummaryLlmInvoke(摘要 invoke)/ resolveLlm(初始装配入口)。
 *
 * 注:主 LLM 实例化(currentLlm)与 setLlm 运行时切换由 buildCore/createAgent 管(闭包依赖 modelCaps/currentLlm),
 * 本模块只解析 modelCaps + summaryLlmInvoke + 提供实例判定/文本提取。
 */
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { resolveModelCaps, type ModelCaps } from '../utils/modelCaps'
import type { ChatSdkOptions, LLMConfig } from './createChatSdk'

/** 判定 llm 选项是模型实例(BaseChatModel)还是配置对象(LLMConfig) */
export function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 从 LLM 响应消息提取文本内容(content 可能是 string 或 content parts 数组) */
export function extractText(msg: BaseMessage): string {
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('')
  }
  return String(c ?? '')
}

/**
 * 构建摘要用 LLM invoke 函数(供 summarization 中间件 llmInvoke)。
 * 优先用 options.summaryLlm(专用压缩模型,如更便宜的小模型);未配则回退主 agent 模型(options.llm)。
 * 复用实例或按 LLMConfig 另构造 ChatOpenAI(低温 + 限输出,压缩成连贯段落)。
 * 温度/输出/超时可配(summaryTemperature/summaryMaxTokens/summaryTimeoutMs);超时回退索引摘要(不阻塞用户)。
 */
export function buildSummaryLlmInvoke(options: ChatSdkOptions): ((prompt: string) => Promise<string>) | undefined {
  const llmOpt = options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  const temperature = options.summaryTemperature ?? 0.3
  const maxTokens = options.summaryMaxTokens ?? 1024
  const timeoutMs = options.summaryTimeoutMs ?? 15000
  let llm: BaseChatModel
  if (isChatModel(llmOpt)) {
    llm = llmOpt
  } else {
    const cfg = llmOpt as LLMConfig
    if (!cfg.apiKey) {
      // 显式配了 summaryLlm 却无效(apiKey 缺失):非 debug 也 warn,避免"以为用了专用模型实际回退了主模型/索引摘要"
      if (options.summaryLlm) {
        console.warn('[page-agent-sdk][summarization] summaryLlm 已配置但缺 apiKey,摘要回退主 agent 模型或零成本索引摘要')
      }
      return undefined
    }
    llm = new ChatOpenAI({
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature,
      maxTokens,
      configuration: { ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}), ...cfg.extraConfig },
      ...(cfg.extraBody ? { modelKwargs: cfg.extraBody } : {}),
    })
  }
  return async (prompt: string) => {
    // 超时保护:摘要 LLM 卡住时 reject → useContextManager 的 try/catch 回退索引摘要,不阻塞用户首次响应
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await llm.invoke(
        [
          new SystemMessage('你是对话历史压缩助手。把下面按轮次索引的对话要点,改写成一段连贯、紧凑的中文摘要,保留关键事实、用户意图与已用工具,不要编造。直接输出摘要正文。'),
          new HumanMessage(prompt),
        ],
        { signal: ac.signal } as any,
      )
      return extractText(res).trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 解析初始模型能力 + 摘要 LLM invoke(供 buildCore 装配)。
 * 返回 {modelCaps, summaryLlmInvoke};主 LLM 实例化(currentLlm)与 setLlm 运行时切换由 buildCore/createAgent 管(闭包依赖)。
 */
export function resolveLlm(options: ChatSdkOptions): {
  modelCaps: ModelCaps
  summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined
} {
  const llmCfg = isChatModel(options.llm) ? undefined : (options.llm as LLMConfig)
  const modelCaps = resolveModelCaps({
    model: llmCfg?.model,
    contextWindow: options.contextWindow ?? llmCfg?.contextWindow,
    maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens,
  })
  const summaryLlmInvoke = buildSummaryLlmInvoke(options)
  return { modelCaps, summaryLlmInvoke }
}
