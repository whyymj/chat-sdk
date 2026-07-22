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
