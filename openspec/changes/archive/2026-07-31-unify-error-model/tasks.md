# Tasks: unify-error-model

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。跨 createAgent/中间件/types,建议 refactor 之后 + 与 observability 协同。

## 期一 — AgentError 类型 + agent 层路由

- [ ] `src/core/types/index.ts` 新增 `ErrorSeverity` / `AgentError` / `ErrorRouting` 类型 + `routeError` 路由
- [ ] `asAgentError(err, defaultSeverity)` 归一化纯函数
- [ ] `src/core/tools/toolError.ts`:`toolError` 产出标注 `severity:'recoverable'`
- [ ] `createAgent.ts` catch 点按档路由:`coreExecTool`(:306)recoverable / `afterAgent`(:519)observable 记 trace
- [ ] selftest:`routeError` / `asAgentError` 白盒

## 期二 — 中间件契约 + onEvent 结构化

- [ ] `middleware.ts` 文档化中间件错误契约(抛 recoverable = 回灌 feedback;默认 Error = fatal)
- [ ] `wrapToolCall` 捕获 `AgentError(recoverable)` 转 feedback(不中断)
- [ ] `SdkEvent.error` 扩展 `{severity?, code?, context?}`(向后兼容)
- [ ] `createChatSdk.ts` `emit` 回调 observable 处理 + 记 trace
- [ ] e2e:`onEvent('error')` 结构化字段 + 中间件 recoverable→feedback 不中断

## 期三 — 门禁 + 收口

- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] 断言计数同步
- [ ] `doc/usage-guide.md`:错误模型 + severity 分类监控指南(中英同步)
- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:错误模型 + 断言计数
- [ ] `CHANGELOG.md`:期一 patch / 期二 minor 条目
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
