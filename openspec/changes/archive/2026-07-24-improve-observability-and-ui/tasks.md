# Tasks: improve-observability-and-ui

> 状态:**已完成(待归档)**。关联:本目录 `proposal.md` / `design.md`;`doc/待确认问题.md` #4#5#7#8。

## 期一 — AgentInfo.mcp + 工具来源 + DebugDrawer(#4 #5)

- [x] `createPageAgent.ts`:`AgentCore` 加 `mcpServers`;`initDone` 连 MCP 后填充;buildCore 维护 `toolSources` map;`getInfo` 返回 `mcp.servers` + `tools[].source`(builtin/mcp:`<name>`/user)
- [x] `types/index.ts` + `.d.ts`:`AgentInfo.mcp`、`ToolInfo.source`
- [x] `DebugDrawer.vue`:Agent 信息 tab 加「🔌 MCP」区块 + 工具来源标签(`srcClass` + CSS)

## 期二 — regenerate + 复制 + 能力徽标(#5)

- [x] `useChat.ts`:抽取 `runAssistantStream`;加 `regenerate()`(移除最后 assistant → 重发流式)
- [x] `ChatDialog.vue`:最后 assistant hover「复制 / 重新生成」;footer 能力徽标 `🔌N MCP · N tools`(点击开 Agent 信息)

## 期三 — UI 导出 + 样式可配(#7 #8)

- [x] `index.ts` + `.d.ts`:导出 `ChatDialog`/`MessageContent`/`CodePreview`/`useChat`(`env.d.ts` 已有 `.vue` shim,tsc 无碍)
- [x] `ChatDialog`/`DebugDrawer`:CSS 变量(`--pa-primary` 等,默认中性主题)+ props(`showAvatar`/`showTyping`);默认中性主题(去紫渐变单色主色)

## 期四 — 收口

- [x] 文档:`CLAUDE.md`(UI 导出 + AgentInfo.mcp + 主题定制)+ `doc/usage-guide.md`(headless 复用 ChatDialog + 主题)
- [x] 门禁:`tsc` + `test`(157/157)+ `build`(UMD 390KB / IIFE 1.59MB / CSS 20.2KB)全过
- [x] `/opsx:archive improve-observability-and-ui`(specs 增量 4 条合入主 specs)

> 全程向后兼容:新增字段/导出/props;CSS 变量有默认值,不传 props 行为不变。`useChat.regenerate` 为运行时行为(同 retry/stop),手动验证。
