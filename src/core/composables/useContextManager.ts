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
   * 压缩时注入「当前可操作数据槽 属性」快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)。
   * 提供 getter 则每次压缩把当前注册表 path+description 作为一段附进摘要 system 消息(不进压缩)。
   */
  getRegisteredSlots?: () => { path: string; description: string }[]
  /**
   * 跨轮摘要时,对这些工具的步骤 result 额外保留摘要片段进 summaryMsg(防字段描述被摘要掉)。
   * 如 ['describe_data_slot','list_data_slots'] → 即便 older 轮被摘要,关键字段说明仍在摘要里。
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

/** 估算单条消息 token(content + reasoning + 工具步骤的 args/result) */
function estimateMessageTokens(m: AgentMessage): number {
  let s = typeof m.content === 'string' ? m.content : ''
  if (m.reasoning) s += m.reasoning
  if (m.steps) {
    for (const st of m.steps) {
      s += ' ' + (st.name || '')
      if (st.args != null) s += ' ' + (typeof st.args === 'string' ? st.args : JSON.stringify(st.args))
      if (st.result) s += ' ' + st.result
    }
  }
  return estimateTokens(s)
}

/** 估算一轮 token(user + 所有 assistant 消息) */
function estimateRoundTokens(r: Round): number {
  let t = estimateMessageTokens(r.userMsg)
  for (const m of r.assistantMsgs) t += estimateMessageTokens(m)
  return t
}

/** 用索引摘要（零成本）生成旧轮次摘要文本 */
function indexSummarize(older: Round[], preserve?: Set<string>): string {
  return older
    .map((r) => {
      const q = plainSummary(r.userMsg.content, 60) || '(空)'
      const a = r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : '(无回复)'
      const tools = r.assistantMsgs.flatMap((m) => (m.steps || []).map((s) => s.name))
      const toolTag = tools.length ? ` [工具: ${tools.join(', ')}]` : ''
      // C:对 preserve 集合内的工具,额外保留其 result 摘要(防字段描述被摘要掉)
      let preserveBlock = ''
      if (preserve && preserve.size) {
        const kept: string[] = []
        for (const m of r.assistantMsgs) {
          for (const st of m.steps || []) {
            if (st.name && preserve.has(st.name) && st.result) {
              kept.push(`${st.name}: ${plainSummary(st.result, 120)}`)
            }
          }
        }
        if (kept.length) preserveBlock = `\n  字段提示: ${kept.join(' | ')}`
      }
      return `- 第${r.round}轮：${q} → ${a}${toolTag}${preserveBlock}`
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
    const parts: string[] = [
      `【对话历史摘要】以下是之前 ${older.length} 轮对话的要点（最新 ${recent.length} 轮已完整保留）：`,
      summaryText,
    ]
    if (recallBlock) {
      parts.push(`\n【与当前问题可能相关的早期对话】`, recallBlock)
    }
    // A:注入当前可操作数据槽 属性快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)
    if (config.getRegisteredSlots) {
      try {
        const props = config.getRegisteredSlots()
        if (props.length) {
          const propLines = props.map((p) => `- ${p.path}: ${p.description}`).join('\n')
          parts.push(`\n【当前可操作数据槽 属性(动态增删后的最新状态,操作前以 list_data_slots 为准)】`, propLines)
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
