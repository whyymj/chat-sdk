# Tasks: p2-architecture-refactor (P2)

> 关联 `proposal.md`。5 子项独立推进,每子项独立 commit + 全测守护(selftest 1030 / e2e 263 / browser)。纯重构零行为变化。

## 子项 1 — createChatSdk 拆分(优先级最高)
- [ ] 抽 `sdk/buildToolset.ts`(tools 装配 + subagent/verify 筛选 + rebuildExtraTools,从 buildCore 671-820)
- [ ] 抽 `sdk/buildMiddlewareStack.ts`(capability 门控 + compose,复用 middlewareStack.ts,755-968)
- [ ] 抽 `sdk/coreOperations.ts`(AgentCore send/batch/switchSession/setTools/setLlm/getInfo,972-1338)
- [ ] 抽 `sdk/skillSync.ts`(SkillStore 协调 + loadUserSkillsFromStore,863-914)
- [ ] 抽 `sdk/persistence.ts`(applySnapshot/persistRuntime/resolveAndLoad/trimMemoryMessages,1338-1409)
- [ ] AgentCore 接口分 mixin(RuntimeConfigApi/SessionApi/InspectionApi/SkillCrudApi)
- [ ] getInfo() 拆独立函数(90 行内联 13 spread)
- [ ] 全测绿 + 行为不变(selftest/e2e 对比)

## 子项 2 — createAgent 回归契约(最险,动主循环)
- [ ] DSML/garbled 解析 → `format-guard` 中间件(beforeModel 解析补 toolCalls,不 mutate 主循环 L62-108)
- [ ] format retry 状态 → HarnessState(非 formatRetries/pendingFormatRetry 主循环局部)
- [ ] wrap_up 末轮综合 → 经 composeModelCall 洋葱(不直调 coreModelCall L662-678)
- [ ] trace span 采集 → beforeRound/afterRound hook(中间件可贡献 round span)
- [ ] 主循环只剩 ReAct 骨架
- [ ] DSML + wrap_up + trace 测试覆盖(selftest 扩展,确保 quirk 不回归)

## 子项 3 — dataOps patch 装饰器(bug 高发区)
- [ ] 抽 `applyPatches+snapshot+audit` 装饰器(单一真相源)
- [ ] write(edit)/edit_data/eval-patches 改调装饰器(消除三处重复)
- [ ] read/get_data 二合并(投影/拦截/分页重叠)
- [ ] writeSlot 按 intent 拆 4 子函数
- [ ] dataOps 全测 + 边界(乐观锁×拦截器×dryRun 三轴)

## 子项 4 — capabilities 注册表 ✅ 完成 2026-08-03
- [x] `type Capability = { name, defaultOn, requires? }` 注册表(CAPABILITIES 17 开关)
- [x] `resolveCapabilities(caps)` 单一解析函数(参数 Record<string,unknown> 兼容含 subagents 等非 boolean 字段的 caps)
- [x] 17 开关迁移(11 opt-out defaultOn:true + 6 opt-in defaultOn:false;requires: draftWrite 需 dataOps+vfs)
- [x] createChatSdk / toolsets / usageHints 统一经 resolveCapabilities(inspect 间接经 useXxx;签名向后兼容,内部各自 resolve)

## 子项 5 — types 漂移根治
- [ ] `test:exports` 升级字段级抽样(比对 SubagentConfig / SdkEvent 联合 / ChatSdkOptions 关键字段)
- [ ] (评估)生成 d.ts vs 字段级抽样,选渐进方案
- [ ] 补齐 SubagentConfig / SdkEvent 字段(automation/tracing/draft 等已发事件字面量)

## 文档
- [ ] CLAUDE.md 架构要点更新(模块拆分 + 契约回归)
- [ ] doc/architecture.md 更新
- [ ] CHANGELOG
