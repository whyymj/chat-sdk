# Specification Delta: page-agent-core

> 本文件为 change `refine-tool-layering` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 内置工具按需装载

`createPageAgent` 默认装配 window 操作工具集(`windowOps`)与文档抓取工具(`fetchDoc`)。两者可分别经 `capabilities.windowOps` / `capabilities.fetch` 关闭(默认均 `true`,保持零配置体验)。关闭后对应工具不进入主 agent 工具池,从而省 token 与上下文噪音(如纯调研场景)。子 agent 的只读工具白名单从主工具池筛选,故关闭某类工具时子 agent 同步不具备该类工具(符合「本 agent 不做此类操作」的语义)。子 agent 的隔离与递归切断机制本身不受影响。

## Requirement: 内置工具集可独立导出与注入

`createWindowOps` 与 `fetchDocTools` 从 SDK 入口导出;另提供 `fetchTools` 静态 toolset 预设(`defineToolset('fetch', fetchDocTools)`)。集成方可 `import { createWindowOps, fetchDocTools }` 手动构造工具集,经 `tools` 或 `toolsets` 注入(替代默认自动装配),支持「主要业务工具集单独引入、按需注入」的高级用法。window 工具集依赖集成方声明的 `windowProps`,故不预构造为静态预设,由集成方手动 `createWindowOps(props)` 构造。

## Requirement: 能力用法默认提示(克制注入)

各内置能力(planning / window 快照回退 / subagent)在**该能力开启**时,由 `createPageAgent` 统一向 system prompt 注入一行简短用法提示(如「多步任务先 `write_todos` 拆解」「误改可用 `restore_window_snapshot` 回退」「独立子任务可 `spawn_agent` 委派」)。提示仅在该能力开启时注入,全部关闭时不注入(返回 `undefined`,不增加上下文);绝不覆盖集成方自定义 `systemPrompt`(拼接在其后)。子 agent 的默认 systemPrompt 明示其只具备只读工具、应给出简洁结论。
