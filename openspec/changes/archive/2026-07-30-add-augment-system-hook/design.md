# Design: add-augment-system-hook

> 核心约束:**复用既有 augmentPrompt 中间件通道,零新机制**。所有不确定性已定位:中间件栈组装位置、`buildSystemPrompt` 每轮重算链路、`getInfo().systemPrompt` 兼容性陷阱。本设计把 data 经 createChatSdk 层闭包喂入,不下沉 HarnessState。

## 1. 现状定位:两个堵点

**堵点① augmentPrompt 拿不到 schema**(`src/core/harness/state.ts:38`):
```ts
export interface HarnessState {
  messages; todos; files; skillsMetadata; skillsLoaded; memory; summarization?; lastCompression?; verifyAttempts
  // ❌ 无 data/schema
}
```
→ `augmentPrompt(state)`(`src/core/harness/middleware.ts:75` 签名 `(state: HarnessState) => string | undefined`)读不到当前 schema。

**堵点② A4 是创建时 const**(`src/core/sdk/createChatSdk.ts:671`):
```ts
const finalSystemPrompt = basePrompt + buildDataPrompt(finalDataConfig)  // const,setData 后不更新
```
→ `setData()` 换 schema 后,system 数据段仍是旧描述。

## 2. 解法:dataHint + augmentSystem 两中间件(闭包 liveData)

`buildSystemPrompt()`(`src/core/harness/createAgent.ts:196-205`)每轮在 `replaceSystem()` 重跑,遍历中间件 `augmentPrompt(state)` 拼段 —— **动态免费**。只要中间件闭包 `liveData()`(`createChatSdk.ts:691` `() => dataOpsController?.get() ?? finalDataConfig`),每轮即取最新 data。

**新中间件**(createChatSdk 层组装,非 harness 层):

```ts
// A4 动态化:每轮从 liveData 取最新 schema 生成「可操作数据」段
const dataHintMw: Middleware = {
  name: 'dataHint',
  augmentPrompt: () => buildDataPrompt(liveData()),  // 无 data → buildDataPrompt 返 '' → undefined → 跳过
}

// augmentSystem 钩子:把 { state, data } 喂给集成方回调
const augmentSystemMw: Middleware = {
  name: 'augmentSystem',
  augmentPrompt: (state) => options.augmentSystem?.({ state, data: liveData() }),
}
```

> 关键:`augmentPrompt` 传输契约只传 `state`;`data` 经 createChatSdk 层闭包 `liveData()` 注入 ctx,**不改 harness 中间件契约**(分层正确)。

## 3. 中间件栈插入位置(`createChatSdk.ts:865-910`)

现状装载序:usageHints(866)→ todos → skills → vfs → summarization → memory → permissions → checkpoint → humanConfirm → approval → verify(903)→ subagent(904)→ subagents(905)→ **`...(options.middleware)`(906)**→ sdkEvents(909)。

插入决策:
- **`dataHintMw` 插数组最前**(usageHints 866 之前):保持「数据段紧跟 base」的现有输出顺序 —— LLM 看到的 system 结构不变(现状数据段在 base 末尾;改后数据段是 augmentPrompt 链第一段,紧跟 base)。仅 `finalDataConfig` 存在时装载。
- **`augmentSystemMw` 插 subagents(905)后、`options.middleware`(906)前**:遵循 verify 既定「用户自定义中间件前」约定(见 903 行注释)。仅 `options.augmentSystem` 存在时装载。用户 augmentSystem 段排在所有内置段之后,可在内置数据段 / 能力提示基础上补充。

> 段顺序最终为:base → **dataHint(数据段)** → usageHints → todos → skills → … → subagent → **augmentSystem** → 用户 middleware。dataHint 紧跟 base 与现状等价;augmentSystem 作为集成方补充段在后。

## 4. base 拆分 + getInfo 动态重算(关键兼容点)

**拆 baseSystemPrompt**(`createChatSdk.ts:671` 改):
```ts
const baseSystemPrompt = basePrompt   // 去掉 buildDataPrompt,data 段移交 dataHint 中间件
```

**createAgent 传参**(`:1207`):`systemPrompt: baseSystemPrompt`

**getInfo().systemPrompt 动态重算**(`:1079`,关键):
```ts
systemPrompt: baseSystemPrompt + buildDataPrompt(liveData())   // 动态:inspect().systemPrompt 仍含数据段 + setData 同步
```

> ⚠️ 若不重算,数据段挪进中间件后 `inspect().systemPrompt` 仅剩 base,断 `tests/e2e/systemprompt.mjs`(多处断言含「可操作数据」)。动态重算既保兼容,又让 setData 后 `infoTick++`(DebugDrawer 重拉)自动反映新 schema。`types/index.d.ts` `systemPrompt` 注释(131-132)微调:数据段现随 data 动态。

## 5. setData → liveData 链路(为何 A4 动态化能修 Bug)

```
sdk.setData(config)  →  dataOpsController.set(config)           // createChatSdk.ts:1428
                       → controller 闭包更新 schema/bind/desc    // dataOps.ts:411-415
                       → core.infoTick.value++                   // 触发 DebugDrawer 重拉 getInfo
下一轮 buildSystemPrompt()  →  dataHintMw.augmentPrompt()  →  buildDataPrompt(liveData())  →  返新 schema hint ✓
```

`liveData()` getter 模式 verify 已在用(`createChatSdk.ts:783-786` `() => liveData()?.schema`),成熟路径。

## 权衡

- **为何不把 data 塞进 HarnessState**:data 是 createChatSdk 层(单主对象)概念,HarnessState 是通用 harness 契约(对齐 Deep Agents)。下沉会让 harness 绑业务概念、污染所有中间件签名。createChatSdk 层闭包喂 data 是正确分层(verify / inspect 已这么做)。
- **为何 dataHint 放最前而非原位**:augmentPrompt 段按数组序拼接;放最前保证数据段紧跟 base,LLM 看到的 prompt 结构与现状一致(零行为变化)。放后面会让数据段跑到 todos/skills 之后,改变结构。
- **augmentSystem vs 自定义 augmentPrompt 中间件**:augmentSystem 是后者 + liveData 注入的便捷封装(类比 memory)。集成方要更灵活(多段 / 复杂逻辑)仍可写自定义 middleware;augmentSystem 覆盖「一个回调拿 state/data 注入一段」的常见场景。

## 风险

- **每轮重算开销**:`buildDataPrompt(liveData())` + 回调每轮跑一次。`extractSchemaHint` 是轻量遍历,大 schema(百字段)可感知但远小于 LLM 调用成本;可接受。极端大 schema 时集成方可在回调里缓存 / 裁剪。
- **augmentSystem 回调抛错**:中间件 augmentPrompt 抛错会中断 buildSystemPrompt。实现时回调包 try/catch,异常降级为跳过该段 + debug 日志(不崩 agent)。
- **段顺序变化感知**:dataHint 放最前使 `inspect().middleware` 数组顺序变(dataHint 在 usageHints 前);但现有 e2e 用 `includes` 不断顺序,无影响。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/sdk/createChatSdk.ts` | 拆 `baseSystemPrompt`;加 `dataHintMw` + `augmentSystemMw` 中间件 + 装载;`createAgent` 传 baseSystemPrompt;`getInfo().systemPrompt` 动态重算;`ChatSdkOptions` 加 `augmentSystem?` + `SystemAugmentContext` |
| `types/index.d.ts` | 加 `SystemAugmentContext` 导出 + `ChatSdkOptions.augmentSystem?`;微调 `systemPrompt` 注释 |
| `src/core/__tests__/modules/`(selftest) | dataHint / augmentSystem 中间件 augmentPrompt 单元断言 |
| `tests/e2e/`(inspect / dynamic-register / systemprompt) | middleware 含新中间件 + setData 后 systemPrompt 反映新 schema |
| `doc/system-prompt.md` / `CLAUDE.md` / `README*.md` | A4 改块B + 删 Bug 段 + 加 augmentSystem 段(中英同步) |
