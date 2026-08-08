/**
 * 上下文管理器 — 综合压缩策略
 *
 * 融合四种策略的优点：
 * 1. 滑动窗口：最近 N 轮完整保留，保证近期上下文精确
 * 2. 摘要压缩：超出窗口的旧轮次压缩为摘要系统消息
 *    - 默认用"索引摘要"（零 LLM 成本，复用每轮 userQuery/assistantPreview）
 *    - 可选 LLM 摘要（enableLLMSummary）生成更连贯的段落
 * 3. 关键词召回：从旧轮次中按当前问题检索相关历史，注入"相关历史"段
 * 4. 单轮 ReAct 内的工具结果裁剪由 createAgent 侧的 trimContextIfNeededImpl 处理（本模块不负责）
 *
 * 注：跨轮历史中 state.messages 只含 user/assistant 文本，工具结果仅在
 * 单次 chat() 的 ReAct 循环内累积，因此跨轮压缩聚焦于窗口+摘要+召回。
 */
import type { AgentMessage } from '../types'
import { groupRounds, plainSummary, parseSummarySegment, type Round } from '../utils/rounds'
import { estimateRoundTokens, indexSummarize, recallRounds } from './contextIndex'
import { estimateTokens } from '../utils/modelCaps'

export interface ContextManagerOptions {
  /** 滑动窗口：保留最近几轮完整对话（轮数模式用） */
  windowRounds: number
  /** 超过多少轮触发摘要压缩（轮数模式用,含窗口内） */
  summaryThresholdRounds: number
  /** 旧工具结果截断长度（单轮 ReAct 内） */
  toolResultMaxChars: number
  /** 是否启用关键词召回相关历史 */
  enableRecall: boolean
  /** 召回的最大轮次数 */
  recallTopK: number
  /** 是否启用 LLM 增强摘要（否则用零成本索引摘要） */
  enableLLMSummary: boolean
  /** 用于摘要的 LLM invoke 函数（可选） */
  llmInvoke?: (prompt: string) => Promise<string>
  /** 模型上下文窗口(token);提供则按 token 触发压缩 + token 窗口(自适应大模型),否则按轮数 */
  contextWindow?: number
  /** 触发压缩的 token 比例(默认 0.5:历史估算 token > contextWindow*0.5 时压缩) */
  summaryThresholdRatio?: number
  /** 保留最近窗口的 token 预算比例(默认 0.4) */
  windowRatio?: number
  /**
   * 压缩时注入「当前可操作数据」快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)。
   * 提供 getter 则每次压缩把当前主数据 description 作为一段附进摘要 system 消息(不进压缩)。
   */
  getRegisteredData?: () => { description: string }[]
  /** @deprecated 旧多对象模型遗留(单对象 data 模式用 getRegisteredData);仍兼容,返回值 path 字段忽略 */
  getRegisteredSlots?: () => { path: string; description: string }[]
  /**
   * 跨轮摘要时,对这些工具的步骤 result 额外保留摘要片段进 summaryMsg(防字段描述被摘要掉)。
   * 如 ['describe_data','read'] → 即便 older 轮被摘要,关键字段说明仍在摘要里。
   */
  preserveLastToolResults?: string[]
}

export interface CompressionStats {
  triggered: boolean
  roundsTotal: number
  roundsSummarized: number
  roundsRecalled: number
  originalMessages: number
  compressedMessages: number
  strategy: string
}

export const DEFAULT_CONTEXT_OPTIONS: ContextManagerOptions = {
  windowRounds: 6,
  summaryThresholdRounds: 8,
  toolResultMaxChars: 800,
  enableRecall: true,
  recallTopK: 3,
  enableLLMSummary: false,
}

export function useContextManager(opts: Partial<ContextManagerOptions> = {}) {
  const config: ContextManagerOptions = { ...DEFAULT_CONTEXT_OPTIONS, ...opts }

  /**
   * 压缩跨轮历史，返回注入摘要后的消息列表与统计。
   * 若未达阈值，原样返回（triggered=false）。
   */
  async function compress(
    messages: AgentMessage[]
  ): Promise<{ messages: AgentMessage[]; stats: CompressionStats }> {
    const rounds = groupRounds(messages)
    const originalCount = messages.length

    // 提取头部 trimMemoryMessages 留下的旧摘要正文(groupRounds 跳过头部 system,不并入 older →
    // 需手动并入新摘要,防累积历史被 summarization 静默丢失)
    let prevSummaryBody = ''
    if (rounds.length) {
      const firstUserIdx = rounds[0].startIdx
      for (let i = 0; i < firstUserIdx; i++) {
        const m = messages[i]
        if (m.role === 'system') {
          // 经共享 parseSummarySegment 提取头部旧摘要(消除与 rounds.ts 的提取重复;unify-context-compression)
          const seg = parseSummarySegment(m.content as string)
          if (seg) { prevSummaryBody = seg.body; break }
        }
      }
    }

    const notTriggered = (strategy: string) => ({
      messages,
      stats: {
        triggered: false,
        roundsTotal: rounds.length,
        roundsSummarized: 0,
        roundsRecalled: 0,
        originalMessages: originalCount,
        compressedMessages: originalCount,
        strategy,
      },
    })

    // 切分窗口:token 驱动(大模型自适应)优先,否则按轮数
    let recent: Round[]
    let older: Round[]
    let strategyPrefix: string
    if (config.contextWindow && config.contextWindow > 0) {
      const totalTokens = rounds.reduce((s, r) => s + estimateRoundTokens(r), 0)
      const threshold = config.contextWindow * (config.summaryThresholdRatio ?? 0.5)
      if (totalTokens <= threshold) return notTriggered('none')
      const windowBudget = config.contextWindow * (config.windowRatio ?? 0.4)
      // 从最新轮往回累加 token,加进去就超预算的轮纳入 older(被摘),其后保留
      let acc = 0
      let splitIdx = 0
      for (let i = rounds.length - 1; i >= 0; i--) {
        acc += estimateRoundTokens(rounds[i])
        if (acc >= windowBudget) {
          splitIdx = i + 1
          break
        }
      }
      if (splitIdx > rounds.length - 1) splitIdx = rounds.length - 1 // 至少保留最新 1 轮
      if (splitIdx < 0) splitIdx = 0
      recent = rounds.slice(splitIdx)
      older = rounds.slice(0, splitIdx)
      if (!older.length) return notTriggered('none')
      strategyPrefix = 'token-window+'
    } else {
      if (rounds.length <= config.summaryThresholdRounds) return notTriggered('none')
      const recentCount = Math.min(config.windowRounds, rounds.length)
      recent = rounds.slice(rounds.length - recentCount)
      older = rounds.slice(0, rounds.length - recentCount)
      strategyPrefix = 'window+'
    }

    // 当前问题（最新一条用户消息）
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const query = lastUser?.content || ''

    // 摘要
    const preserveSet = config.preserveLastToolResults?.length ? new Set(config.preserveLastToolResults) : undefined
    let summaryText: string
    let strategy: string
    if (config.enableLLMSummary && config.llmInvoke) {
      try {
        summaryText = await config.llmInvoke(indexSummarize(older, preserveSet))
        strategy = strategyPrefix + 'llm_summary'
      } catch {
        summaryText = indexSummarize(older, preserveSet)
        strategy = strategyPrefix + 'index_summary(llm_fallback)'
      }
    } else {
      summaryText = indexSummarize(older, preserveSet)
      strategy = strategyPrefix + 'index_summary'
    }

    // 召回
    const recalled = config.enableRecall ? recallRounds(older, query, config.recallTopK) : []
    const recallBlock = recalled.length
      ? recalled
          .map(
            (r) =>
              `- 第${r.round}轮：${plainSummary(r.userMsg.content, 60)} → ${r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : ''}`
          )
          .join('\n')
      : ''

    // 组装注入的系统消息
    const fullSummaryText = prevSummaryBody
      ? `${summaryText}\n【更早累积摘要】\n${prevSummaryBody}`
      : summaryText
    const parts: string[] = [
      `【对话历史摘要】以下是之前 ${older.length} 轮对话的要点（最新 ${recent.length} 轮已完整保留）：`,
      fullSummaryText,
    ]
    if (recallBlock) {
      parts.push(`\n【与当前问题可能相关的早期对话】`, recallBlock)
    }
    // A:注入当前可操作数据快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)
    const regGetter = config.getRegisteredData ?? config.getRegisteredSlots
    if (regGetter) {
      try {
        const props = regGetter()
        if (props.length) {
          const propLines = props.map((p) => `- ${(p as any).path ? (p as any).path + ': ' : ''}${p.description}`).join('\n')
          parts.push(`\n【当前可操作数据(动态增删后的最新状态,操作前以 describe_data / read 为准)】`, propLines)
        }
      } catch {
        /* getter 抛错不影响压缩 */
      }
    }
    const summaryMsg: AgentMessage = {
      role: 'system',
      content: parts.join('\n'),
      timestamp: Date.now(),
    }

    // 展开最近窗口的原始消息
    const recentMessages: AgentMessage[] = []
    for (const r of recent) {
      recentMessages.push(r.userMsg)
      recentMessages.push(...r.assistantMsgs)
    }

    const compressed = [summaryMsg, ...recentMessages]

    // H2(harden-context-resilience):压缩后 over-window 复查(单条大 user + summary 仍超窗口)
    const compressedTokens = compressed.reduce(
      (s, m) => s + estimateTokens(typeof m.content === 'string' ? (m.content as string) : JSON.stringify(m.content)),
      0,
    )
    if (config.contextWindow && compressedTokens > config.contextWindow) {
      // 压缩后仍超(单条 user/system 超窗口,compress 无法进一步压)→ observable warn(P3 反应性重试 / Phase 5 系统段兜底)
      console.warn(`[page-agent-sdk] compress 后仍超窗口:${compressedTokens} > ${config.contextWindow} tokens(单条消息超窗口,compress 无法压)`)
    }

    return {
      messages: compressed,
      stats: {
        triggered: true,
        roundsTotal: rounds.length,
        roundsSummarized: older.length,
        roundsRecalled: recalled.length,
        originalMessages: originalCount,
        compressedMessages: compressed.length,
        strategy,
      },
    }
  }

  return { compress, config }
}


