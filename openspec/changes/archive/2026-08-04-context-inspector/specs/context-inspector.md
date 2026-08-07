# Specification Delta: page-agent-core

> 本文件为 change `context-inspector` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 上下文构成可见(context-inspector)

系统每轮 LLM 调用时(`wrapModelCall`,非 beforeModel)对**实际发送的消息**(含全部 augmentPrompt 注入段,replaceSystem 重渲染 + trimContextIfNeeded 截断之后的最终消息)做分类切分与 token 估算,存最近快照供 UI 与集成方读取,全程零 LLM 成本(纯计算)。

- **采集钩子 `wrapModelCall`**:`beforeModel` 在 `replaceSystem`/`trimContextIfNeeded` 之前执行(`createAgent.ts` 循环内顺序),拿不到「实际发给 LLM 的消息」;`wrapModelCall` 的 modelHandler 入参是这两步之后的最终消息,是准确采集点。中间件写 `state.contextSnapshot = analyzeContext(req.messages, { contextWindow, thresholdRatio })`,每轮覆盖不累积。
- **纯函数 `analyzeContext(messages: BaseMessage[], opts) → ContextSnapshot`**(已导出,可单测):输入为 LangChain 消息数组(`AgentMessage.role` 只有 user/assistant/system,无 tool role)。按标记切分细分类——遍历**全部** system 消息(含多条),按 `\n\n` 分隔后标记**前缀**匹配(`## 可操作数据`→dataHint、`## 能力使用提示`→usageHints、`## 当前主线目标`→mission、`## 工作记忆`→workingMemory、`【更早对话摘要】`→memory、`【对话历史摘要】`→summary、`【与当前问题可能相关的早期对话】`→recall、其余→systemPrompt);对话按 role 与顺序——最新 user→current、其余 user→history、assistant 无 tool_calls→回复、ToolMessage→工具结果、AIMessage.tool_calls.args→工具参数。无标记 augmentPrompt 段(memory/todos/skills/subagents/augmentSystem)归 systemPrompt 桶。token 估算复用 `estimateTokens`(中文 ~1.5 token/字粗估);`toolResults` 计入 ToolMessage.content **且** 前置 AIMessage.tool_calls.args。
- **快照结构**:`{ totalTokens, contextWindow?, occupancy(=totalTokens/contextWindow, resolveModelCaps 恒有值→32K 兜底), thresholdRatio, categories[{ key, label, tokens, pct, msgCount }], compression? }`;`categories` 占比合计≈100%。
- **压缩统计引用**:`compression` 直接取已存留的 `state.lastCompression`(`createAgent.ts` 已写,`inspect().lastCompression` 已暴露),不新增写入路径。
- **SDK API**:`sdk.inspectContext(): ContextSnapshot | undefined`;`inspect().context` 反映同一快照。
- **UI**:ChatDialog header 常驻「📊」占用进度条(occupancy% + 总 token;色阶 绿<阈值/黄≥阈值/红≥1;悬停 tooltip 总 token/窗口/最近压缩 strategy);DebugDrawer 新增「📊 上下文」tab(总览进度条 + 分类横向 bar 按 tokens 降序 + 压缩信息 + `sdk.usage` 累计)。
- **`capabilities.contextInspector`** 默认开(opt-out);`false` 关 → 不装中间件、`inspectContext()` 返 undefined、`inspect().context` undefined、进度条与 tab 隐藏。
- **分类标记约定**:augmentPrompt 段 header 集中在 `mission.ts`/`workingMemory.ts`/`useContextManager.ts`/`promptBuilder.ts`/`usageHints.ts` 单点;改动时须同步 `analyzeContext` 的标记匹配(文档注明)。分类为**近似展示**(base systemPrompt 内部 `\n\n` 多段聚合进 systemPrompt 桶),非精确计费。
- **行为约束**:纯只读,不改变任何消息/工具行为;快照反映「当前轮实际发给 LLM 的构成」,跨轮历史变化不影响诊断价值。
