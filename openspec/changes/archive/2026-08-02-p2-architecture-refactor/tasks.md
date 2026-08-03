# Tasks: p2-architecture-refactor (P2)

> 关联 `proposal.md`。5 子项独立推进,每子项独立 commit + 全测守护(selftest 1030 / e2e 263 / browser)。纯重构零行为变化。

## 子项 1 — createChatSdk 拆分(优先级最高)⏸ 拆出 deferred(2026-08-03,等痛点驱动;见 deferred.md)
- [ ] 抽 `sdk/buildToolset.ts`(tools 装配 + subagent/verify 筛选 + rebuildExtraTools,从 buildCore 671-820)
- [ ] 抽 `sdk/buildMiddlewareStack.ts`(capability 门控 + compose,复用 middlewareStack.ts,755-968)
- [ ] 抽 `sdk/coreOperations.ts`(AgentCore send/batch/switchSession/setTools/setLlm/getInfo,972-1338)
- [ ] 抽 `sdk/skillSync.ts`(SkillStore 协调 + loadUserSkillsFromStore,863-914)
- [ ] 抽 `sdk/persistence.ts`(applySnapshot/persistRuntime/resolveAndLoad/trimMemoryMessages,1338-1409)
- [ ] AgentCore 接口分 mixin(RuntimeConfigApi/SessionApi/InspectionApi/SkillCrudApi)
- [ ] getInfo() 拆独立函数(90 行内联 13 spread)
- [ ] 全测绿 + 行为不变(selftest/e2e 对比)

## 子项 2 — createAgent 回归契约(最险,动主循环)⏸ 拆出 deferred(2026-08-03,等痛点驱动;见 deferred.md)
- [ ] DSML/garbled 解析 → `format-guard` 中间件(beforeModel 解析补 toolCalls,不 mutate 主循环 L62-108)
- [ ] format retry 状态 → HarnessState(非 formatRetries/pendingFormatRetry 主循环局部)
- [ ] wrap_up 末轮综合 → 经 composeModelCall 洋葱(不直调 coreModelCall L662-678)
- [ ] trace span 采集 → beforeRound/afterRound hook(中间件可贡献 round span)
- [ ] 主循环只剩 ReAct 骨架
- [ ] DSML + wrap_up + trace 测试覆盖(selftest 扩展,确保 quirk 不回归)

## 子项 3 — dataOps patch 装饰器(bug 高发区)🟡 部分完成 2026-08-03
- [x] 抽 `applyPatchesToBind` 装饰器(单一真相源:clone+循环校验+applyPatchToClone+schema+snapshot+applyLive+markDataDirty)
- [x] write(edit)/edit_data/eval-patches/eval-subtree 四处改调装饰器(消除重复;eval-subtree 单 patch set 也纳入)
- [ ] read/get_data 二合并(投影/拦截/分页重叠)—— 留下个精细任务(结构优化,非 bug 高发)
- [ ] writeSlot 按 intent 拆 4 子函数 —— 留下个精细任务
- [x] dataOps 全测守护(selftest 1092 + e2e 283 + browser 25 全绿;乐观锁×拦截器×dryRun 三轴经现有用例覆盖)

## 子项 4 — capabilities 注册表 ✅ 完成 2026-08-03
- [x] `type Capability = { name, defaultOn, requires? }` 注册表(CAPABILITIES 17 开关)
- [x] `resolveCapabilities(caps)` 单一解析函数(参数 Record<string,unknown> 兼容含 subagents 等非 boolean 字段的 caps)
- [x] 17 开关迁移(11 opt-out defaultOn:true + 6 opt-in defaultOn:false;requires: draftWrite 需 dataOps+vfs)
- [x] createChatSdk / toolsets / usageHints 统一经 resolveCapabilities(inspect 间接经 useXxx;签名向后兼容,内部各自 resolve)

## 子项 5 — types 漂移根治 ✅ 完成 2026-08-03
- [x] 字段级抽样断言(防漂移机制):放 `tests/types.test-d.ts`(test:types,tsc 类型层可靠)而非 exports-consistency.mjs(.mjs 正则解析联合/内联类型脆弱)。5 类断言:① `ChatSdk` 全 34 方法/属性 `Pick`(防 AgentCore 缺方法坑源)② `SubagentConfig` 10 字段 `Pick` ③ `SdkEvent` 关键分支 `Extract`(data_change operation / error severity / usage round / trace spans)④ `ChatSdkOptions` 关键字段 `Pick`(tokenBudget/actions/capabilities/onAudit 等)⑤ capabilities 17 开关名 `Pick`(与 capabilities.ts CAPABILITIES 注册表呼应)
- [x] (评估)生成 d.ts vs 字段级抽样 → 选字段级抽样(`Pick`/`Extract` 渐进,不引 d.ts 生成工具链)
- [x] SubagentConfig/SdkEvent 字段已在 [2.21.0] 修复漂移(补齐层);此处补**防护层**锁定现状不再漂移
- [x] exports-consistency.mjs 加职责分工注释(本文件管「符号存在」,types.test-d.ts 管「字段正确」)
- [x] test:types + test:exports + selftest 1092 + e2e 283 全绿

## 文档
- [ ] CLAUDE.md 架构要点更新(模块拆分 + 契约回归)
- [ ] doc/architecture.md 更新
- [ ] CHANGELOG
