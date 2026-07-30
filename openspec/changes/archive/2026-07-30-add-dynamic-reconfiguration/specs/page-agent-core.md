# Specification Delta: page-agent-core

> 本文件为 change `add-dynamic-reconfiguration` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 运行时动态工具加载/卸载(tools)

系统提供 `sdk.setTools(tools)` / `sdk.addTool(tool)` / `sdk.removeTool(name)`,集成方可在运行时替换、追加、移除**用户自定义工具**。`setTools` 只替换用户工具部分,内置工具(由 `capabilities` 控制的 dataOps/fetchDoc 等)不受影响。调用后内部重新执行 `llm.bindTools(allTools)` 绑定最新工具集,下一轮 LLM 调用即生效;`inspect().tools` 经 `infoTick` 触发刷新实时反映。不调用这些方法时行为与现状一致(创建时 `tools` 选项固定工具集)。该机制支持「按权限/业务阶段/A-B 实验动态切换工具组」等场景,无需重建 agent(保留对话历史与中间件状态)。

## Requirement: 运行时动态子 agent 加载/卸载(subagents)

系统提供 `sdk.setSubagents(configs)` / `sdk.addSubagent(config)` / `sdk.removeSubagent(id)`,集成方可在运行时替换、追加、移除预声明子 agent 配置。每次变更内部重新生成 `use_<id>` 委派工具并触发工具重新绑定(复用 tools 动态机制)。`inspect().subagent` 实时反映当前子 agent 配置。创建时经 `subagents:[]` 预声明仍支持(向后兼容)。`capabilities.subagent` 关闭时 controller 为 null,setter 调用 warn 提醒但不抛错。该机制支持「运行时根据任务类型决定委派哪些子 agent」等动态编排场景。

## Requirement: 运行时动态模型切换(llm)

系统提供 `sdk.setLlm(llm)`,参数为 `BaseChatModel` 实例或 `LLMConfig`(内部构造 `ChatOpenAI`)。调用后内部替换模型实例、重新绑定工具、重解析模型能力(`contextWindow`/`maxOutputTokens`,影响 offload 阈值与压缩触发),下一轮 LLM 调用即用新模型。`inspect().model` 实时反映。新模型若不支持 tool calling(`bindTools` 缺失)则 warn 提醒(工具调用会失效,但 agent 不崩)。`summaryLlm`(摘要专用模型)独立,不受 `setLlm` 影响。不调用时模型保持创建时配置(向后兼容)。该机制支持「配额耗尽切便宜模型 / 复杂任务切强模型 / 切换 provider」等场景。

## Requirement: 运行时动态 memory 更新(memory)

系统提供 `sdk.setMemory(text)`,集成方可在运行时更新持久指令 memory 文本。内部更新中间件持有的 memory 变量,下一轮 `augmentPrompt` 注入最新值;`setMemory('')` 清空(空串跳过注入)。`inspect().memory` 实时反映。不调用时 memory 保持创建时 `options.memory` 配置(向后兼容)。该机制支持「运行时切换业务上下文 / 追加业务约束」等场景,无需重建 agent。
