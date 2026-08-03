# Change: p2-architecture-refactor (P2 架构重构)

> 📦 **已归档(2026-08-03,部分完成)**:实际完成 ③(dataOps patch 装饰器)+ ④(capabilities 注册表)+ ⑤(types 防漂移)。**①(createChatSdk 1787 行拆分)+ ②(createAgent 回归中间件契约)+ ③剩余(read/get_data 合并 + writeSlot 拆 4 子函数)拆出暂缓** —— 纯内部重构零用户价值,当前无维护痛点驱动,等真实痛点再重启(理由 + 重启触发见 [`../../../deferred.md`](../../../deferred.md)「2026-08-03 新增」段)。下方原 proposal/tasks 保留作重启底稿(行号 + 步骤齐全,直接 apply)。

> 4 agent 交叉审查(arch + maintain)发现的结构债集中清理:createChatSdk god module 拆分 + createAgent 回归中间件契约 + dataOps patch 装饰器 + capabilities 注册表 + types 漂移根治。
> **来源**:arch-review(createAgent 绕过契约 / dataOps 三处 patch 重复)+ maintain-review(createChatSdk 1787 行 / capabilities 混 / types 漂移)。
> **状态:proposal(未实施)**。大重构,分 5 子项独立推进,每子项全测守护,可分多次会话。

## Why
Phase 1-4 功能全落地后,4 agent 审查暴露**结构债**(非 bug,但改动信心瓶颈):
1. `createChatSdk.ts` **1787 行 god module**(`buildCore` 900 行单函数 + AgentCore 30+ 方法混 IO/重配/检视/skill CRUD)—— 改动频率最高、测试矩阵最重,已成最大维护负担
2. `createAgent.ts` **多处绕过中间件契约**:DSML/garbled 解析直接 mutate `response.toolCalls`(L62-108)、format retry 用主循环局部状态(非 HarnessState)、wrap_up 末轮综合直调 `coreModelCall` 跳过 `wrapModelCall` 洋葱(L662-678,中间件失效)、trace span 散嵌主循环(缺 beforeRound/afterRound hook)
3. `dataOps.ts` **三处 patch 应用重复**:write(edit)/edit_data/eval-patches 各自 clone+patch+校验+snap+audit(`commitSetToBind` 只统一了 set),乐观锁×拦截器×dryRun 三轴组合分支密度高 = **bug 高发区**
4. capabilities **11 开关 opt-in(===true)/opt-out(!==false)同对象混**,新增改 5 处
5. `types/index.d.ts` **手维护漂移**(test:exports 只比名字不查字段,SubagentConfig.writablePaths 曾漂移)

## What Changes(5 子项,独立可分)

### 子项 1:createChatSdk 拆分(优先级最高)
- `buildCore()` 900 行 → 5 文件(遵循已抽的 middlewareStack/optionsResolver 模式):
  - `buildToolset.ts`(tools 装配 + subagent/verify 筛选 + rebuildExtraTools)
  - `buildMiddlewareStack.ts`(capability 门控 + compose,复用 middlewareStack.ts)
  - `coreOperations.ts`(AgentCore 的 send/batch/switchSession/setTools/setLlm/getInfo)
  - `skillSync.ts`(SkillStore 协调)
  - `persistence.ts`(applySnapshot/persistRuntime/resolveAndLoad/trimMemoryMessages)
- AgentCore 接口分 mixin:`RuntimeConfigApi`(setTools/setLlm/setMemory/setSubagents)/`SessionApi`(send/batch/stream/switchSession)/`InspectionApi`(getInfo/inspect)/`SkillCrudApi`(addSkill/removeSkill/...)
- `getInfo()`(90 行内联 13 spread)拆独立函数

### 子项 2:createAgent 回归契约
- DSML/garbled 解析 → `format-guard` 中间件(beforeModel 解析 + 补 toolCalls,不 mutate 主循环)
- format retry 状态 → HarnessState(非主循环局部)
- wrap_up 末轮综合 → 经 `composeModelCall` 洋葱(不直调 coreModelCall)
- trace span 采集 → `beforeRound`/`afterRound` hook(中间件可贡献 round span)
- 主循环只留 ReAct 骨架,DeepSeek/厂商 quirk 不下沉核心

### 子项 3:dataOps patch 装饰器
- 抽 `applyPatches+snapshot+audit` 装饰器(单一真相源),write(edit)/edit_data/eval-patches 共用
- read/get_data 二合并(投影/拦截/分页重叠)
- writeSlot 按 intent 拆 4 子函数

### 子项 4:capabilities 注册表
- `type Capability = { name, defaultOn, requires?: Capability[] }` 注册表
- 单一 `resolveCapabilities(caps)` 函数,消除 `===true`/`!==false` 混用
- opt-in/opt-out 显式标(命名或 defaultOn 字段)

### 子项 5:types 漂移根治
- `test:exports` 升级为字段级抽样(比对 interface 关键字段:SubagentConfig / SdkEvent 联合 / ChatSdkOptions)
- 或评估生成 d.ts(tsc 从 src 生成,根治手维护漂移)

## Impact
- **改造面大**:createChatSdk / createAgent / dataOps / types / 全 capabilities 引用点
- **风险**:中等(纯重构,行为不变,但面广)。每子项**独立 commit + 全测守护**(selftest 1030 + e2e 263 + browser),任一回归立即回退
- **向后兼容**:对外 API 零变(纯内部拆分);types 字段级守护防漂移
- **收益**:改动信心(1787 行 → 模块化)、契约一致性(中间件扩展性均衡)、bug 高发区收敛(装饰器单一真相)、types 不再漂移

## 决策
1. **分 5 子项独立推进**(非一次性大爆炸):每子项独立 PR/commit + 全测。子项 1(createChatSdk 拆)优先(收益最大 + 改动最多)
2. **纯重构零行为变化**:每子项前后 selftest/e2e 全绿证明行为不变。子项 2(createAgent 契约)最险(动主循环),需 trace + DSML + wrap_up 测试覆盖
3. **types 子项 5 二选一**:字段级抽样(轻,守不住所有字段) vs 生成 d.ts(根治,但 build 流程改)。**倾向字段级抽样**(渐进,不改 build)
4. **capabilities 注册表**(子项 4)配合子项 1(createChatSdk 拆时统一)

## Non-goals
- 不改对外 API(纯内部重构)
- 不做性能优化(那是 checkpoint-incremental-snapshot 的范畴)
- 不补新功能(只清债)
- 子项 2 的 trace hook 不改 TraceSpan 模型(只改采集点)
