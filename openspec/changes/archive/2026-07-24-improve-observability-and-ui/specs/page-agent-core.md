# Specification Delta: page-agent-core

> 本文件为 change `improve-observability-and-ui` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: Agent 信息含 MCP 与工具来源

`inspect()`(getInfo)返回已连接 MCP server 列表(`mcp.servers: [{name, url, toolCount}]`)与每个工具的来源标注(`source: 'builtin' | 'mcp:<name>' | 'user'`)。内置工具标 `builtin`,MCP 注入工具标 `mcp:<serverName>`,用户 `tools`/`toolsets` 标 `user`。DebugDrawer「Agent 信息」展示 MCP 区块与工具来源标签,使集成方能看清工具来源构成。

## Requirement: 对话 regenerate 与复制

正常(非错误)assistant 回复支持「复制」与「重新生成」:重新生成移除该回复,以当前对话历史(含最后一条 user)重发流式生成。错误时的「重试」、生成中的「停止」(abort)保留。loading 期间禁用复制/重新生成。

## Requirement: UI 模块可独立导出

`ChatDialog` / `MessageContent` / `CodePreview` 组件与 `useChat` composable 从 SDK 入口导出,支持 headless(`ui:false`)模式下集成方自建 UI 时复用对话框组件与流式/重试/停止/重生成逻辑,而不必重新实现。

## Requirement: UI 样式可配

`ChatDialog`/`DebugDrawer` 暴露 CSS 变量(主色 `--pa-primary`、背景、圆角等,提供默认值)与 props(头像显示 `showAvatar`、打字动画 `showTyping`);默认采用中性主题(去渐变、单色主色)。集成方可经 CSS 变量覆盖主题或经 props 关闭装饰,无需改组件代码。
