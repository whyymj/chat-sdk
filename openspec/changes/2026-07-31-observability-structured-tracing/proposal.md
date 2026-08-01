# Change: observability-structured-tracing

> ⏸ **状态:已评估暂缓(2026-08-01)**
> **结论**:缩水 —— TraceSpan 树 + APM 上报不做,只保留 `getTraceMetrics` 纯函数想法
> **理由**:TraceSpan 树 + timing + APM 上报是后端 agent 框架需求;SDK 用户是前端集成者,`debugLogs` 扁平数组 + DebugDrawer 调试已够。改动面大、收益人群窄。
> **重启触发**:集成方明确提生产监控 / SLA / 分布式追踪需求。
> 决策详情与缩水替代见 [`openspec/deferred.md`](../../deferred.md)。原规划内容保留作底稿,下方不变。

---

> 配套:本变更把可观测性从"`debugLogs` 扁平数组 + 无 metrics"升级为结构化 trace(span 树 + timing/status/usage),供 DebugDrawer 树形渲染 + 集成方监控。与 `unify-error-model`(错误 severity 支撑 span status)、`fix-introspection-consistency`(展示出口收敛)协同。跨 `createAgent.ts` + `types` + `DebugDrawer`,建议在 refactor 与 error-model 之后。

## Why

1. **`debugLogs` 扁平,无层级/无 timing**。当前 `createAgent.ts` 的 `debugLogs` 是 `{timestamp, type, data}[]`,type ∈ context/llm_request/llm_response/tool_call/tool_result/error/middleware,平铺无层级。排查"第 3 轮的哪个工具慢/失败"要在扁平列表里按 timestamp 拼凑,无父子关系、无耗时(只有 timestamp,无 duration)、无状态聚合。

2. **无 metrics**。集成方除 `onEvent('usage')` 外,拿不到"每轮延迟 / 工具成功率 / 重试次数 / 压缩触发频次"等指标。生产监控、性能调优、SLA 评估都缺数据。

3. **集成方观察 trace 的通道缺失**。`onEvent` 只有离散事件(round_start/tool_call/usage/...),无"一次完整 agent 调用的结构化 trace"出口;集成方想做分布式追踪 / 上报 APM,拿不到 span 数据。

## What Changes

### 1. `TraceSpan` 模型 + 采集

- 新增 `TraceSpan`(`types/`):`{ id, parentId?, name, type, startTs, endTs?, durationMs?, status, attributes, events? }`,type ∈ round/model/tool/compression/middleware。
- `createAgent.ts` 在关键节点 start/end span:每轮 agent(round span,含 model/tool 子 span)、模型调用(model span,附 round/tools/usage)、工具调用(tool span,附 name/status/duration)、压缩(compression span,附 stats)。
- `debugLogs` 保留向后兼容(扁平视图),新增 `spans: TraceSpan[]`(树形,主出口)。

### 2. metrics 聚合

- `getTraceMetrics(spans)` 纯函数:聚合每轮延迟、工具成功率(failed/done)、模型调用次数、重试次数、压缩触发次数、token 累计。
- DebugDrawer 展示 metrics 摘要;集成方经 `inspect().trace` 或 `onEvent` 消费。

### 3. trace 事件外发

- `onEvent` 扩展 `trace` 事件(agent 调用结束时发完整 span 树)或 `span` 事件(增量);集成方可上报 APM。
- `inspect().trace` 返回当前 spans + metrics(供 DebugDrawer / 外部消费)。

## Impact

- **改造**:`src/core/types/index.ts`(`TraceSpan`/`TraceMetrics`)、`src/core/harness/createAgent.ts`(各节点 span 采集,`debugLogs` 旁新增 `spans`)、`src/core/components/DebugDrawer.vue`(树形渲染 + metrics)、`src/core/sdk/createChatSdk.ts`(`inspect().trace` + `onEvent('trace')`)。
- **新增导出**:`TraceSpan`/`TraceMetrics` 类型 + `getTraceMetrics` 纯函数。
- **行为变化**:`debugLogs` 保留(兼容);新增 `spans`/`inspect().trace`/`onEvent('trace')`。向后兼容(新出口,旧消费方不破)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(结构化 trace)。
- **测试**:selftest 补 `getTraceMetrics` 白盒 + span 采集逻辑;e2e 补 `inspect().trace` / `onEvent('trace')`。断言计数同步。

## Non-goals

- **不引入** OpenTelemetry 完整 SDK —— 自研轻量 span 模型够用;OTel 体积/依赖大,浏览器场景过重。
- **不持久化** trace —— trace 会话级内存(随 debugLogs 重置);持久化监控由集成方经 `onEvent('trace')` 上报外部 APM。
- **不改** 现有离散事件(round_start/tool_call/usage/...)—— 它们仍发(向后兼容);trace 是其结构化聚合,非替代。
- **不做** 实时 span 流式推送(本期 agent 调用结束发完整树);实时流式留后续(需背压/增量协议)。
- **不改** `debugLogs` 的现有字段 —— 保留作扁平视图;新增 `spans` 为主出口,DebugDrawer 可二选一渲染。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `TraceSpan` 模型 + createAgent 采集 + `getTraceMetrics` 纯函数 | 中(createAgent 改动) | ✅ minor |
| 期二 | `inspect().trace` + `onEvent('trace')` 外发 | 低 | ✅ minor(叠加) |
| 期三 | DebugDrawer 树形渲染 + metrics 摘要 | 低(UI) | ✅ minor(叠加) |

期一是核心(采集),二三消费。建议在 `unify-error-model` 之后(span status 复用 severity)。三期 minor(新增可观测能力,向后兼容)。
