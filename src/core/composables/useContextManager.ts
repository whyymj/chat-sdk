/**
 * 上下文管理器 — 综合压缩策略
 *
 * 融合四种策略的优点：
 * 1. 滑动窗口：最近 N 轮完整保留，保证近期上下文精确
 * 2. 摘要压缩：超出窗口的旧轮次压缩为摘要系统消息
 *    - 默认用"索引摘要"（零 LLM 成本，复用每轮 userQuery/assistantPreview）
 *    - 可选 LLM 摘要（enableLLMSummary）生成更连贯的段落
 * 3. 关键词召回：从旧轮次中按当前问题检索相关历史，注入"相关历史"段
 * 4. 工具结果裁剪：单轮 ReAct 循环内累积的 ToolMessage 超长时截断（见 trimToolResults）
 *
 * 注：跨轮历史中 state.messages 只含 user/assistant 文本，工具结果仅在
 * 单次 chat() 的 ReAct 循环内累积，因此跨轮压缩聚焦于窗口+摘要+召回。
 */
import type { AgentMessage } from '../types'
import type { BaseMessage } from '@langchain/core/messages'
import { ToolMessage } from '@langchain/core/messages'
import { groupRounds, plainSummary, type Round } from '../utils/rounds'

export interface ContextManagerOptions {
  /** 滑动窗口：保留最近几轮完整对话 */
  windowRounds: number
  /** 超过多少轮触发摘要压缩（含窗口内） */
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

/** 中文停用词，召回时过滤 */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那', '和', '与',
  '及', '或', '一个', '什么', '怎么', '如何', '为什么', '可以', '能', '请', '帮',
  '一下', '需要', '想要', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on',
])

/** 分词：按非字母数字字符切分，保留长度>=2 且非停用词的 token */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

/** 用索引摘要（零成本）生成旧轮次摘要文本 */
function indexSummarize(older: Round[]): string {
  return older
    .map((r) => {
      const q = plainSummary(r.userMsg.content, 60) || '(空)'
      const a = r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : '(无回复)'
      const tools = r.assistantMsgs.flatMap((m) => (m.steps || []).map((s) => s.name))
      const toolTag = tools.length ? ` [工具: ${tools.join(', ')}]` : ''
      return `- 第${r.round}轮：${q} → ${a}${toolTag}`
    })
    .join('\n')
}

/** 关键词召回：按当前问题匹配旧轮次，返回最相关的 Top-K */
function recallRounds(older: Round[], query: string, topK: number): Round[] {
  const keywords = tokenize(query)
  if (keywords.length === 0) return []
  const scored = older.map((r) => {
    const hay = (
      r.userMsg.content +
      ' ' +
      r.assistantMsgs.map((m) => m.content).join(' ')
    ).toLowerCase()
    let score = 0
    for (const kw of keywords) {
      if (hay.includes(kw)) score++
    }
    return { r, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.r)
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

    // 未达阈值：不压缩
    if (rounds.length <= config.summaryThresholdRounds) {
      return {
        messages,
        stats: {
          triggered: false,
          roundsTotal: rounds.length,
          roundsSummarized: 0,
          roundsRecalled: 0,
          originalMessages: originalCount,
          compressedMessages: originalCount,
          strategy: 'none',
        },
      }
    }

    // 切分窗口
    const recentCount = Math.min(config.windowRounds, rounds.length)
    const recent = rounds.slice(rounds.length - recentCount)
    const older = rounds.slice(0, rounds.length - recentCount)

    // 当前问题（最新一条用户消息）
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const query = lastUser?.content || ''

    // 摘要
    let summaryText: string
    let strategy: string
    if (config.enableLLMSummary && config.llmInvoke) {
      try {
        summaryText = await config.llmInvoke(indexSummarize(older))
        strategy = 'window+llm_summary'
      } catch {
        summaryText = indexSummarize(older)
        strategy = 'window+index_summary(llm_fallback)'
      }
    } else {
      summaryText = indexSummarize(older)
      strategy = 'window+index_summary'
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
    const parts: string[] = [
      `【对话历史摘要】以下是之前 ${older.length} 轮对话的要点（最新 ${recentCount} 轮已完整保留）：`,
      summaryText,
    ]
    if (recallBlock) {
      parts.push(`\n【与当前问题可能相关的早期对话】`, recallBlock)
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

  return { compress, config, trimToolResults }
}

/**
 * 单轮 ReAct 循环内的工具结果裁剪
 *
 * 随着工具调用轮次增加，currentMessages 中累积的 ToolMessage 可能很长。
 * 保留最近 2 条工具结果完整，更早的工具结果超过 maxChars 时截断并附标记。
 * 原地返回新数组，不修改入参。
 */
export function trimToolResults(messages: BaseMessage[], maxChars: number): BaseMessage[] {
  // 收集所有 ToolMessage 的下标
  const toolIdx: number[] = []
  messages.forEach((m, i) => {
    if (m instanceof ToolMessage) toolIdx.push(i)
  })
  if (toolIdx.length <= 2) return messages

  // 最近 2 条保持完整，其余截断
  const keepFull = new Set(toolIdx.slice(-2))
  return messages.map((m, i) => {
    if (!(m instanceof ToolMessage) || keepFull.has(i)) return m
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    if (content.length <= maxChars) return m
    const truncated = content.slice(0, maxChars) + `\n…[已截断，原长度 ${content.length}]`
    return new ToolMessage({
      tool_call_id: (m as any).tool_call_id || (m as any).lc_id || 'trimmed',
      content: truncated,
    })
  })
}
