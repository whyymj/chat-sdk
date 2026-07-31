/**
 * 上下文索引纯函数 —— 从 useContextManager.ts 抽离(refactor-module-extraction 期二)。
 * 含停用词 / 分词 / token 估算 / 索引摘要 / 关键词召回。纯函数无状态、易白盒测。
 */
import type { AgentMessage } from '../types'
import { plainSummary, type Round } from '../utils/rounds'
import { estimateTokens } from '../utils/modelCaps'

/** 中文停用词，召回时过滤 */
export const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那', '和', '与',
  '及', '或', '一个', '什么', '怎么', '如何', '为什么', '可以', '能', '请', '帮',
  '一下', '需要', '想要', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on',
])

/** 分词：按非字母数字字符切分，保留长度>=2 且非停用词的 token */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

/** 估算单条消息 token(content + reasoning + 工具步骤的 args/result) */
export function estimateMessageTokens(m: AgentMessage): number {
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
export function estimateRoundTokens(r: Round): number {
  let t = estimateMessageTokens(r.userMsg)
  for (const m of r.assistantMsgs) t += estimateMessageTokens(m)
  return t
}

/** 用索引摘要（零成本）生成旧轮次摘要文本 */
export function indexSummarize(older: Round[], preserve?: Set<string>): string {
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
export function recallRounds(older: Round[], query: string, topK: number): Round[] {
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
