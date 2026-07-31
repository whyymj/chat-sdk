# Specification Delta: page-agent-core

> 本文件为 change `observability-structured-tracing` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 结构化 trace(span 树 + metrics 聚合)

系统在 ReAct 循环的关键节点(round / 模型调用 / 工具调用 / 压缩 / 中间件)采集结构化 `TraceSpan`:`{ id, parentId?, name, type, startTs, endTs?, durationMs?, status, attributes, events? }`,type ∈ round/model/tool/compression/middleware,status ∈ ok/error/timeout。span 构成父子树(round span 含其内的 model/tool 子 span),记录耗时与状态。`createAgent` 暴露 `spans` getter;`inspect().trace` 返回 `{ spans, metrics }`;`onEvent('trace')` 在 agent 调用结束(`afterAgent`)发送完整 span 树 + metrics,供集成方上报 APM / 做分布式追踪。

`TraceMetrics` 由纯函数 `getTraceMetrics(spans)` 聚合:轮数、总/平均轮延迟、工具调用数 / 失败数 / 成功率、模型调用数、重试次数、压缩触发数、累计 token(prompt/completion/total)。DebugDrawer 以树形渲染 spans + metrics 摘要。既有 `debugLogs`(扁平数组)保留作兼容视图,`spans` 为结构化主出口(向后兼容,旧消费方不破)。trace 会话级内存(随 debugLogs 重置),不持久化;生产监控由集成方经 `onEvent('trace')` 上报外部 APM。既有离散事件(round_start/tool_call/usage/...)保留向后兼容,trace 是其结构化聚合而非替代。
