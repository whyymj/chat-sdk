# Tasks: focus-auto-switch

> 三 phase 独立 commit(selftest/e2e 绿后)。依赖:三模块独立,建议顺序 1→2→3(风险递增)。详细见 plan。

## Phase 1 — usageHints focus 引导(模块1,L3)
- [x] `usageHints.ts`:`HintCapabilityFlags`(:13-25)加 `focus?: boolean`
- [x] `usageHints.ts`:augmentPrompt **:75 后**插 focus 段(门控 `rc.focus && !simple`,块状【上下文聚焦】+ `  ·` 子项)
- [x] `sec-56.ts` 新建 selftest(9 项:advanced 注入 / simple 不注入 / minimal 不注入 / focus:false 不注入 / 默认{}注入 / 局部全局分流 / set_focus·clear_focus 关键词 / planning 共存 / 包裹结构)+ runner 注册
- [x] `npm test` 绿(1342→1351)+ commit `feat(usageHints): inject focus guidance in advanced mode`

## Phase 2 — focus 持久化(模块2,L4)
- [x] `storage.ts`:import Focus(:17)+ SnapshotKind(:31)/SNAPSHOT_KINDS(:32)加 `'focus'` + SessionSnapshot 加 `focus?: Focus | null`(null=清除标记)
- [x] `createChatSdk.ts`:`applySnapshot`(含 getSchemaAtPath 校验失效丢弃=决策A)+ `persistRuntime`(f ?? null 覆盖清除)+ `switchSession` 切走前 persist 三处
- [x] `types/index.d.ts`:SessionSnapshot 加 `focus?: Focus | null`
- [x] `sec-57` storage focus kind 往返(4 项)+ e2e `focus.mjs` 持久化(6 项:往返还原/reset 不污染/inspect 反映/clearFocus 不恢复/restore 失效丢弃/setLlm 保留)
- [x] `npm test`+`npm run test:e2e` 绿(selftest 1351→1355 / e2e 353→359)+ commit `feat(focus): persist focus across refresh/session-switch (restore validates path)`

## Phase 3 — 子 agent 继承(模块3,Q1=a)
- [x] `focus.ts`:`FocusMiddlewareOptions` 加 `initialFocus?: Focus` + `createFocusMiddleware` 初始化 `let focus = opts.initialFocus`(决策C)
- [x] `subagent.ts`:import createFocusMiddleware/Focus/ZodType + `SubagentOptions`/`SubagentsMiddlewareOptions` 加 `getFocus?`/`getSchema?` + `configToSubOpts` 展开 + `runSubagent` createAgent middleware 数组注入子 focus 中间件(主未聚焦 → undefined 不装,零回归)
- [x] `createChatSdk.ts`:`createSubagentMiddleware` + `createSubagentsMiddleware` 两处装配传 `getFocus: () => focusMw.getFocus()` + `getSchema: () => liveData()?.schema ?? null`
- [x] 扩展 `sec-54`(initialFocus 3 项:构造即有/augmentPrompt 生效/reset 清空)+ e2e `subagents.mjs` 装配(3 项:setFocus ok/getFocus 反映/中间件栈不破坏);**spawn 端到端(子 systemPrompt 含焦点)manual/deferred**(mock spawn 链路成本高,selftest sec-54 覆盖 initialFocus 逻辑)
- [x] `npm test`+`npm run test:e2e` 绿(selftest 1355→1358 / e2e 359→362)+ src tsc 无真错 + commit `feat(subagent): inherit parent focus (three-layer convergence)`

## 文档 + 发布
- [x] CLAUDE.md(focus 段补 focus-auto-switch 三件 + 计数)+ README 中英(Capabilities 加 🎯 focus 自动切换行 + 计数)+ CHANGELOG [Unreleased] focus-auto-switch 段
- [x] 计数同步:1342→1358 / 353→362
- [ ] 全量回归:build + test:exports/types/size/pack → bump minor → 推双远程 → npm(**用户触发**)
- [ ] 三 phase 全发布后 specs 合入 openspec/specs/ + change 移 archive/
