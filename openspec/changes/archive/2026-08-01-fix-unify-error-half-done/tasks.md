# Tasks: fix-unify-error-half-done

> 状态:**待实施**。方向:缩水(保留 routeError 扩展口)。**零行为变化**。关联:本目录 `proposal.md`。

- [ ] `src/core/tools/toolError.ts`:`routeError` 顶部注释诚实化(框架内置 catch 未消费 / 供集成方自定义 + 为未来 wrapToolCall 自动路由预留);`asAgentError`/`agentError` 注释补"catch 归一化用,接口稳定"
- [ ] `src/core/harness/middleware.ts`:删"wrapToolCall 捕获转 feedback"空头承诺,改"规划中,未实现;未来在执行器 catch AgentError → routeError 接通"
- [ ] `src/core/__tests__/modules/sec-19.ts`:`routeError` 断言保留,补注释"框架内部未消费,验证导出可用 + 为未来扩展锁行为"
- [ ] `openspec/specs/page-agent-core.md`:修正"三档错误模型"Requirement(删 routeError 各层路由过头描述 → 内置 catch 简化硬编码 + routeError 供扩展)
- [ ] 门禁:`npm test` + `npm run test:types` 全过(零行为变化,e2e/browser 不受影响)
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问,不自动 publish。
