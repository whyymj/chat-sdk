# Tasks: declarative-middleware-ordering

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。patch(机制化,行为不变)。建议 refactor-module-extraction 之后。

## 期一 — 中间件 priority + 排序

- [ ] `createChatSdk.ts`(或新建 `sdk/middlewareStack.ts`)定义 `MIDDLEWARE_PRIORITY` 常量(覆盖当前所有 builtin 中间件 name)
- [ ] 新增 `composeMiddlewareStack(mws)` 纯函数(priority 稳定排序,用户中间件 Infinity 尾随)
- [ ] `buildCore` 的 `middlewares` 末尾经 `composeMiddlewareStack` 排序后传 createAgent
- [ ] selftest:`composeMiddlewareStack` 排序 + 已知约束断言(dataHint<usageHints / sdk-events 最末 / verify 在用户前 / humanConfirm<approval)
- [ ] e2e `inspect().middleware` 顺序断言

## 期二 — createReconfigurable(setter 收敛)

- [ ] 新建 `src/core/sdk/reconfig.ts`:`createReconfigurable(infoTick, getAgent)` 注册表(register/update)
- [ ] buildCore 注册各 setter handler(tools/llm/memory/subagents/data/skills/addTool/removeTool/...)
- [ ] `sdk.setTools`/`setLlm`/`setMemory`/`setSubagents`/`setData`/`setSkills`/`addTool`/... 改经 `reconfig.update`(对外方法名保留)
- [ ] e2e:现有 setter 用例(setTools/setLlm/...)不破坏

## 期三 — 门禁 + 收口

- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] 可选:`composeMiddlewareStack` 从顶层导出
- [ ] 断言计数同步
- [ ] `doc/architecture.md`:中间件声明式排序 + Reconfigurable 机制说明
- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:断言计数 + 装配机制说明
- [ ] `CHANGELOG.md`:patch 条目(内部机制化)
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
