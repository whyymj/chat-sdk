/**
 * 上下文构成分析(context-inspector)—— 纯函数
 *
 * 对「实际发给 LLM 的消息数组」(含所有 augmentPrompt 注入段)分类切分 + token 估算,
 * 供 ChatDialog 占用进度条 + DebugDrawer「📊 上下文」tab 展示大小/分类/占比。
 *
 * 设计:
 * - 输入 LangChain BaseMessage[](非 AgentMessage —— 后者无 tool role,无法承载工具结果)
 * - system 消息按 augmentPrompt 段标记前缀**定位**切分(## 可操作数据 / ## 能力使用提示 / ## 当前主线目标 /
 *   ## 工作记忆 / 【更早对话摘要 / 【对话历史摘要】/ 【与当前问题可能相关的早期对话】),未匹配归 systemPrompt。
 *   用「标记位置」而非「\n\n 分段」:避免段内含 \n\n(如 schema hint 多行)被误拆
 * - 工具结果计 ToolMessage.content + 前置 AIMessage.tool_calls.args(工具参数在 assistant 消息上,漏估会低估 write/patch 占用)
 * - 复用 estimateTokens(modelCaps);纯计算,零 LLM 成本
 * - 分类为近似展示:无标记的 augmentPrompt 段(memory/todos/skills/subagents/augmentSystem)归 systemPrompt 桶
 */
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { estimateTokens } from './modelCaps'
import type { CompressionStats } from '../composables/useContextManager'

/** 单个上下文分类的构成(token + 占比 + 段/消息计数) */
export interface ContextCategory {
  key: string
  label: string
  tokens: number
  /** 占 totalTokens 的比例(0~1) */
  pct: number
  /** system 分类=段数;对话分类=消息数 */
  msgCount: number
}

/** 一次上下文快照(每轮 wrapModelCall 覆盖,不累积) */
export interface ContextSnapshot {
  totalTokens: number
  /** 模型上下文窗口(modelCaps);无则 undefined */
  contextWindow?: number
  /** totalTokens / contextWindow(0~1+;无窗口为 0) */
  occupancy: number
  /** 触发压缩的阈值占比(如 0.5) */
  thresholdRatio: number
  /** 分类明细(按 tokens 降序;空桶不出现) */
  categories: ContextCategory[]
  /** 最近一次压缩统计(直接引用 state.lastCompression,非新增写入) */
  compression?: CompressionStats
}

/** system 段标记前缀 → 分类 key(前缀定位;前缀互不重叠) */
const SYSTEM_MARKERS: Array<{ prefix: string; key: string }> = [
  { prefix: '## 可操作数据', key: 'dataHint' },
  { prefix: '## 能力使用提示', key: 'usageHints' },
  { prefix: '## 当前主线目标', key: 'mission' },
  { prefix: '## 工作记忆', key: 'workingMemory' },
  { prefix: '【更早对话摘要', key: 'memory' },
  { prefix: '【对话历史摘要】', key: 'summary' },
  { prefix: '【与当前问题可能相关的早期对话】', key: 'recall' },
]

/** 分类桶定义(key → label);最终按 tokens 降序排 */
const CATEGORY_DEFS: Array<{ key: string; label: string }> = [
  { key: 'systemPrompt', label: '系统提示词(身份/规则)' },
  { key: 'dataHint', label: '可操作数据(schema)' },
  { key: 'usageHints', label: '能力使用提示' },
  { key: 'mission', label: '主线目标(mission)' },
  { key: 'workingMemory', label: '工作记忆' },
  { key: 'memory', label: '更早对话摘要' },
  { key: 'summary', label: '对话历史摘要' },
  { key: 'recall', label: '相关早期对话(召回)' },
  { key: 'history', label: '历史对话' },
  { key: 'current', label: '当前问题' },
  { key: 'assistant', label: '助手回复' },
  { key: 'toolResults', label: '工具结果/参数' },
  { key: 'other', label: '其他' },
]

export interface AnalyzeContextOptions {
  /** 模型上下文窗口(modelCaps;省略则 occupancy=0) */
  contextWindow?: number
  /** 压缩触发阈值占比(默认 0) */
  thresholdRatio?: number
}

function newBuckets(): Record<string, ContextCategory> {
  const b: Record<string, ContextCategory> = {}
  for (const d of CATEGORY_DEFS) b[d.key] = { key: d.key, label: d.label, tokens: 0, pct: 0, msgCount: 0 }
  return b
}

function addTokens(b: ContextCategory, tokens: number): void {
  b.tokens += tokens
  b.msgCount += 1
}

/** 取消息文本内容(string 原样;非 string 序列化估) */
function textOf(m: BaseMessage): string {
  const c = m.content as unknown
  return typeof c === 'string' ? c : JSON.stringify(c ?? '')
}

/**
 * 按标记前缀定位切分 system 消息内容,各段归对应分类;标记前的内容(身份段)归 systemPrompt。
 * 用「标记位置」而非「\n\n 分段」:避免段内含 \n\n(如 schema hint 多行)被误拆。
 */
function classifySystem(content: string, buckets: Record<string, ContextCategory>): void {
  const marks: Array<{ idx: number; key: string }> = []
  for (const s of SYSTEM_MARKERS) {
    let from = 0
    while (true) {
      const i = content.indexOf(s.prefix, from)
      if (i < 0) break
      marks.push({ idx: i, key: s.key })
      from = i + s.prefix.length
    }
  }
  marks.sort((a, b) => a.idx - b.idx)
  if (!marks.length) {
    const t = content.trim()
    if (t) addTokens(buckets.systemPrompt, estimateTokens(t))
    return
  }
  // 标记前的头部(身份/业务知识/reliableWriteRules)→ systemPrompt
  if (marks[0].idx > 0) {
    const head = content.slice(0, marks[0].idx).trim()
    if (head) addTokens(buckets.systemPrompt, estimateTokens(head))
  }
  // 各标记段:该标记到下一标记(或末尾)
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].idx
    const end = i + 1 < marks.length ? marks[i + 1].idx : content.length
    const seg = content.slice(start, end).trim()
    if (seg) addTokens(buckets[marks[i].key], estimateTokens(seg))
  }
}

/**
 * 对「实际发给 LLM 的消息数组」分类切分 + token 估算。纯函数(无副作用)。
 * @param messages LangChain BaseMessage[](含 system 注入段标记)
 * @param opts contextWindow(模型窗口)/ thresholdRatio(压缩阈值)
 */
export function analyzeContext(messages: BaseMessage[], opts: AnalyzeContextOptions = {}): ContextSnapshot {
  const buckets = newBuckets()
  // 最新 user 消息 index(current vs history 分界)
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastUserIdx = i; break }
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m instanceof SystemMessage) {
      classifySystem(textOf(m), buckets)
    } else if (m instanceof HumanMessage) {
      addTokens(buckets[i === lastUserIdx ? 'current' : 'history'], estimateTokens(textOf(m)))
    } else if (m instanceof AIMessage) {
      const toolCalls = (m as AIMessage).tool_calls ?? []
      if (toolCalls.length) {
        // 工具调用:args 计入 toolResults(工具参数在 assistant 消息上,漏估会显著低估 write/patch 占用)
        const argsText = toolCalls.map((tc) => JSON.stringify(tc.args ?? {})).join(' ')
        addTokens(buckets.toolResults, estimateTokens(argsText))
      } else {
        addTokens(buckets.assistant, estimateTokens(textOf(m)))
      }
    } else if (m instanceof ToolMessage) {
      addTokens(buckets.toolResults, estimateTokens(textOf(m)))
    } else {
      addTokens(buckets.other, estimateTokens(textOf(m)))
    }
  }

  const categories = Object.values(buckets).filter((b) => b.tokens > 0)
  categories.sort((a, b) => b.tokens - a.tokens)
  const totalTokens = categories.reduce((s, c) => s + c.tokens, 0)
  for (const c of categories) c.pct = totalTokens > 0 ? c.tokens / totalTokens : 0

  const contextWindow = opts.contextWindow
  return {
    totalTokens,
    contextWindow,
    occupancy: contextWindow ? totalTokens / contextWindow : 0,
    thresholdRatio: opts.thresholdRatio ?? 0,
    categories,
  }
}
