# Specification Delta: page-agent-core

> 本文件为 change `harden-react-loop-budget` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: ReAct 循环预算语义(工具轮与总迭代分离)

`createAgent` 的 `maxToolRounds` 严格限定**工具调用轮**(有 `tool_calls` 并执行工具的轮),格式自纠(format retry)与 verify 自纠(no tool_calls 但回灌 feedback 重生成)**不计入 `maxToolRounds`** —— 它们使用各自独立预算(`maxFormatRetries` / `maxVerifyAttempts`)。为防自纠导致的死循环,循环另设总迭代硬上限 `maxIterations`(默认 `max(maxToolRounds * 3, 30)`,可经 `CreateAgentOptions.maxIterations` 显式覆盖),每次循环(含自纠)+1,触顶强制退出。该语义修正使 `maxToolRounds` 符合用户直觉("最多 N 轮工具调用"),自纠不再挤占工具预算;`maxIterations` 作为资源耗尽的总闸兜底。循环耗尽且无缓存最终答时,兜底文案引导用户基于已完成工具结果继续(而非要求"简化问题")。
