# Tasks: observability-structured-tracing

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。minor(新增可观测)。建议 unify-error-model 之后(span status 复用 severity)。

## 期一 — TraceSpan 模型 + 采集

- [ ] `src/core/types/index.ts` 新增 `SpanType`/`SpanStatus`/`TraceSpan`/`TraceMetrics`
- [ ] `src/core/harness/createAgent.ts`:新增 `spans` shallowRef + `startSpan`/`endSpan`;在 round/model/tool/compression 节点埋点;return 加 `spans` getter
- [ ] `debugLogs` 保留(兼容);span 数量上限兜底(类比 MAX_DEBUG_LOGS)
- [ ] 新建 `src/core/utils/traceMetrics.ts`:`getTraceMetrics(spans)` 纯函数
- [ ] selftest:`getTraceMetrics` 白盒(round/tool 成功率/usage 聚合)

## 期二 — 外发出口

- [ ] `createChatSdk.ts`:`inspect().trace = { spans, metrics }`;`onEvent('trace')`(afterAgent 发完整树)
- [ ] `src/core/index.ts` + `types/index.d.ts`:导出 `TraceSpan`/`TraceMetrics`/`getTraceMetrics`
- [ ] e2e:`inspect().trace` 非空 + `onEvent('trace')` 收到(mock agent 跑一轮)

## 期三 — DebugDrawer 渲染

- [ ] `DebugDrawer.vue`:树形渲染 spans(round → model/tool 子 span)+ metrics 摘要卡片(轮数/延迟/工具成功率/token)
- [ ] 浏览器手动验证(DebugDrawer 树形展示 + metrics)
- [ ] 断言计数同步

## 期四 — 门禁 + 收口

- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] `npm run test:size`(体积不超阈)
- [ ] `doc/usage-guide.md`:trace 消费 + APM 上报指南(中英同步)
- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:trace 文档 + 断言计数
- [ ] `CHANGELOG.md`:minor 条目(结构化 trace)
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
