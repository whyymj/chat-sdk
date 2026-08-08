/**
 * LLM 解析纯/半纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期二)。
 * 含 isChatModel(实例判定)/ extractText(响应文本提取)/ buildSummaryLlmInvoke(摘要 invoke)/ resolveLlm(初始装配入口)。
 *
 * 注:主 LLM 实例化(currentLlm)与 setLlm 运行时切换由 buildCore/createAgent 管(闭包依赖 modelCaps/currentLlm),
 * 本模块只解析 modelCaps + summaryLlmInvoke + 提供实例判定/文本提取。
 */
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { resolveModelCaps, type ModelCaps } from '../utils/modelCaps'
import type { ChatSdkOptions, LLMConfig } from './createChatSdk'
import { constructLlmFromConfig } from '../llm/constructLlm'
import type { AgentMessage } from '../types'

/**
 * 从首条 user 消息派生会话标题(截取前 30 字 + …,供历史列表显示,替代「会话 xxxxxx」)。
 * 纯函数:无 user → undefined;content 是 string 或 parts 数组(parts 取 .text 拼接);超 30 字截断。
 */
export function deriveTitle(msgs: AgentMessage[]): string | undefined {
  const u = msgs.find((m) => m.role === 'user')
  if (!u) return undefined
  const c = (u as any).content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('') : String(c ?? '')
  const t = text.trim().replace(/[\n\r]+/g, ' ')
  if (!t) return undefined
  return t.length > 30 ? t.slice(0, 30) + '…' : t
}

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
  // 实例直用(presetLlm);LLMConfig cfg lazy 构造(首次 invoke,async 上下文承载 Anthropic 动态 import,不阻塞 resolveLlm 同步签名)
  const presetLlm: BaseChatModel | null = isChatModel(llmOpt) ? llmOpt : null
  const cfg: LLMConfig | null = isChatModel(llmOpt) ? null : (llmOpt as LLMConfig)
  if (cfg && !cfg.apiKey) {
    // 显式配了 summaryLlm 却无效(apiKey 缺失):非 debug 也 warn,避免"以为用了专用模型实际回退了主模型/索引摘要"
    if (options.summaryLlm) {
      console.warn('[page-agent-sdk][summarization] summaryLlm 已配置但缺 apiKey,摘要回退主 agent 模型或零成本索引摘要')
    }
    return undefined
  }
  let cachedLlm: BaseChatModel | null = presetLlm
  return async (prompt: string) => {
    // 超时保护:摘要 LLM 卡住时 reject → useContextManager 的 try/catch 回退索引摘要,不阻塞用户首次响应
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      // lazy 构造:首次 invoke(async);失败抛 → useContextManager compress 的 try/catch 回退索引摘要
      if (!cachedLlm && cfg) cachedLlm = await constructLlmFromConfig(cfg, { temperature, maxTokens })
      const res = await cachedLlm!.invoke(
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
 * 构建标题生成 LLM invoke(供 persistRuntime 自动生成会话标题,像 ChatGPT 总结主旨)。
 * 优先 options.titleLlm → summaryLlm → llm;实例优先,否则按 LLMConfig 构造 ChatOpenAI(低温 + 限 30 token)。
 * 失败/无 apiKey → undefined(调用方用 deriveTitle 规则兜底)。
 */
export function buildTitleLlmInvoke(options: ChatSdkOptions): ((messages: AgentMessage[]) => Promise<string>) | undefined {
  const llmOpt = options.titleLlm ?? options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  // 实例直用(presetLlm);LLMConfig cfg lazy 构造(首次 invoke,async 承载 Anthropic 动态 import)
  const presetLlm: BaseChatModel | null = isChatModel(llmOpt) ? llmOpt : null
  const cfg: LLMConfig | null = isChatModel(llmOpt) ? null : (llmOpt as LLMConfig)
  if (cfg && !cfg.apiKey) return undefined
  let cachedLlm: BaseChatModel | null = presetLlm
  return async (messages: AgentMessage[]) => {
    const dialogue = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n')
      .slice(0, 800)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 10000)
    try {
      // lazy 构造:首次 invoke(async);失败抛 → 外层 catch return ''(fire-and-forget 容错)
      if (!cachedLlm && cfg) cachedLlm = await constructLlmFromConfig(cfg, { temperature: 0, maxTokens: 30 })
      const res = await cachedLlm!.invoke(
        [
          new SystemMessage('根据以下对话的主旨,生成一个简短的中文标题(不超过15个字,不要标点和引号,直接输出标题文字)。'),
          new HumanMessage(dialogue),
        ],
        { signal: ac.signal } as any,
      )
      return extractText(res).trim().replace(/^["'""「『]|["'""」』]$/g, '').split('\n')[0].slice(0, 20)
    } catch {
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 解析初始模型能力 + 摘要/标题 LLM invoke(供 buildCore 装配)。
 */
export function resolveLlm(options: ChatSdkOptions): {
  modelCaps: ModelCaps
  summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined
  titleLlmInvoke: ((messages: AgentMessage[]) => Promise<string>) | undefined
} {
  const llm = options.llm as any
  const llmCfg = isChatModel(options.llm) ? undefined : (options.llm as LLMConfig)
  const modelCaps = resolveModelCaps({
    // 实例路径也读 .model/.contextWindow(BaseChatModel 实例可能带;stubModel 挂 contextWindow 过校验)
    model: llmCfg?.model ?? llm?.model ?? llm?.modelName,
    contextWindow: options.contextWindow ?? llmCfg?.contextWindow ?? llm?.contextWindow,
    maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens ?? llm?.maxOutputTokens,
  })
  const summaryLlmInvoke = buildSummaryLlmInvoke(options)
  const titleLlmInvoke = buildTitleLlmInvoke(options)
  return { modelCaps, summaryLlmInvoke, titleLlmInvoke }
}
