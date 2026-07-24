# Design: improve-observability-and-ui

## 1. AgentInfo.mcp + 工具来源

**core 记 MCP 元信息**:`AgentCore` 加 `mcpServers: { name: string; url: string; toolCount: number }[]`。`initDone` 内 `connectMcp` 后填充(每个 server:name/url 来自 config,toolCount = 注入工具数;失败的 server 不进)。

**getInfo()** 返回:
```ts
mcp: { servers: core.mcpServers }
tools: allTools.map(t => ({ name, description, schema, source }))
```
**来源标注**(`source`):构造 `allTools` 时按段标注:
- `createWindowOps` / `fetchDocTools` → `'builtin'`
- `mcpTools`(连 server 后 push)→ `'mcp:<serverName>'`
- `options.tools` / `options.toolsets` → `'user'`

实现:把 `allTools` 从 `StructuredToolInterface[]` 升级为带元信息的结构,或并行维护 `toolSources: Map<toolName, source>`。后者改动小(不改工具对象):getInfo 时按 map 标注。**决策**:用并行 `toolSources` map(在 buildCore 维护),不改 LangChain 工具对象。

## 2. DebugDrawer MCP 区块 + 来源标签

- Agent 信息 tab:子 Agent 区块后加「🔌 MCP」区块(servers: `name · N tools`,无则隐藏)。
- 工具列表:每项 name 后跟来源小标签(`builtin` 灰 / `mcp:x` 紫 / `user` 蓝)。

## 3. regenerate + 复制

**useChat**(`composables/useChat.ts`):
- 抽取 `sendMessage` 内的流式占位 + 增量更新逻辑为内部函数 `runStream(messages, signal)`(regenerate 复用)。
- `regenerate()`:找最后一条 `role==='assistant'` → `splice` 移除它(及尾部)→ 以 `state.messages.slice()` 调 `fetchStream` 重发(不重发 user,历史已含最后 user)。loading 期间禁用。
- 导出 `regenerate` 供 ChatDialog 用。

**ChatDialog**:最后一条 assistant 回复(非 loading)加 hover 操作栏:`复制`(navigator.clipboard content)/ `重新生成`(调 regenerate)。error-bar 重试保留。

## 4. 能力徽标

ChatDialog 输入区(footer)左侧加徽标:`🔌{{mcpCount}} MCP · {{toolCount}} tools`(getInfo 拉;mcpCount=0 时只显示 tools)。点击 → `debugVisible=true` + 切 info tab。ChatDialog 需 `getInfo`(已有 prop)。

## 5. 导出 UI 模块

`index.ts`:
```ts
export { default as ChatDialog } from './components/ChatDialog.vue'
export { default as MessageContent } from './components/MessageContent.vue'
export { default as CodePreview } from './components/CodePreview.vue'
export { useChat } from './composables/useChat'
```
`.d.ts` 镜像(组件用 `DefineComponent`,useChat 用函数签名)。

## 6. 样式可配 + 中性主题

**CSS 变量**(ChatDialog 根 `.chat-dialog` + DebugDrawer `.drawer-panel` 设默认值,集成方可覆盖):
```css
--pa-primary: #4f46e5;    /* 主色(替代紫渐变,单色) */
--pa-primary-rgb: 79,70,229;
--pa-bg: #ffffff;
--pa-radius: 12px;
--pa-bubble-ai: #f3f4f6;
```
头部/发送键/用户气泡:从 `linear-gradient(#667eea,#764ba2)` 改 `var(--pa-primary)`(单色);hover 用 `rgba(var(--pa-primary-rgb),0.9)`。

**props**(ChatDialog):
- `showAvatar?: boolean`(默认 true;false → 不显示 🤖/👤 emoji 头像)
- `showTyping?: boolean`(默认 true;false → 关打字三点动画,改纯文字「思考中…」)

**默认中性主题**:去渐变 + 单色主色;emoji/动画可经 props 关。不改布局结构。

## 验证

- `tsc` + `test`(无新增纯函数可测,UI 改动为主;若 useChat 抽取有纯逻辑可补 1-2 断言)+ `build`。
- `npm run dev`:mcp-demo → DebugDrawer Agent 信息见 MCP 区块 + 工具来源标签;正常回复 hover 复制/重新生成;改 CSS 变量主题生效;headless `import { ChatDialog }` 自建渲染。
