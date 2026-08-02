# Change: revive-observability-tracing (Phase 3)

> 结构化追踪 TraceSpan 树(性能归因/错误追溯/调试)。Phase 3 opt-in。
> **状态:已实施(2.19)**。旧 `observability-structured-tracing`(archive)重启版。

## Why
`debugLogs` 扁平 `{timestamp, type, data}[]` 无层级/timing/metrics,调试长任务时不知哪轮慢/失败/烧 token(实测痛点:DSML 诊断加了好几轮 console.log 才定位)。

## What Changes
1. **TraceSpan 模型**(`createAgent.ts`):round/model/tool/compression span + startTs/endTs/durationMs/status/attributes
2. **采集**(createAgent 4 埋点:round/model/tool/compression + `onSpan`/`onTrace` 回调,tracing 关时 no-op 零开销;`startSpan` 创建即 push → round span 不 end 也有)
3. **`getTraceMetrics` 纯函数**(`utils/traceMetrics.ts`):轮次/延迟/工具成功率/重试/压缩/token 聚合
4. **DebugDrawer 第 4 tab 🌳 Trace**:metrics 卡片 + span 列表
5. **`inspect().trace`** + **`onEvent('trace')`**(createAgent finally → onTrace → emit)
6. **`capabilities.tracing`** opt-in 默认关(采集有开销)

## Impact
- 改造:`createAgent.ts`(spans/startSpan/endSpan + 4 埋点 + onTrace finally)+ `utils/traceMetrics.ts`(新)+ `DebugDrawer.vue`(第 4 tab)+ `createChatSdk.ts`(useTracing + onTrace + getInfo trace)+ `types`(SdkEvent trace + AgentInfo trace + capabilities.tracing)+ `index.ts`(导出)
- 新增导出:`TraceSpan`/`TraceMetrics`/`getTraceMetrics`
- 测试:selftest `sec-42`(getTraceMetrics 11 项)+ e2e inspect(trace 反映)+ 真 LLM 实测(`trace-real-llm.ts`)

## 决策
- **采集在 createAgent 内部**(非中间件 —— round span 跨中间件视野,beforeAgent/afterAgent 每次调用只跑一次非每轮)
- **onSpan/onTrace 回调**(tracing 关时 startSpan/endSpan no-op 零开销,不影响现有性能)
- **startSpan 创建即 push**(round span 不 endSpan 也有记录;model/tool 在 endSpan 更新字段)
