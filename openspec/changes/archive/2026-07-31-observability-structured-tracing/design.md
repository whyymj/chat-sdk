# Design: observability-structured-tracing

> 核心约束:**结构化 span 采集,向后兼容 `debugLogs`**。新增 `spans`(树形)为主出口,`debugLogs`(扁平)降级为兼容视图。span 采集嵌入 createAgent 既有节点(每轮/模型/工具/压缩),不改 ReAct 主流程逻辑,只加 start/end 埋点。metrics 由 span 纯函数聚合。

## 1. 现状定位

**`debugLogs`(`createAgent.ts:168-184`)**:`shallowRef<{timestamp,type,data}[]>`,扁平。采集点:`log('context',...)` / `log('llm_request',...)` / `log('llm_response',...)` / `log('tool_call',...)` / `log('tool_result',...)` / `log('error',...)` / `log('middleware',...)`。

**痛点**:无父子层级(round 与其 model/tool 无关联)、无 duration(只有 timestamp)、无 status 聚合、无 metrics 出口。

## 2. 解法

### 2.1 TraceSpan 模型

```ts
// types/index.ts
export type SpanType = 'round' | 'model' | 'tool' | 'compression' | 'middleware'
export type SpanStatus = 'ok' | 'error' | 'timeout'

export interface TraceSpan {
  id: string
  parentId?: string
  name: string
  type: SpanType
  startTs: number
  endTs?: number
  durationMs?: number
  status: SpanStatus
  attributes: Record<string, unknown>
  // round: { round: n, aborted? }  model: { round, tools[], usage? }
  // tool: { name, args?, result? }  compression: { stats }  middleware: { stage }
  events?: { ts: number; name: string; data?: unknown }[]
}
```

### 2.2 采集(createAgent 埋点)

```ts
// createAgent.ts 内部 span 管理(并行于 debugLogs)
const spans = shallowRef<TraceSpan[]>([])
let spanSeq = 0
function startSpan(parentId: string | undefined, type: SpanType, name: string, attributes = {}): TraceSpan {
  const span: TraceSpan = { id: `span-${++spanSeq}`, parentId, name, type, startTs: Date.now(), status: 'ok', attributes }
  spans.value.push(span); triggerRef(spans)
  return span
}
function endSpan(span: TraceSpan, status: SpanStatus = 'ok', extra: Partial<TraceSpan> = {}): void {
  span.endTs = Date.now(); span.durationMs = span.endTs - span.startTs; span.status = status
  Object.assign(span.attributes, extra.attributes ?? {})
  if (extra.events) span.events = (span.events ?? []).concat(extra.events)
  triggerRef(spans)
}

// 循环内:
while (...) {
  const roundSpan = startSpan(undefined, 'round', `round ${rounds+1}`)
  // beforeModel / 模型调用
  const modelSpan = startSpan(roundSpan.id, 'model', `model round ${rounds+1}`, { round: rounds+1, tools: ... })
  const response = await modelHandler(...)
  endSpan(modelSpan, response.aborted ? 'timeout' : 'ok', { attributes: { usage: ..., contentLen: ... } })
  // 工具执行
  for (const c of ctxs) {
    const toolSpan = startSpan(roundSpan.id, 'tool', c.call.name, { name: c.call.name, args: c.call.args })
    const result = await toolHandler(c.ctx)
    endSpan(toolSpan, result.status === 'error' ? 'error' : 'ok', { attributes: { result: result.content.slice(0,200) } })
  }
  endSpan(roundSpan)
}
```

`debugLogs` 保留(`log()` 不动,作扁平兼容视图);`spans` 新增为树形主出口。

### 2.3 metrics 聚合

```ts
// utils/traceMetrics.ts(纯函数)
export interface TraceMetrics {
  rounds: number
  totalDurationMs: number
  avgRoundMs: number
  toolCalls: number
  toolFailures: number
  toolSuccessRate: number
  modelCalls: number
  retries: number
  compressions: number
  totalTokens?: { prompt: number; completion: number; total: number }
}

export function getTraceMetrics(spans: TraceSpan[]): TraceMetrics {
  // 遍历 spans 聚合:round 计数+耗时、tool 计数+失败率、model 计数+重试(error 事件)、compression 计数、usage 累计
}
```

### 2.4 外发 + 消费

- `createAgent` return 加 `spans` getter;`createChatSdk.inspect().trace = { spans: core.agent.spans, metrics: getTraceMetrics(spans) }`。
- `onEvent('trace', { spans, metrics })`:agent 调用结束(`afterAgent`)发完整树;集成方上报 APM。
- DebugDrawer:树形渲染 spans(round → model/tool 子 span)+ metrics 摘要卡片。

## 3. 测试策略

### 3.1 selftest 白盒

```ts
// getTraceMetrics 纯函数
const spans = [
  { id:'1', type:'round', startTs:0, endTs:100, status:'ok', attributes:{} },
  { id:'2', parentId:'1', type:'tool', startTs:10, endTs:50, status:'ok', attributes:{name:'read'} },
  { id:'3', parentId:'1', type:'tool', startTs:60, endTs:80, status:'error', attributes:{name:'write'} },
]
const m = getTraceMetrics(spans)
assert(m.rounds === 1 && m.toolCalls === 2 && m.toolFailures === 1 && m.toolSuccessRate === 0.5)
```

### 3.2 e2e

- `inspect().trace` 返回 spans(非空)+ metrics;`onEvent('trace')` 收到(经 mock agent 跑一轮)。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e` + 断言计数同步。

## 权衡

- **为何自研 span 而非 OTel**:OTel 浏览器 SDK 体积大、依赖重;自研轻量 span(name/type/status/timing/attributes)覆盖 DebugDrawer + APM 上报需求,零依赖。
- **为何保留 `debugLogs`**:现有 DebugDrawer 与外部消费方(若有)依赖扁平 log;保留作兼容视图,`spans` 为主出口,渐进迁移。
- **为何 trace 在 agent 结束发完整树(非实时流式)**:实时流式需背压/增量协议,复杂;本期"结束发树"覆盖 APM 上报与 DebugDrawer 离线查看。实时流式留后续。
- **为何 metrics 纯函数**:易白盒测、可在任意 span 集合上跑(集成方自定义聚合也能复用)。

## 风险

- **采集性能**:每次 start/end span + triggerRef,高频工具调用下有开销。span 数量上限兜底(类比 MAX_DEBUG_LOGS=300);triggerRef 批量化(必要时)。
- **span 体积**:长会话 span 数大。trace 会话级(debugLogs 重置时同步清 spans);上限 + 采样(必要时)。
- **向后兼容**:`debugLogs` 保留,但若 DebugDrawer 全面转 spans,旧字段读取需适配;分期(期三 DebugDrawer 适配)。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/types/index.ts` | `TraceSpan` / `SpanType` / `SpanStatus` / `TraceMetrics` |
| `src/core/harness/createAgent.ts` | `spans` shallowRef + start/endSpan 埋点(round/model/tool/compression);return 加 `spans` getter |
| `src/core/utils/traceMetrics.ts`(新建) | `getTraceMetrics` 纯函数 |
| `src/core/sdk/createChatSdk.ts` | `inspect().trace` + `onEvent('trace')`(afterAgent 发) |
| `src/core/components/DebugDrawer.vue` | 树形渲染 spans + metrics 摘要 |
| `src/core/index.ts` + `types/index.d.ts` | 导出 `TraceSpan`/`TraceMetrics`/`getTraceMetrics` |
| `src/core/__tests__/modules/` | `getTraceMetrics` 白盒 + span 采集(mock agent) |
| `tests/e2e/`(events / inspect) | `inspect().trace` / `onEvent('trace')` 断言 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | trace 文档 + 断言计数 |
