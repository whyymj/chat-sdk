# Change: add-augment-system-hook

> 对应诉求:集成方需「按运行时状态动态注入部分 dataSchema、组件说明」。根因是两个现状缺口 —— `augmentPrompt` 中间件拿不到 schema(`HarnessState` 无 data 字段)、A4「可操作数据」段创建时 const 不随 `setData()` 更新。
> 设计取向:**复用既有 augmentPrompt 中间件通道**(不新增提示词机制、不污染通用 `HarnessState`),把 data 经 createChatSdk 层闭包喂给回调 —— 与 memory 之于 augmentPrompt 同样的「内置便捷封装」定位。

## Why

1. **动态注入 schema/组件说明无入口**。集成方(低代码平台,组件众多 / 可懒加载)需按运行时状态往 system prompt 注「当前相关组件说明」「部分 schema 描述」。现有 `augmentPrompt(state)` 虽每轮重算,但 `HarnessState`(`src/core/harness/state.ts:38`)只含 messages/todos/files/skills/memory…,**无 data/schema 字段** —— 回调里读不到当前 schema,无法据此动态算组件说明;只能绕去 `sdk.getData()` 并自行处理引用时序,别扭且易错。
2. **A4「可操作数据」段不随 setData 更新(已标记 Bug)**。`finalSystemPrompt = basePrompt + buildDataPrompt(finalDataConfig)`(`src/core/sdk/createChatSdk.ts:671`)是创建时 `const`,`setData()` 运行时换 schema 后,system prompt 里的字段描述仍是旧 schema —— 动态 / 懒加载组件场景下 LLM 基于过时描述操作。`doc/system-prompt.md` §5③ 已标记此 Bug。
3. **机制已就绪,缺一层便捷封装**。`buildSystemPrompt()`(`src/core/harness/createAgent.ts:196`)本就每轮重算 augmentPrompt 段;`liveData()`(`createChatSdk.ts:691`)已能取最新 data config(verify / inspect 在用)。只需在 createChatSdk 层包一个闭包 `liveData()` 的中间件,即可把 data 喂给集成方回调 + 让 A4 每轮动态 —— 零新机制。

## What Changes

1. **新增顶层钩子 `augmentSystem(ctx)`**:`ctx = { state: HarnessState, data?: DataConfig }`,`data` 每轮从 `liveData()` 取最新(含 schema/bind,setData 后自动同步)。集成方返回字符串 → 作为 system prompt 一段每轮注入;返回 undefined → 跳过。本质是 createChatSdk 层把 `augmentPrompt` 中间件 + `liveData` 闭包预包装成便捷选项(类比 memory)。
2. **A4「可操作数据」段改为每轮动态**:从 `finalSystemPrompt`(创建时 const)拆出,改由 `dataHint` 中间件 `augmentPrompt: () => buildDataPrompt(liveData())` 每轮重算 —— 一并修 setData 不同步 Bug。
3. **`getInfo().systemPrompt` 动态重算保兼容**:`inspect().systemPrompt` 改为 `baseSystemPrompt + buildDataPrompt(liveData())`,使数据段仍出现在 inspect(不断 `systemprompt.mjs`),且 setData 后 `infoTick++` 触发重拉自动同步。
4. **类型**:`SystemAugmentContext`(导出)+ `ChatSdkOptions.augmentSystem?`(src 与 `types/index.d.ts` 同步)。

## Impact

- **改造**:`src/core/sdk/createChatSdk.ts`(拆 `baseSystemPrompt`/dataPrompt、加 `dataHintMw` + `augmentSystemMw` 两中间件、`createAgent` 传 baseSystemPrompt、`getInfo().systemPrompt` 动态重算、`ChatSdkOptions` 加字段);`types/index.d.ts`(加 `SystemAugmentContext` + `augmentSystem?` + 微调 `systemPrompt` 注释)。
- **新增**:2 个内置中间件(dataHint / augmentSystem);`SystemAugmentContext` 类型导出。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(动态注入钩子 + 数据段每轮动态)。
- **向后兼容**:不配 `augmentSystem` = 完全现状行为;A4 仅从「创建时 const」变为「每轮动态」,**输出内容等价**(dataHint 插中间件栈最前,数据段仍紧跟 base,LLM 看到的 system 结构不变)。`inspect().systemPrompt` 经动态重算仍含数据段。
- **测试**:selftest 加 dataHint / augmentSystem 中间件单元断言;e2e 加 `inspect().middleware` 含新中间件 + `setData` 后 systemPrompt 反映新 schema(验证 Bug 已修)。

## Non-goals

- **不做** 把 data/schema 下沉进通用 `HarnessState`(data 是 createChatSdk 层概念,下沉污染 harness 分层;改用 createChatSdk 层闭包喂 data)。
- **不做** 新的提示词注入机制(复用既有 augmentPrompt 中间件通道,augmentSystem 是其便捷封装,非平行机制)。
- **不做** 「按对话语义自动挑选注入哪些组件」的智能模式(高度领域相关且不可靠,交给集成方回调自行判断;框架只提供能读 state/data 的钩子)。
- **不做** 运行时改 systemPrompt/tools/llm 等(那是 #5 动态重置范畴,本项只管「system prompt 动态段注入」)。
