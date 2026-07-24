# Change: improve-observability-and-ui

> 对应 `doc/待确认问题.md` #4 #5 #7 #8(分阶段落地计划**阶段 2**:调试可见性 + UI 模块化/样式)。

## Why

1. **调试缺 MCP 可见性**(#4 #5):`AgentInfo` 无 `mcp` 字段,工具列表不标来源 → 接了 MCP server 也看不出哪些工具来自哪个 server;DebugDrawer 无 MCP 区块。
2. **正常回复无操作**(#5):只有出错时才有「重试」;正常 assistant 回复缺「复制 / 重新生成」。停止键存在(发送键变形)但不够显眼,能力信息(MCP/tools)主界面看不到。
3. **UI 组件未导出**(#7):`ChatDialog`/`MessageContent`/`CodePreview` + `useChat` 未从入口导出,headless(`ui:false`)自建 UI 无法复用这些组件与逻辑。
4. **样式 AI 风格化重、不可配**(#8):紫渐变头 `#667eea→#764ba2` + emoji 头像 + 打字三点动画写死,集成方无法换主题、关装饰。

## What Changes

1. **AgentInfo 加 mcp + 工具来源**:getInfo 返回 `mcp: { servers: [{name,url,toolCount}] }`;每个工具标 `source: 'builtin' | 'mcp:<name>' | 'user'`。
2. **DebugDrawer 增强**:Agent 信息 tab 加「🔌 MCP」区块;工具列表显示来源标签。
3. **regenerate + 复制**:`useChat` 抽取流式块、加 `regenerate()`(移除最后一条 assistant → 以当前历史重发流式);ChatDialog 正常回复加 hover「复制 / 重新生成」。
4. **能力徽标**:ChatDialog 输入区旁显示 `🔌N MCP · N tools`,点击开 DebugDrawer Agent 信息 tab。
5. **导出 UI 模块**:`ChatDialog`/`MessageContent`/`CodePreview` + `useChat` 从入口导出。
6. **样式可配**:暴露 CSS 变量(`--pa-primary`/`--pa-bg`/`--pa-radius`)+ props(`showAvatar`/`showTyping`/`theme`);默认换**中性主题**(去紫渐变,单色主色;emoji/动画可关)。

## Impact

- **改造**:`createPageAgent`(getInfo mcp + 工具 source + core 记 mcpServers)、`types`(+`.d.ts`)、`composables/useChat`(regenerate)、`components/ChatDialog.vue`(regenerate/复制/徽标/CSS 变量/中性主题)、`components/DebugDrawer.vue`(MCP 区块/来源标签)、`index.ts`(导出 UI 模块)。
- **向后兼容**:新增字段/导出/props,默认行为不变(headless、现有 UI 仍工作;CSS 变量有默认值)。
- **spec delta**:4 条新 Requirement。

## Non-goals

- **不改** harness 核心 / windowOps / 中间件。
- 样式不推翻重做,只「可配化」+ 默认换中性主题(集成方仍能覆盖)。
- 不做回退 UI 撤销键(阶段 3)、验证增强(阶段 3)、改名(阶段 0)。
