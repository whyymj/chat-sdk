# Spec Delta: page-agent-core

> 本文件为 `add-structured-todos-and-subagent-writes` 变更对 `openspec/specs/page-agent-core.md` 的增量。归档时合入主规范。

## Requirement: 结构化 todos 与增量更新

Todo schema 扩展为 `{ id, content, status, parentId?, deps?, criteria?, evidence? }`,支持层级与依赖表达。新增 `update_todo({ id, status?, evidence? })` 工具支持单项增量更新(减少 token),与 `write_todos` 整表替换并存。`augmentPrompt` 渲染层级(有 parentId 缩进)+ 标注依赖阻塞状态。`wrapToolCall` 限制一轮内 `update_todo` + `write_todos` 不可同时调用。不传 id/parentId/deps = 现状(扁平列表)。

## Requirement: todo 完成证据校验

`capabilities.todoEvidence`(默认 `false`)开启后,`write_todos`/`update_todo` 标 `completed` 状态需附 `evidence`(tool callId),框架校验 callId 在当前会话 messages 中存在且对应 ToolMessage 无错误,否则 `TODO_EVIDENCE_MISSING` 拒绝更新。默认关闭(零开销)。

## Requirement: 子 agent 可选写权限

`SubagentConfig` 与 `spawn_agent`/`spawn_agents`/`use_<id>` 支持 `allowedTools?: string[]`(工具白名单,默认只读)与 `writablePaths?: string[]`(jsonPath 前缀白名单)。配置后子 agent 工具集含 `write`/`draft_write`/`draft_commit`,但 write 操作限定 `writablePaths` 前缀,越界返回 `PATH_OUT_OF_SCOPE`。子 agent 仍排除 spawn 工具(防递归)。默认只读(现状)。

## Requirement: 子 agent 结构化返回

子 agent 返回支持结构化 JSON:`{ conclusion: string; findings?: string[]; scopeCompleted: boolean; needsParentAction?: string }`。框架 try/catch 解析,合法 JSON 含 `conclusion` 字段为结构化,否则按纯文本(向后兼容)。超大结构化返回经 offload 外存 vfs,主 agent 收摘要 + vfs 引用。

## Requirement: spawn handoff 强制

`capabilities.subagentHandoff`(默认 `false`)开启后,`afterToolCall` 检测 spawn 工具返回,下一轮 `beforeModel` 检查是否调 `update_todo` 或输出含 synthesis 关键词(「综上」「基于子结论」「synthesis」等),未满足则注入 HumanMessage 提醒「先对照主线目标 synthesis 再下一步」。默认关闭(避免过度约束简单场景)。
