# Change: fix-context-window-stale-on-setllm(setLlm 后 contextWindow 陈旧不更新)

> 评审发现(2026-08-08):`setLlm` 切换 LLM 后,`onLlmChange` 重解析 `modelCaps` 但**只赋给闭包局部变量,不回灌**给压缩/offload 阈值消费点。切小窗口模型 + 历史超新窗口时,`compressInput` 仍用旧大窗口阈值 → 不触发压缩 → 历史原样发给新模型 → 可能 `max context length` 报错且无自动收敛。**独立 change**,无前置依赖。基于对 `createAgent` / `useContextManager` / `createChatSdk` 上下文消费链的逐行核对(证据见 design §1)。

## Why

`contextWindow` 在 SDK 内有 **5 个「创建时一次性快照」消费点**,`setLlm` 后全部陈旧:

| 消费点 | 位置 | 现状 |
|---|---|---|
| createAgent offload 阈值 | `createAgent.ts:270-278` | `caps` / `offloadThreshold` / `offloadPassThrough` 局部 `const`,`setLlm`(`:762-766`)不重算 |
| summarization 压缩阈值 | `useContextManager.ts:74,118-120` | `config` 构造快照,`compress` 用 `config.contextWindow` 算 `summaryThreshold` |
| contextInspector 占比 | `createChatSdk.ts:952-956` | `contextWindow` 传入后中间件内部快照 |
| resolveContextOptions | `createChatSdk.ts:697` | 一次性算出 `resolvedCtxOpts`,展开传 summarization(`:1086-1094`) |
| onLlmChange 回灌 | `createChatSdk.ts:1796-1805` | 重算 `modelCaps` 但**只赋局部变量**(注释声称「影响 offload 阈值/压缩」,实现没回灌任何消费点) |

**真实场景**:大窗口模型(128K)聊出 30K 历史 → `setLlm` 切 8K 模型 → `compressInput` 阈值仍 = 128K×0.5 = 64K,30K < 64K 不触发 → 30K 原样发给 8K 模型 → `max context length exceeded` 报错。唯一与 contextWindow 无关的兜底是 `trimMemoryMessages`(按轮数默认 50),但「少轮大 token」(如 10 轮 30K)不触发轮数裁剪 → **无任何收敛,新模型调用直接失败**。

**价值**:修正确性缺陷 —— `setLlm` 后压缩/offload 真正跟随新模型窗口,让「切小窗口模型 + 恢复历史」场景有自动收敛,而非裸失败。

## What Changes

`setLlm` 后动态回灌 `contextWindow` 到所有消费点(详见 design 方案 B):

1. **`createAgent` 暴露 `setModelCaps(caps)`**:更新内部 `caps` + 重算 `offloadThreshold` / `offloadPassThrough`(局部 `const` → `let` + 方法)。
2. **中间件工厂统一 controller 模式**:`createSummarizationMiddleware` / `createContextInspectorMiddleware` 工厂返回 `{ middleware, setContextWindow(cw) }`(复用已验证的 `focusMw` controller 模式),内部更新 `config` / 快照。
3. **`createChatSdk` `onLlmChange` 集中回灌**:重算 `modelCaps` 后 → `core.agent.setModelCaps(modelCaps)` + 各中间件 `setContextWindow(modelCaps.contextWindow)` + 更新闭包 `modelCaps` / `currentLlm`。

## Impact

- **测试**(按「新增功能测试同步约定」):
  - selftest:`setModelCaps` 后 createAgent offload 阈值重算;`createSummarizationMiddleware`/`createContextInspectorMiddleware` 的 `setContextWindow` 生效(`ctxManager.config.contextWindow` 更新 + compress 用新值);onLlmChange 集中回灌触发各 setter。
  - e2e:`sdk.setLlm(小窗口模型)` 后 `inspect().context` 反映新 contextWindow;FAKE_LLM 构造超新窗口历史 → 下一轮 compressInput 触发(集成层可验)。
- **行为变化**:`setLlm` 后压缩/offload 真正跟随新模型(修 bug,符合注释声称的预期);**不切模型 = 现状零变化**(向后兼容)。
- **向后兼容**:`setModelCaps` / `setContextWindow` 是新增接口,不影响现有;`onLlmChange` 保持 `void` 回调语义不破坏。
- **文档**:CLAUDE.md 上下文管理 / setLlm 段补「contextWindow 动态跟随」;types 补 `setModelCaps`(若对外暴露)。

## Decision

1. **用独立 setter 而非 getter 函数**:与 SDK 现有 setter 风格一致(`setLlm`/`setTools`/`setData`);各组件自管更新、可独立单测;`onLlmChange` 保持 `void` 不破坏回调语义。getter 方案(每处 `const` → 函数调用)改面大且改变 config 结构。
2. **中间件工厂统一 controller 模式**:返回 `{ middleware, setContextWindow }`,SDK 集中调用 —— 复用 `focusMw` 已验证的 controller 模式,新增中间件天然支持。
3. **`createAgent` 用 `setModelCaps` 而非 `setLlm` 第二参**:`setLlm` 是用户语义(切模型实例),caps 更新是副作用,分离更清晰;`setModelCaps` 可独立于 `setLlm`(未来 caps 声明变更场景)。

## Non-goals

- 不改压缩算法本身(`summaryThresholdRatio` / `windowRatio` 比例不变)。
- 不改 `trimMemoryMessages`(轮数维度,与 contextWindow 正交,本就与模型无关)。
- 不改 `resolveModelCaps` 查表 / 声明优先级逻辑。
- 不做「切模型后立即触发一次压缩」(本 change 只让阈值正确;压缩仍在下一轮 `wrapModelCall` 自然发生 —— 阈值对了就够)。
