/**
 * 对话轮次分组工具（索引、上下文压缩器共用）
 *
 * 一轮 = 一条用户消息 + 其后紧跟的所有非用户消息（助手回复 / 工具步骤）。
 * 提供 pure 函数，便于在多处复用同一套分组逻辑。
 */
import type { AgentMessage } from '../types'

export interface Round {
  /** 轮次序号（从 1 开始） */
  round: number
  /** 用户消息（一轮必有） */
  userMsg: AgentMessage
  /** 该轮内的助手消息（含思考过程、工具步骤） */
  assistantMsgs: AgentMessage[]
  /** 在原 messages 数组中的起始下标 */
  startIdx: number
  /** 在原 messages 数组中的结束下标（含） */
  endIdx: number
}

/** 将线性消息列表按"用户消息"切分为轮次 */
export function groupRounds(messages: AgentMessage[]): Round[] {
  const rounds: Round[] = []
  let current: Round | null = null
  let roundNo = 0

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'user') {
      if (current) rounds.push(current)
      roundNo++
      current = {
        round: roundNo,
        userMsg: msg,
        assistantMsgs: [],
        startIdx: i,
        endIdx: i,
      }
    } else if (current) {
      current.assistantMsgs.push(msg)
      current.endIdx = i
    }
  }
  if (current) rounds.push(current)
  return rounds
}

/** 去除 markdown 常见符号，生成纯文本摘要 */
export function plainSummary(text: string, max: number): string {
  const plain = (text || '')
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#*_>\-]\s?/g, '')
    .replace(/\[(代码)\]/g, '「代码」')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max) + '…' : plain
}

/** 提取一轮的工具步骤名列表 */
export function roundToolNames(r: Round): string[] {
  const names: string[] = []
  for (const m of r.assistantMsgs) {
    for (const s of m.steps || []) names.push(s.name)
  }
  return names
}

/** 头部"更早对话摘要"system 的内容前缀(由 trimMemoryMessages 产生) */
export const MEMORY_SUMMARY_PREFIX = '【更早对话摘要'

/**
 * 内存对话轮数上限裁剪(纯函数,可单测):超限把最旧轮次压缩为一条摘要 system 消息。
 *
 * 关键:若 messages 头部已有上一轮 trim 留下的"更早对话摘要"system,groupRounds 会跳过它
 * (头部 system 不进任何轮)→ 旧摘要会被 splice 静默丢弃、不并入新摘要 → 更早摘要逐级丢失。
 * 本函数提取头部旧摘要正文,合并进新摘要,保证累积历史不丢。
 *
 * @returns trimmed=false 未触发;trimmed=true 时 deleteFrom/deleteCount/summary 供调用方 splice 原地应用(保持共享响应式引用)
 */
export function trimMemoryMessagesImpl(
  messages: AgentMessage[],
  maxMemoryRounds: number,
): { trimmed: false } | { trimmed: true; deleteFrom: number; deleteCount: number; summary: AgentMessage } {
  if (maxMemoryRounds <= 0) return { trimmed: false }
  const rounds = groupRounds(messages)
  if (rounds.length <= maxMemoryRounds) return { trimmed: false }

  const keepFromIdx = rounds[rounds.length - maxMemoryRounds].startIdx
  const older = rounds.slice(0, rounds.length - maxMemoryRounds)

  // 提取头部已有的旧摘要正文(groupRounds 跳过头部 system,旧摘要不在 older 内,不合并会被丢弃)
  const firstUserIdx = rounds[0].startIdx
  let prevSummary = ''
  for (let i = 0; i < firstUserIdx; i++) {
    const m = messages[i]
    if (m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(MEMORY_SUMMARY_PREFIX)) {
      prevSummary = m.content
      break
    }
  }

  const olderDigest = older
    .map((r) => {
      const q = plainSummary(r.userMsg.content, 60) || '(空)'
      const a = r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : '(无回复)'
      return `- 第${r.round}轮:${q} → ${a}`
    })
    .join('\n')

  // 合并:旧摘要正文(去 header)在前(更早),本轮 older 摘要作"续"追加 → 累积历史不丢
  const prevBody = prevSummary ? prevSummary.replace(/^【[^】]*】\n?/, '') : ''
  const content = prevBody
    ? `${MEMORY_SUMMARY_PREFIX}(${older.length} 轮,含累积)】\n${prevBody}\n【续】\n${olderDigest}`
    : `${MEMORY_SUMMARY_PREFIX}(${older.length} 轮)】\n${olderDigest}`

  return {
    trimmed: true,
    deleteFrom: 0,
    deleteCount: keepFromIdx,
    summary: { role: 'system', content, timestamp: older[0].userMsg.timestamp },
  }
}
