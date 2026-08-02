# Tasks: revive-observability-tracing (Phase 3)

> 关联 `proposal.md`。**已实施(2.19)**,代码+测试+真 LLM 实测完成。

## P0 — TraceSpan 模型 + 采集
- [x] `createAgent.ts`:TraceSpan/TraceMetrics/SpanType/SpanStatus 类型 export
- [x] `spans` shallowRef + `startSpan`(创建即 push)/ `endSpan`(更新字段)+ onSpan/onTrace 回调(tracing 关 no-op)
- [x] 4 埋点:round(while 内 startSpan)/ model(包 modelHandler)/ tool(包 toolHandler)/ compression(包 compressInput)
- [x] `onTrace` finally(createAgent 调用结束 emit spans + metrics)
- [x] 重置同步(`debugLogs.value = []` 处加 `spans.value = []`)+ return spans

## P0 — getTraceMetrics + 接通
- [x] `utils/traceMetrics.ts`:`getTraceMetrics(spans)` 纯函数(轮次/延迟/工具成功率/重试/压缩/token)
- [x] `inspect().trace`(createChatSdk getInfo 加 trace 字段)
- [x] `onEvent('trace')`(SdkEvent 加 trace 分支 + createChatSdk onTrace → emit)
- [x] `capabilities.tracing` opt-in(默认关)
- [x] DebugDrawer 第 4 tab 🌳 Trace(metrics 卡片 + span 列表 + CSS)

## P0 — 测试
- [x] selftest `sec-42`(getTraceMetrics 白盒 11 项:空兜底/rounds/tool 成功率/model/compression/token/duration/avg/无 usage)
- [x] e2e `inspect.mjs`(tracing:true → trace 存在;默认关 undefined)
- [x] 真 LLM 实测 `trace-real-llm.ts`(draft 多轮 → spans 72 round:23/model:23/tool:25 + metrics 轮次=23 延迟=100s 工具 ✅84%)

## P1 — 文档
- [x] `CHANGELOG.md`:[Unreleased] Added
- [x] `CLAUDE.md`:capabilities.tracing 注释
- [ ] `doc/usage-guide.md`/`.en.md`:tracing 用法(发布时补)
- [ ] `doc/capability-boundaries.md`:B7 移「能做」(发布时补)

## 收口
- [x] 门禁:selftest 980 / e2e 256 / build / exports 6 / types / 真 LLM 实测 全过
- [ ] 归档 + project.md 更新
