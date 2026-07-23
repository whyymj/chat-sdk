# Design: generalize-page-agent

> 每项给方案、权衡、落地点、风险。6 项互相独立,按优先级分 Phase 实施。

## 1. LLM provider 抽离(Phase 1,最高价值)

**现状**:`createAgent` 内 `new ChatOpenAI({ apiKey, model, configuration: { baseURL } })` —— 硬编码 OpenAI 协议。

**方案**:`CreateAgentOptions` 加可选 `model?: BaseChatModel`(已构造的 LangChain 模型实例)。优先级:`options.model` > 用 `llm` 配置构造 `ChatOpenAI`。
```ts
createPageAgent({
  llm: new ChatAnthropic({ model: 'claude-...' }),  // 任意 provider
  // 或 llm: { apiKey, model } 简写(内部 ChatOpenAI,向后兼容)
})
```

**落地点**:`createAgent.ts`(优先用 `options.model`,否则按 `llm` 配置构造)、`createPageAgent.ts`(透传 `model`)、类型。

**权衡**:LangChain 已支持多 provider(`@langchain/anthropic` 等,peerDep 由集成方装),抽离后真正 provider 无关;`reasoning_content`(DeepSeek)等 provider 特有字段需在 `coreModelCall` 兼容(已有 `ak.reasoning_content || ak.reasoning` 容错)。

**风险**:不同 provider 的 tool_calls / structured output 行为差异(Anthropic 与 OpenAI 格式略不同)—— LangChain 已抹平大部分,需测。

## 2. headless / UI 可替换(Phase 2)

**现状**:`createPageAgent().mount()` 内部固定 `h(ChatDialog, {...})` 渲染 Vue 对话框。

**方案**:
- `ui?: boolean | 'default'`(`false` = headless,不渲染)。
- `render?: (ctx: { core, messages, send, stop, ... }) => void`(自定义渲染,接收状态 + 操作)。
- 默认 `ui: 'default'` = ChatDialog。

headless 时 `mount()` 不创建 Vue app,只 init agent;返回的 `PageAgent` 暴露响应式 `messages` + `send/stop/inspect`,集成方自建 UI。

**落地点**:`createPageAgent.ts`(`mount` 条件渲染;headless 暴露 `messages`/`state`)、`PageAgent` 接口(加 `messages?`/`state?` 只读访问)。

**权衡**:headless 让 SDK 不强制 Vue(框架无关更彻底);但需稳定暴露内部状态 API(响应式 messages、loading、error),这是新的公开契约。

**风险**:状态暴露 API 的稳定性(headless 集成方依赖 messages 结构)。

## 3. 能力开关 capabilities(Phase 3)

**现状**:内置 6 中间件恒装(仅 `contextOptions:false` 关压缩、`maxRetries:0` 关重试)。

**方案**:
```ts
createPageAgent({
  capabilities: {
    planning: false,    // 关 todos
    skills: false,      // 关 skills
    vfs: false,         // 关 vfs 工作区(大结果外存退化为截断)
    summarization: false,
    memory: false,
    subagent: false,
  }
})
```
默认全 `true`(现状)。

**落地点**:`createPageAgent.ts`(`middlewares` 数组按 `capabilities` 条件装载)。

**权衡**:按需裁剪 —— 简单场景(只 window 操作)可关 planning/skills/vfs 省 token + 体积;但中间件间有隐含依赖(vfs 关了 → 大结果外存退化;summarization 关了 → 长会话不压缩)。需文档标注依赖。

**风险**:中间件依赖关系(vfs 被其他能力依赖?)需梳理;关掉后行为退化要明确。

## 4. MCP client(Phase 4)

**现状**:工具仅内置 + 用户 `toolsets`。

**方案**:`createPageAgent({ mcp: [{ transport: 'sse', url }, ...] })`。
- 新模块 `src/core/mcp/`(client + transport)。
- 浏览器**仅 SSE/WebSocket** transport(stdio 需 Node,不可用 —— 关键约束)。
- `mount()` 阶段连 server → `listTools()` → 转 `StructuredToolInterface` → 合并 `allTools`。

**落地点**:新 `mcp/` 模块;`createPageAgent` `mcp` 选项 + mount 时连。

**权衡**:接 MCP 生态(海量外部工具);但 `@modelcontextprotocol/sdk` 体积大(影响 IIFE 1.4MB),需评估懒加载或自实现轻量 client。

**风险**:浏览器 transport 限制(仅远程);异步工具发现(工具 mount 后才就绪);单 server 挂不能影响主。

## 5. DataSource 接口(Phase 5,谨慎)

**现状**:`windowOps` 直接操作宿主 `window`(page-agent 核心特色)。

**方案**:抽象 `DataSource` 接口:
```ts
interface DataSource {
  get(path): unknown
  set(path, value): void
  describe(path): string
  // ...
}
```
`windowDataSource`(默认,操作 window)+ 用户自定义(DOM/store/canvas)。`createPageAgent({ dataSource: customDS })`。

**落地点**:`windowOps` 重构为基于 `DataSource`(window 是一个实现)。

**权衡 ⚠️**:**偏离 page-agent 定位**(它就是页面 window agent)。泛化收益(操作任意数据源)vs 定位稀释。**建议**:仅当有明确非 window 场景需求时做;否则保持 window 核心,DataSource 作为预留接口。

**风险**:过度抽象增加复杂度,且 window 操作的 schema/快照/Vue reactive 兼容是深度定制,泛化后这些特性需重新映射。

## 6. 预设 presets(Phase 6)

**现状**:每次 `createPageAgent` 全配置。

**方案**:`presets` 导出常见场景配置包:
```ts
import { createPageAgent, presets } from 'page-agent'
createPageAgent({ ...presets.pageBuilder, container: '#root' })
```
`presets.pageBuilder` = { systemPrompt, windowProps 示例, skills, toolsets } 等。

**落地点**:新 `presets.ts` 导出预设对象。

**权衡**:降低上手门槛;预设是纯配置(无新机制),低风险。

**风险**:预设需维护(跟随 API 演进)。

---

## 实施策略
- 6 项独立,优先级:**1 (provider) > 2 (headless) > 3 (capabilities) > 4 (mcp) > 6 (presets) > 5 (datasource,谨慎)**。
- 可拆为多个子 change(每项一个),本 change 作伞形规划。
- 每项:proposal 子文件 + 实现 + specs delta + 自测 + 归档。
- 全程向后兼容:新选项默认 = 现状。
