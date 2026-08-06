# Design: context-inspector(上下文查看面板)

> **核心**:wrapModelCall 真实快照(评审修正:非 beforeModel)+ 标记切分细分类 + 纯函数可测。零 LLM 成本。

## 1. 快照数据流

```
createAgent 每轮: replaceSystem(重渲染 system) → trimContextIfNeeded(截断工具结果)
context-inspector(wrapModelCall) → analyzeContext(最终 currentMessages) → state.contextSnapshot(每轮覆盖)
压缩触发 → state.lastCompression(已存在,直接引用)
UI/DebugDrawer → inspect().context / sdk.inspectContext() → 渲染分类/占比/压缩
```

`state.contextSnapshot` 为中间件 state 字段(不在 messages),`wrapModelCall` 包装 modelHandler 时由本中间件写入。**采集时机关键**:`beforeModel` 在 `replaceSystem`/`trimContextIfNeeded` **之前**执行(`createAgent.ts:533-536`),拿不到「实际发给 LLM 的消息」;`wrapModelCall` 的 modelHandler 入参是这两步之后的最终消息(546 行),才是准确采集点。**不跨压缩** —— 快照反映「当前轮实际发给 LLM 的构成」,压缩后历史变化不影响诊断价值。

## 2. 纯函数 `analyzeContext`

```ts
// src/core/utils/contextAnalysis.ts(纯函数,无 DOM/无状态)
export function analyzeContext(
  messages: BaseMessage[],           // 实际发给 LLM 的消息(LangChain 消息数组)
  opts: { contextWindow?: number; thresholdRatio?: number },
): ContextSnapshot
```

**输入类型 `BaseMessage[]`**(评审修正):中间件拿到的就是 LangChain 消息数组(`middleware.ts` 的 ModelRequest.messages 为 BaseMessage[]);`AgentMessage.role` 只有 `user|assistant|system`,无 `tool` role,不可作纯函数输入。

分类切分规则:

| 目标 | 判定 | 实现 |
|---|---|---|
| systemPrompt | system 段未匹配下标记 | 按 `\n\n` 分隔 → 标记匹配,未命中归此类 |
| dataHint | 含「## 可操作数据」 | `promptBuilder.ts` buildDataPrompt 注入段 |
| usageHints | 含「## 能力使用提示」 | `usageHints.ts` 注入段 |
| mission | 含「## 当前主线目标」 | `mission.ts` 注入段 |
| workingMemory | 含「## 工作记忆」 | `workingMemory.ts` 注入段 |
| memory | 含「【更早对话摘要】」 | `rounds.ts` MEMORY_SUMMARY_PREFIX 段 |
| summary | 含「【对话历史摘要】」 | 压缩摘要 system 消息(含子段) |
| recall | 含「【与当前问题可能相关的早期对话】」 | 召回段 |
| history / current | user + 顺序 | 最新 user → current,其余 → history |
| assistant | AIMessage 无 tool_calls | 回复文本 |
| toolResults | ToolMessage + AIMessage.tool_calls.args | 工具结果 content **+ 工具参数 args** |
| other | 兜底 | 未匹配段 |

> **注意**:① systemPrompt 各段在**单条 system 消息内以 `\n\n` 分隔**(buildSystemPrompt `parts.join('\n\n')`),需先拆分再标记匹配;② 压缩后消息数组存在**多条 system**(头部 buildSystemPrompt + 摘要 system),需遍历全部 system 而非只认首条;③ base systemPrompt 内部可能含 `\n\n`(DEFAULT_SYSTEM_PROMPT 多段),无标记段聚合进 systemPrompt 桶,无害;④ **memory/todos/skills/subagents/augmentSystem 段均无 `##` 标记**,归 systemPrompt 桶,文档注明「分类为近似展示」;⑤ 匹配用**前缀**,header 文案以源码为准(见上表)。

**估算**:`estimateTokens`(已导出,中文 ~1.5 token/字);`toolResults` 计入 `ToolMessage.content` **且** 前置 `AIMessage.tool_calls.args`(工具参数在 assistant 消息上而非 tool 消息,write/patch 大参数漏估会显著低估);`trimContextIfNeeded` 在 wrapModelCall 时已完成,按截断后文本估。

## 3. 中间件 `context-inspector`

```ts
// src/core/harness/contextInspector.ts
createContextInspectorMiddleware(getContextWindow, thresholdRatio): Middleware
// wrapModelCall: 快照 = analyzeContext(req.messages, { contextWindow, thresholdRatio })
//                state.contextSnapshot = snapshot; next(req)
```

- **装载序**:无 priority 依赖(只读最终消息 + state,不依赖其他中间件);`MIDDLEWARE_PRIORITY` 给数值 priority(如 160)排在 augmentSystem 后、用户中间件前,或自然尾随均可——**采集点在 wrapModelCall,天然拿到全部注入段**。
- `thresholdRatio`:从 `resolveContextOptions` 解析出的 `summaryThresholdRatio` 传入,与压缩逻辑同一真源。
- `contextWindow`:从 `modelCaps` 解析传入(`resolveModelCaps` 恒有值,32K 兜底,occupancy 恒可算)。
- **零 LLM 成本**:仅 `estimateTokens` 计算(已导出,中文 ~1.5 token/字)。

## 4. 压缩统计留存(复用现有,不新增)

`state.lastCompression` **已存在**(`createAgent.ts:503` 在 compressInput 后写 `state.lastCompression = r.stats`),`inspect().lastCompression` 已暴露(`createChatSdk.ts:1355`)。面板直接引用它,不新增写入路径、不与 agent-driven-compression 的 `stats.decision` 重复。

## 5. SDK API

```ts
// ChatSdk 返回对象
inspectContext(): ContextSnapshot | undefined
// inspect() 的 AgentInfo 增 context?: ContextSnapshot
```

- `capabilities.contextInspector`(默认开):关 → 不装中间件 + `inspectContext()` 返 undefined + `inspect().context` undefined + 进度条/tab 隐藏。
- `context.compression` 直接取 `core.agent.getState().lastCompression`(不复制,与现有字段同模式)。

## 6. UI 实现

### ChatDialog 进度条(header 下)
- props:`context?: ContextSnapshot | undefined`
- 渲染:`totalTokens / contextWindow` 百分比进度条 + 数字;色阶绿/黄/红。
- 悬停 tooltip:总 token / 窗口 / 最近压缩 strategy。
- 新增能力开关:`capabilities.contextInspector:false` 时不显示。

### DebugDrawer「📊 上下文」tab
- tab 列表加 `context`(已有 `getInfo` 时显示,同 trace/info tab 条件)。
- 面板:总览进度条 + 分类横向 bar(按 tokens 降序)+ 压缩信息 + usage 累计。

## 7. 与现有机制关系

| 机制 | 关系 |
|---|---|
| `onEvent('usage')` | 互补:usage 给「LLM 实测 token 累计」,context-inspector 给「上下文构成分类」 |
| `CompressionStats` | 增强:原本压缩后即丢,现留存展示 |
| `inspect()` | 增强:新增 `context` 字段 |
| `chatdialog-component-split` | 进度条是 header 新区块,拆分后挪 `#context` slot;本 change 先内置 prop 版 |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| systemPrompt 段切分误判 | 按 `\n\n` 分隔 + 标记匹配,未匹配兜底 other;分类为近似展示,非精确计费 |
| estimateTokens 粗估误差 | 与压缩逻辑同一估算函数,展示「相对占比」足够;真实用量看 `sdk.usage` |
| 快照内存膨胀 | 每轮覆盖单对象(不累积),量级 ~KB |
| 分类粒度漂移(augmentPrompt 段改 header) | 标记集中在 `mission.ts`/`workingMemory.ts`/`useContextManager.ts` 单点;改 header 需同步 contextAnalysis 正则(文档注明) |
