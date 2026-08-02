/**
 * sec-42:getTraceMetrics 纯函数(observability-tracing Phase 3)
 * - rounds / tool 成功率 / model / compression / token 聚合
 * - 空 spans 兜底(toolSuccessRate=1 防 NaN);无 usage → totalTokens undefined
 */
import { getTraceMetrics } from '../../utils/traceMetrics'
import type { TraceSpan } from '../../harness/createAgent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[observability · getTraceMetrics]')
  // 空 spans 兜底
  const empty = getTraceMetrics([])
  assert(empty.rounds === 0 && empty.toolCalls === 0 && empty.toolSuccessRate === 1, '✓ getTraceMetrics 空 spans → 兜底(toolSuccessRate=1 防 NaN)')

  // 构造 spans:2 round + 1 model(usage) + 2 tool(1 ok 1 error) + 1 compression
  const spans: TraceSpan[] = [
    { id: 'r1', type: 'round', name: 'round 1', startTs: 1000, endTs: 2000, durationMs: 1000, status: 'ok', attributes: { round: 1 } },
    { id: 'r2', type: 'round', name: 'round 2', startTs: 2000, endTs: 3500, durationMs: 1500, status: 'ok', attributes: { round: 2 } },
    { id: 'm1', parentId: 'r1', type: 'model', name: 'gpt', startTs: 1100, endTs: 1500, durationMs: 400, status: 'ok', attributes: { round: 1, usage: { prompt_tokens: 100, completion_tokens: 50 } } },
    { id: 't1', parentId: 'r1', type: 'tool', name: 'read', startTs: 1600, endTs: 1700, durationMs: 100, status: 'ok', attributes: { name: 'read' } },
    { id: 't2', parentId: 'r2', type: 'tool', name: 'write', startTs: 2100, endTs: 2200, durationMs: 100, status: 'error', attributes: { name: 'write' } },
    { id: 'c1', type: 'compression', name: 'compress:summarization', startTs: 900, endTs: 950, durationMs: 50, status: 'ok', attributes: { stats: {} } },
  ]
  const m = getTraceMetrics(spans)
  assert(m.rounds === 2, '✓ getTraceMetrics → rounds=2(round span 数)')
  assert(m.modelCalls === 1, '✓ getTraceMetrics → modelCalls=1')
  assert(m.toolCalls === 2 && m.toolFailures === 1, '✓ getTraceMetrics → toolCalls=2 failures=1(write error)')
  assert(m.toolSuccessRate === 0.5, '✓ getTraceMetrics → toolSuccessRate=0.5(1/2)')
  assert(m.compressions === 1, '✓ getTraceMetrics → compressions=1')
  assert(m.totalTokens?.prompt === 100 && m.totalTokens?.completion === 50 && m.totalTokens?.total === 150, '✓ getTraceMetrics → token 累计(prompt 100 + completion 50 = 150)')
  assert(m.totalDurationMs === 3500 - 900, '✓ getTraceMetrics → totalDurationMs(最早 startTs 900 → 最后 endTs 3500 = 2600)')
  assert(m.avgRoundMs === Math.round(2600 / 2), '✓ getTraceMetrics → avgRoundMs=1300(total/rounds)')

  // 无 usage 的 model span → totalTokens undefined
  const spansNoUsage: TraceSpan[] = [
    { id: 'r1', type: 'round', name: 'r1', startTs: 0, endTs: 100, status: 'ok', attributes: {} },
    { id: 'm1', parentId: 'r1', type: 'model', name: 'gpt', startTs: 10, endTs: 50, status: 'ok', attributes: {} },
  ]
  const m2 = getTraceMetrics(spansNoUsage)
  assert(m2.totalTokens === undefined, '✓ getTraceMetrics → 无 usage → totalTokens undefined(不误报 0)')
}
