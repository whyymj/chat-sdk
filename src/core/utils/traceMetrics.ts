/**
 * getTraceMetrics —— 从 TraceSpan[] 聚合 metrics(纯函数,可白盒单测)。
 * revive-observability-tracing Phase 3。
 *
 * 类型(TraceSpan/TraceMetrics)from createAgent(类型擦除,无运行时循环);
 * getTraceMetrics 是值 export,createAgent finally import 它算 metrics 传 onTrace。
 */
import type { TraceSpan, TraceMetrics } from '../harness/createAgent'

/**
 * 聚合 spans 为 metrics:
 * - rounds = round span 数
 * - totalDurationMs = 最早 startTs → 最后 endTs(含未结束 span 的 startTs 兜底)
 * - toolCalls/Failures = tool span(status error 计失败)
 * - modelCalls = model span 数;retries = model span attributes.retry 标记
 * - compressions = compression span 数
 * - totalTokens = model span attributes.usage(prompt_tokens/completion_tokens)累计
 */
export function getTraceMetrics(spans: TraceSpan[]): TraceMetrics {
  if (!spans.length) {
    return { rounds: 0, totalDurationMs: 0, avgRoundMs: 0, toolCalls: 0, toolFailures: 0, toolSuccessRate: 1, modelCalls: 0, retries: 0, compressions: 0 }
  }
  const rounds = spans.filter((s) => s.type === 'round').length
  const modelSpans = spans.filter((s) => s.type === 'model')
  const toolSpans = spans.filter((s) => s.type === 'tool')
  const compSpans = spans.filter((s) => s.type === 'compression')
  const toolFailures = toolSpans.filter((s) => s.status === 'error').length
  const startTs = Math.min(...spans.map((s) => s.startTs))
  const endTs = Math.max(...spans.map((s) => s.endTs ?? s.startTs))
  const totalDurationMs = endTs - startTs
  const retries = modelSpans.filter((s) => s.attributes.retry).length
  let prompt = 0
  let completion = 0
  for (const s of modelSpans) {
    const u = s.attributes.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (u) {
      prompt += u.prompt_tokens ?? 0
      completion += u.completion_tokens ?? 0
    }
  }
  return {
    rounds,
    totalDurationMs,
    avgRoundMs: rounds ? Math.round(totalDurationMs / rounds) : 0,
    toolCalls: toolSpans.length,
    toolFailures,
    toolSuccessRate: toolSpans.length ? (toolSpans.length - toolFailures) / toolSpans.length : 1,
    modelCalls: modelSpans.length,
    retries,
    compressions: compSpans.length,
    totalTokens: prompt || completion ? { prompt, completion, total: prompt + completion } : undefined,
  }
}
