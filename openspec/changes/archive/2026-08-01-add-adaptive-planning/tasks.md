# Tasks: add-adaptive-planning

> 状态:**待实施**。关联:`proposal.md`(What/Why)+ `design.md`(How)+ `decision-record.md`(选型)。
> 范围:**轻量版**(框架 `update_todo` + `maxPlanRevisions`;prompt 层 skill + usageHints)。
> 测试同步约定:每完成一个 P0 模块同步补对应测试,与代码同 commit。

## P0 — todos.ts:Todo id + update_todo + maxPlanRevisions 状态机

- [x] `state.ts`:`Todo` 增 `id: string`(注释:输出必有 / 输入可选,向后兼容)
- [x] `todos.ts`:`createTodosMiddleware({ maxPlanRevisions = 5 })` 接收预算参数
- [x] `todos.ts`:`write_todos` 项无 id 时按 index 生成 `t-${i+1}`;保留 LLM 显式传的 id
- [x] `todos.ts`:`update_todo` 工具(`{ id, content?, status? }`);找不到 id 返 `TODO_NOT_FOUND` + 当前 id 列表
- [x] `todos.ts`:`wrapToolCall` 拒同轮 `update_todo` + `write_todos` 同时调(状态冲突)
- [x] `todos.ts`:`maxPlanRevisions` 状态机(`inPlanning` / `planPhaseRounds`):`beforeModel` 计数;`write_todos` 进入 / 超限回灌;`PLAN_EXIT_TOOLS`(write/set_data/edit_data/delete_data)成功退出
- [x] `todos.ts`:`augmentPrompt` 渲染带 id(`#t-1 [status] content`)
- [x] `todos.ts`:暴露 `planPhase` getter(供 inspect)

## P0 — createChatSdk.ts:配置透传 + inspect

- [x] `ChatSdkOptions` 增 `maxPlanRevisions?`(默认 5)
- [x] `createTodosMiddleware({ maxPlanRevisions })` 透传(createChatSdk.ts:583)
- [x] `inspect().planPhase` = `{ inPlanning, rounds, limit }`
- [x] `applySnapshot`(hydrate):旧 todos 无 id 时按 index 补(向后兼容)
- [x] `types/index.d.ts`:`ChatSdkOptions.maxPlanRevisions?` + `AgentInfo.planPhase?`

## P0 — usageHints.ts:自适应规划段

- [x] `planning` 段升级为多行自适应引导(简单直接做 / 复杂先规划 / update_todo 增量 / 方案确认)
- [x] `humanConfirm` 段补第 4 类(规划方案确认 → request_human_confirmation)
- [x] 注入条件不变(`caps.planning !== false`)

## P0 — 内置 adaptive-planning skill

- [x] `skills/adaptive-planning/SKILL.md`(判断复杂度→规划→确认→执行→动态修订 流程)
- [x] `package.json` `files` 含 `skills/adaptive-planning`(分发)

## P0 — 测试三层同步

- [x] selftest(sec-todos 模块):`update_todo` 增量 / `TODO_NOT_FOUND` / id 生成 / `maxPlanRevisions` 阶段计数 / 超限回灌 / 写工具退出 / 重入 / hydrate 补 id / 同轮冲突拒
- [x] e2e(inspect + systemprompt 模块):`inspect().tools` 含 `update_todo` + source=builtin;`inspect().planPhase` 反映;`maxPlanRevisions` 配置反映;默认 usageHints 含自适应规划引导
- [x] browser(planner-demo.spec.ts 扩展或新增):`write_todos` → `update_todo` 标完成 → `write` 执行,断言规划流程走完

## P1 — 文档同步(中英)

- [x] `CLAUDE.md`:架构点补「自适应规划(`update_todo` + `maxPlanRevisions` 阶段防死循环)」+ 工具数(simple/advanced 各 +1 `update_todo`)
- [x] `CHANGELOG.md`:`[Unreleased]` Added
- [x] `doc/usage-guide.md`(中英):`maxPlanRevisions` + `update_todo` 用法
- [x] `README`(中英):特性补自适应规划

## 收口

- [x] 门禁:`npm test`(全过,计数同步)+ `npm run build` + `npm run test:e2e`(全过)+ `npm run test:browser`(全过)+ `test:types` + `test:exports` + `test:size`
- [x] 计数同步:CLAUDE.md / README 的 selftest/e2e/browser 断言计数
- [x] 归档:`openspec archive`(apply 完 + 门禁全绿后)+ `project.md` 更新

> 发布触发约定:commit 后停下询问,不自动 publish。
