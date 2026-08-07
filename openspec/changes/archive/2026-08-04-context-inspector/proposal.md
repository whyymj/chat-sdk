# Change: context-inspector(上下文查看面板 · 大小/分类/占比)

> 📦 **已归档(2026-08-07)**:`analyzeContext` 纯函数 + `wrapModelCall` 中间件(每轮覆盖快照)+ DebugDrawer「📊 上下文」tab(进度条+分类 bar)+ `sdk.inspectContext()`/`inspect().context` + `capabilities.contextInspector`(默认开)已实施并随 **2.24.1** 发布(selftest sec-50 23 项 + e2e inspect.mjs 5 项;usage-guide 中文小节已补)。tasks.md 未勾项:ChatDialog 常驻进度条**用户拍板推后**(DebugDrawer tab + inspectContext API 已覆盖诊断需求)、browser tab 测试归手动、`HarnessState.contextSnapshot` 字段改用闭包持有(效果等价,wrapModelCall 无 state update 机制);英文 usage-guide 同步归入文档收尾。

> 用户诉求(2026-08-04):「对话框增加上下文大小、分类、占比的查看面板」。
> **状态**:proposal(未实施)。独立 change,与 `chatdialog-component-split`(ChatDialog 拆分)互补但可独立实施。**用户拍板:DebugDrawer 新 tab + 常驻进度条 / beforeModel 真实快照 / 细分类。**

## Why

长对话 + 大 JSON 场景,用户/集成方**看不到上下文构成**:当前消息量多大?离压缩触发阈值多远?摘要占了多少?工具结果是否膨胀?回答质量下降时,第一诊断动作就是「看上下文里什么占了最多」——现在只能靠猜。

现有能力各自独立、缺一个统一的上下文构成视图:

| 现有能力 | 作用 | 缺什么 |
|---|---|---|
| `estimateTokens`(已导出) | 单文本 token 粗估 | 未对「发给 LLM 的整条消息 + systemPrompt 注入段」做分类汇总 |
| `onEvent('usage')` | 每轮 LLM 实测 token(prompt/completion/cumulative) | 只有数值,没有「哪一类消息占了多少」 |
| `CompressionStats`(`compress` 返回,`inspect().lastCompression` 已留存) | 触发/轮数/策略 | 有留存但**未做分类/占比展示**,也未进「实际发送消息」的构成视图 |
| `inspect().contextPreset/mission/workingMemory` | 各 pin 状态 | 无「当前上下文整体构成」视图 |
| DebugDrawer | 日志/流程/Trace/信息 4 tab | 无上下文构成 tab |

## What Changes

新增**上下文检查(context-inspector)**能力:每轮 LLM 调用前(`beforeModel`)对**实际发送的消息**(含所有 augmentPrompt 注入段)按标记切分、估算 token、分类汇总,存最近快照;ChatDialog 常驻占用进度条 + DebugDrawer「📊 上下文」tab 展示大小/分类/占比。

### 1. 快照中间件 + 纯函数
```ts
// 纯函数(可单测):对「实际发给 LLM 的消息数组」分类切分 + token 估算
interface ContextCategory { key: string; label: string; tokens: number; pct: number; msgCount: number }
interface ContextSnapshot {
  totalTokens: number
  contextWindow?: number          // 模型窗口(modelCaps,恒有值→32K 兜底)
  occupancy: number               // totalTokens / contextWindow(0~1+)
  thresholdRatio: number          // 触发压缩阈值(如 0.5)
  categories: ContextCategory[]   // 细分类(见下)
  compression?: CompressionStats  // 最近一次压缩统计(直接引用 state.lastCompression,非新增写入)
}
function analyzeContext(messages: BaseMessage[], opts): ContextSnapshot
```
- **采集钩子:`wrapModelCall`(非 beforeModel)** —— beforeModel 在 `replaceSystem`(重渲染 system)/`trimContextIfNeeded`(截断工具结果)之前执行(`createAgent.ts:533-536`),拿不到「实际发给 LLM 的消息」;`wrapModelCall` 的 modelHandler 入参是 replaceSystem + trim 之后的最终 `currentMessages`(546 行),是准确采集点。
- 中间件 `context-inspector`:`wrapModelCall` 调 `analyzeContext`(对最终消息),存 `state.contextSnapshot`(每轮覆盖,不累积)。
- 压缩统计:**复用已留存的 `state.lastCompression`**(`createAgent.ts:503` 已写,`inspect().lastCompression` 已暴露),面板直接引用,不新增写入路径。

### 2. 细分类(按标记切分)
| 分类 key | 判定 | 内容 |
|---|---|---|
| `systemPrompt` | system 段未匹配下标记 | 身份 + 业务知识 + reliableWriteRules |
| `dataHint` | system 含「## 可操作数据」 | `extractSchemaHint` 注入的 schema 概览(`promptBuilder.ts`) |
| `usageHints` | system 含「## 能力使用提示」 | `usageHints` 中间件注入的 toolMode 提示(`usageHints.ts`) |
| `mission` | system 含「## 当前主线目标」 | mission pin 段 |
| `workingMemory` | system 含「## 工作记忆」 | workingMemory pin 段 |
| `memory` | system 含「【更早对话摘要】」 | trimMemoryMessages 的持久指令摘要(`rounds.ts` MEMORY_SUMMARY_PREFIX) |
| `summary` | system 含「【对话历史摘要】」 | 压缩摘要 system 消息(含「【更早累积摘要】」「【当前可操作数据…】」子段) |
| `recall` | system 含「【与当前问题可能相关的早期对话】」 | 关键词召回段 |
| `history` | user 且非最新一条 | 窗口内历史对话 |
| `current` | 最新一条 user | 当前问题 |
| `assistant` | assistant 无 tool_calls | agent 回复文本 |
| `toolResults` | ToolMessage + assistant 的 tool_calls.args | 工具结果(content)+ **工具名/参数(args,write/patch 大参数必计入)** |
| `other` | 兜底 | 未匹配段 |
- **估算**:`estimateTokens`(已导出);`toolResults` 计入 `ToolMessage.content` **且** 前置 `AIMessage.tool_calls.args`(工具参数在 assistant 消息上而非 tool 消息,漏估会显著低估 write/patch 类占用);`trimContextIfNeeded` 在 wrapModelCall 时已完成截断,按截断后文本估。
- **输入类型**:`BaseMessage[]`(LangChain 消息数组,含 HumanMessage/AIMessage/SystemMessage/ToolMessage;`AgentMessage.role` 只有 user/assistant/system,无 tool role,不可作纯函数输入)。
- **无标记 augmentPrompt 段**(memory/todos/skills/subagents/augmentSystem)归 systemPrompt 桶,占比可诊断性有限,文档注明「分类为近似展示」。

### 3. SDK API
```ts
sdk.inspectContext(): ContextSnapshot | undefined   // 最近一次 wrapModelCall 快照
inspect().context                                  // 反映同一快照
```
- `capabilities.contextInspector` 默认**开**(零 LLM 成本,纯计算;同 inspectEnv 定位);`false` 关 → 不装中间件、`inspectContext()` 返 undefined、进度条/tab 不显示。

### 4. ChatDialog 常驻进度条
- header 加「📊」占用进度条:占用 %(`totalTokens / contextWindow`)+ 总 token 数。
- 悬停显示一行概览:总 token / 窗口 / 最近压缩策略。
- 色阶:绿(occupancy < 阈值) → 黄(≥阈值,接近压缩) → 红(≥1,超窗口)。
- 与 `chatdialog-component-split` 关系:进度条是 header 下新区块,拆分后由 `#context` slot 承载;本 change 先做内置 prop 版(同 focus 焦点条约定)。

### 5. DebugDrawer「📊 上下文」tab
- 新 tab,展示最近快照:
  - 总览:totalTokens / contextWindow / occupancy%(进度条)/ thresholdRatio(压缩阈值线)/ 最近压缩 strategy
  - 分类列表:每类 label + token + 占比条(横向 bar),按 tokens 降序
  - 压缩信息:roundsTotal / roundsSummarized / roundsRecalled(若最近触发)
  - usage 实测:累计 prompt/completion/total(取自 `sdk.usage`)

## Impact

- **测试**:
  - selftest:纯函数 `analyzeContext` 分类切分(token 估算/标记识别/兜底 other)/ 快照压缩统计留存 / capabilities 关后不采集。
  - e2e:`inspect().context` 反映 + `inspectContext()` 返回 + capabilities 关后 undefined。
  - browser:进度条渲染 + 占用% + DebugDrawer 上下文 tab 展示分类。browser 计数 +2~3。
- **行为变化**:无。新增能力默认开但纯只读,不改变任何消息/工具行为。
- **向后兼容**:全增量(新 API + 新 tab + 新 capability);关闭后与现状一致。

## 决策

1. **beforeModel 真实快照(用户拍板)**:统计「实际发给 LLM 的消息」而非 UI 侧估算 —— 才能看到 systemPrompt 注入段(augmentPrompt 各段)的真实占比。UI 侧只有 messages 数组,看不到注入段。
2. **细分类(用户拍板)**:按已知标记切分;标记格式稳定(augmentPrompt 段 header 固定),未匹配兜底 other 防漏。
3. **DebugDrawer 新 tab + 常驻进度条(用户拍板)**:进度条轻量常驻可见,完整分类放 DebugDrawer(不占对话区)。
4. **快照每轮覆盖不累积**:反映「当前这一轮发给 LLM 的构成」,避免内存膨胀;usage 实测累计已有 `sdk.usage`。
5. **默认开、零 LLM 成本**:纯 `estimateTokens` 计算,无额外模型调用;opt-out 同 inspectEnv。

## Non-goals

- 不做上下文编辑/手动调整(手动改摘要、删轮次——future)。
- 不做压缩触发的自动建议/干预(只展示)。
- 不做实时逐 token 流式监控(每轮快照即可)。
- 不依赖 `chatdialog-component-split`(进度条先内置 prop 版,拆分时挪 slot)。
- 不依赖 `focus-context`(分类表预留 mission/workingMemory,不预埋 focus)。
