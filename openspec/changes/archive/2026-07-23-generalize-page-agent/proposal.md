# Change: generalize-page-agent

## Why
`page-agent` 当前虽已「框架无关」(Vue 打包进 SDK),但仍有几处**具体实现耦合**,限制了通用性与复用性:

1. **LLM provider 硬编码**:`createAgent` 内部固定 `ChatOpenAI`(OpenAI 协议)。虽兼容 DeepSeek 等 OpenAI 协议端点,但**无法接 Anthropic / Google / 本地 Ollama** 等非 OpenAI 协议模型。
2. **UI 强绑定**:`ChatDialog`(Vue)打包进 SDK 且**不可替换**。集成方无法用自己的 UI(React / 原生 / 无 UI headless)。
3. **内置能力不可拆卸**:todos / skills / vfs / summarization / memory / subagent 中间件打包进 `createPageAgent`,**无单独开关**,无法按需裁剪(体积 / token / 上下文噪音)。
4. **工具源封闭**:工具仅来自内置 + 用户 `toolsets`,无**标准化外部接入**(MCP)。
5. **数据源单一**:核心绑定 `window` 属性操作(虽是 page-agent 特色,但可泛化为 `DataSource` 接口支持 DOM / store / canvas)。

目标:把这些耦合点抽离为**可注入 / 可替换 / 可插拔**的接口,使 page-agent 成为真正的通用页面 Agent 平台,同时**保留 window 操作这一差异化核心**。

## What Changes
1. **LLM provider 抽离**:`createPageAgent({ llm })` 接收 `BaseChatModel` 实例(替代 `{apiKey,...}` 配置对象),集成方自选 provider;保留 `{apiKey,...}` 简写(内部构造 `ChatOpenAI`)向后兼容。
2. **headless / UI 可替换**:`createPageAgent({ ui: false })` headless(不渲染,只返回 agent 核心 + 响应式状态);`{ render: customRender }` 自定义渲染;默认仍 ChatDialog。
3. **能力开关(中间件可插拔)**:`createPageAgent({ capabilities: { planning?, skills?, vfs?, summarization?, memory?, subagent? } })` 控制内置中间件装载;默认全开,向后兼容。
4. **MCP client**:`createPageAgent({ mcp: [{ transport, url }, ...] })` 接 MCP server(浏览器仅 SSE/WebSocket),运行时动态获得外部工具,转为本 agent 工具。
5. **DataSource 接口(谨慎,Phase 5)**:泛化「可操作对象」为 `DataSource` 接口(window / DOM / store),page-agent 不限于 window(保留 window 为默认实现)。
6. **预设(presets)**:常见场景配置包(`presets.pageBuilder` / `presets.dataQuery`),一键装载。

## Impact
- **新增**:LLM provider 注入、headless/render、capabilities 开关、mcp client、DataSource 接口、presets。
- **改造**:`createAgent`(接收 model 实例)、`createPageAgent`(ui / capabilities / mcp 选项)、内置中间件(可条件装载)。
- **影响规范**:`specs/page-agent-core.md`(增量:provider/UI/capabilities/mcp/datasource requirement)。
- **向后兼容**:所有新选项默认 = 现状行为,不破坏现有集成。
- **范围控制**:6 项互相独立,可分 change 推进;本 change 作为伞形规划,实施时可拆为子 change。
