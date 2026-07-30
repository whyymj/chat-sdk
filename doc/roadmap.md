# page-agent-sdk 演进设想与建议

基于 [问题.md](./问题.md) 列出的待办项，逐条给出现状分析、设计设想与落地建议。版本号为目标版本，非承诺。

---

## 目录

- [#3 reliableWriteRules 支持自定义规则](#3-reliablewriterules-支持自定义规则)
- [#5 动态刷新/重置 agent 配置](#5-动态刷新重置-agent-配置)
- [#6 上下文留存条数配置](#6-上下文留存条数配置)
- [#7 对话框组件彻底分离](#7-对话框组件彻底分离)
- [#8 LLM 特殊传参透传](#8-llm-特殊传参透传)
- [#9 普通 OpenAI 兼容接口代理](#9-普通-openai-兼容接口代理)
- [#10 禁用上下文/缓存 + middleware 改上下文](#10-禁用上下文缓存--middleware-改上下文)
- [#11 README 简化 + 增加 examples](#11-readme-简化--增加-examples)
- [#12 流程编排插件](#12-流程编排插件)
- [#13 免费官网与反馈渠道](#13-免费官网与反馈渠道)
- [#14 其他执行模式抽象](#14-其他执行模式抽象)
- [#15 推荐高级 LLM](#15-推荐高级-llm)
- [#16 高级多 agent 架构](#16-高级多-agent-架构)
- [#17 核心模块抽离单独使用](#17-核心模块抽离单独使用)
- [#18 长任务完善](#18-长任务完善)
- [#19 LangGraph 能否替代](#19-langgraph-能否替代)
- [#20 记忆分类型分层管理](#20-记忆分类型分层管理)
- [#21 纯前端代码生成 agent](#21-纯前端代码生成-agent)

---

## #3 reliableWriteRules 支持自定义规则

**现状**：`presets.ts:53-60` 的 `systemPromptHelpers.reliableWriteRules` 是固定 5 条规则字符串。`ChatSdkOptions.appendReliableWriteRules`（默认 true）只控制是否追加到自定义 systemPrompt 末尾；无法往这 5 条里**插入业务规则**（如"只能写中文""只允许枚举值"）。要加规则只能整体覆盖 systemPrompt，丢失默认规则。

**设想**：新增 `extraWriteRules` 选项，与默认规则**拼接**而非替换。

```typescript
// ChatSdkOptions 新增
/** 追加到默认 reliableWriteRules 之后的自定义写入规则(字符串或字符串数组);与 appendReliableWriteRules 共同决定是否追加 */
extraWriteRules?: string | string[]
```

**拼接顺序**：`reliableWriteRules(默认5条) + '\n' + extraWriteRules(用户)` → 作为一段注入 systemPrompt。`appendReliableWriteRules:false` 时两者都不追加。

**同时导出 helper**：`systemPromptHelpers.buildWriteRules(extra?: string|string[])`，供手动构造 systemPrompt 的场景复用。

**落地评估**：改动极小（presets.ts 加拼接 + createChatSdk.ts 构造 finalSystemPrompt 时取 extraWriteRules）。**建议 2.11.0**。

---

## #5 动态刷新/重置 agent 配置

> ✅ **已完成(2026-07-30,归档)**:方案 B(细粒度 setter)已落地 → `sdk.setTools/addTool/removeTool`、`sdk.setLlm`、`sdk.setMemory`、`sdk.setSubagents/addSubagent/removeSubagent`。复用 `let + rebind + infoTick` 模式,全程零破坏(不调用 = 现状)。
>
> **仍缺失**:`setSystemPrompt` / `setMiddleware`(中间件数组运行时替换)—— 改动深入 harness 核心,留待后续;当前可用 `setData`/`setSkills`/`augmentSystem` 钩子覆盖大部分动态 system prompt 场景。
>
> 详见 `openspec/changes/archive/2026-07-30-add-dynamic-reconfiguration/`(proposal/design/tasks/specs 完整归档)。

---

## #6 上下文留存条数配置

**现状**：`maxMemoryRounds`（默认 50，`createChatSdk.ts:912`）控制内存裁剪（`trimMemoryMessages`，`createChatSdk.ts:1152`）；`0` 关闭裁剪。上下文压缩由 `summarization` 中间件负责（`capabilities.summarization`），阈值经 `contextOptions` / `contextPreset` 调。

**问题**：文档未突出 `maxMemoryRounds`，用户不知道 50 条可调；且 50 对轻交互偏大。

**建议**：
1. **文档强化**：options 表 + quickstart 加"上下文与内存"小节，明确 `maxMemoryRounds` / `contextPreset` / `capabilities.summarization` 三者关系。
2. **默认值下调**：50 → 30（轻交互足够，重任务用户自行调高）。
3. **新增 `contextOptions.maxRounds`**：让 `useContextManager` 的 `windowRounds` 与 `maxMemoryRounds` 统一口径（当前两套阈值容易混淆）。

**落地**：2.11.0，改动小。

---

## #7 对话框组件彻底分离

**现状**：
- `ui:false` headless 模式已有，sdk 返回 `messages` / `pendingConflict` / `usage` / `send` / `stream` / `hook` 等可自建 UI。
- `useChat` composable 已导出（`index.ts:67`），返回 11 个成员（state/messages/loading/error/pendingApproval/sendMessage/clearMessages/stop/retry/regenerate/resolveApproval）。
- **缺口**：
  1. `debugLogs` / `infoTick` 未在 sdk 返回对象顶层导出（自建 UI 拿不到调试日志和动态刷新 tick）。
  2. ChatDialog 的 25 个 props 没有等价的"headless props 包"导出，集成方需自己拼凑 `send`+`hook`+`inspect`。
  3. 无 render-prop / 插槽机制（Vue 生态）。

**设想**：三步走。

### 第一步：补齐 headless 状态导出（2.11.0）
```typescript
// ChatSdk 新增
debugLogs: Ref<DebugLog[]>
infoTick: Ref<number>
// 便捷:一次性拿到自建 UI 所需全部状态
getUIProps(): {
  messages: AgentMessage[]
  pendingConflict: Ref<PendingConflict | null>
  debugLogs: Ref<DebugLog[]>
  infoTick: Ref<number>
  usage: TokenUsage
  getInfo: () => AgentInfo
  send: (m: string) => Promise<string>
  stream: ...
  onResolveConflict: (a) => void
  onClear: () => void
  onPersist: () => Promise<void>
  // ...与 ChatDialog props 一一对应
}
```

### 第二步：render-prop 组件（2.12.0）
导出 `<HeadlessChatDialog v-slot="{ messages, send, loading, ... }">`，集成方在 slot 里自建 UI，状态/回调全由 SDK 提供。

### 第三步：完全替换对话框（3.0）
`createChatSdk({ ui: 'custom', renderDialog: (props) => VNode })`，集成方传 render 函数，SDK 把上述 `getUIProps()` 注入。

**落地**：第一步立即做（小改）；第二、三步按需求排期。

---

## #8 LLM 特殊传参透传

**现状**：`LLMConfig` 仅 7 字段（apiKey/baseUrl/model/temperature/maxTokens/contextWindow/maxOutputTokens）；`createAgent.ts:184-190` 构造 `ChatOpenAI` 只用 5 个 + `configuration.baseURL`。**无 extraBody/extraParams 透传**。要用 deepseek thinking 等参数，当前只能自己构造 `BaseChatModel` 实例传入 `options.llm`。

**设想**：新增透传字段。

```typescript
// LLMConfig 新增
/** 透传给 LLM provider 的额外参数(注入 ChatOpenAI 构造或 invoke 调用) */
extraBody?: Record<string, unknown>
/** 透传给 ChatOpenAI configuration 的字段(如 baseURL 之外的 headers/timeout) */
extraConfig?: Record<string, unknown>
```

**实现要点**：
- `createAgent.ts` 构造 `ChatOpenAI` 时把 `extraBody` 合入（langchain ChatOpenAI 支持 `modelKwargs`/`extraBody` 透传到底层 OpenAI client）。
- `extraConfig` 合入 `configuration`（如 `{ headers, timeout, fetch: customFetch }`）。
- 摘要 LLM（`buildSummaryLlmInvoke`）同样透传。

**示例**：
```typescript
createChatSdk({
  llm: {
    apiKey: 'sk-xx', model: 'deepseek-v4-pro',
    extraBody: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  },
})
```

**落地**：2.11.0，改动集中在 createAgent.ts 构造 + LLMConfig 类型。

---

## #9 普通 OpenAI 兼容接口代理

**现状**：`LLMConfig` 已兼容 OpenAI 协议（任意 OpenAI 兼容端点传 baseUrl 即可）。已有 `createProxyLlm`（`src/core/llm/proxyLlm.ts`）支持自定义 headers/refreshToken/fetch，是当前唯一的请求扩展通道。

**设想**：
1. **文档明确**：quickstart 加"自定义 OpenAI 兼容端点"章节（一行 baseUrl 配置 + proxyLlm 进阶）。
2. **新增 `llmAdapter` 选项**：用于非 OpenAI 格式端点的适配（如把内部 API 响应转成 OpenAI tool-calling 格式）。
   ```typescript
   llmAdapter?: (rawResponse: unknown) => OpenAIChatResponse
   ```
   内部在 `createProxyLlm` 基础上加转换层。
3. **测试代理**：提供 `scripts/llm-proxy-mock.ts`，模拟 OpenAI 格式返回，方便本地测 proxy 模式。

**落地**：2.11.0 文档；2.12.0 llmAdapter（如有真实需求）。

---

## #10 禁用上下文/缓存 + middleware 改上下文

**现状**：
- 关闭压缩：`capabilities.summarization:false`（整中间件不装）；`contextOptions:false` 实际被当 `{}` 处理（`contextPreset.ts:36`），**并不能关闭**——这是个 bug。
- 关闭内存裁剪：`maxMemoryRounds:0`。
- middleware 改 messages：`beforeModel` 只返回 StateUpdate，**不能替换 messages**；`wrapModelCall`（洋葱）可以改 `req.messages` 后 `next(req)`；`compressInput`（链式）能在本轮入口改消息。
- 完全无状态（上下文由接口方管理）：当前无明确开关，messages 仍会累积。

**设想**：

### 修复 contextOptions:false
`contextPreset.ts:36` 把 `false` 当 `{}` → 改为返回 `{ enabled: false }`，`useContextManager` 检测 `enabled:false` 跳过压缩。

### 新增"无状态模式"
```typescript
// ChatSdkOptions 新增
/** 无状态模式:不累积 messages 历史,每轮只发当前 user message + systemPrompt + 由接口方管理的上下文 */
stateless?: boolean
```
`stateless:true` 时：
- `send` 不 push 历史，每轮 `stream` 入口 messages 只含 `[system, user]`。
- 关闭 persistRuntime 的 messages 落盘（todos/vfs 仍落盘）。
- 配合 `middleware` 的 `wrapModelCall` 注入接口方提供的上下文。

### middleware 改持久化记录
明确文档：自定义 middleware 可在 `afterAgent` 钩子里读 `core.messages` 并调 `store.save` 改持久化记录；或经 `interceptors.input/output` 在 IO 入口改写。

**落地**：2.11.0 修 contextOptions bug + 文档；2.12.0 stateless 模式。

---

## #11 README 简化 + 增加 examples

**现状**：README.md ~540 行，信息密集但入门门槛高。examples/ 已有 11 个 demo（page/complex/nested/dynamic/mcp/multi-agent/planner/subagent/toolsets/human-confirm/animation）。

**建议**：
1. **README 三段式**：① 30 秒上手（CDN 5 行 + npm 5 行）② 3 个典型场景（低码页面 / 表单编辑 / headless 自建 UI）③ 配置项速查表 + 链接到 doc/。
2. **examples 补充**：加 `minimal-demo`（最简 data + 对话）、`headless-demo`（useChat 自建 UI）、`stateless-demo`（接口方管上下文）。
3. **每个 example 顶部加一句话说明**用途，降低浏览成本。

**落地**：2.11.0 文档迭代。

---

## #12 流程编排插件

**现状**：执行模式固定 ReAct（`createAgent.ts:339-506`），middleware 钩子不能改变"模型→工具→模型"节拍。plan-execute 靠 subagent 组合模拟（planner-demo：planner 子 → reflector 子 → 主落地）。无原生编排层。

**设想**：`AgentMode` 抽象 + 编排中间件。

### 轻量版（2.12.0）：编排中间件
```typescript
createOrchestratorMiddleware({
  mode: 'plan-execute' | 'pre-act' | 'react',
  planner?: SubagentConfig,    // plan-execute 的规划子 agent
  executor?: SubagentConfig,
})
```
- `plan-execute`：beforeAgent 阶段先调 planner 子 agent 出计划 → 注入 todos → 主 agent 按计划执行。
- `pre-act`：beforeModel 阶段先执行一批预定义工具（如 read 上下文）→ 结果塞 messages → 再调模型。
- 仍在 ReAct 循环内，靠中间件钩子 + 子 agent 组合实现，不改 createAgent 核心。

### 重量版（3.0）：createAgent 支持非 ReAct 循环
`createAgent({ mode: 'plan-execute' })` 原生支持独立 plan/execute 阶段。需重构 stream 循环。

**建议**：先做轻量版中间件（覆盖 70% 编排需求），3.0 再考虑原生多模式。

---

## #13 免费官网与反馈渠道

**建议**：
- **官网**：GitHub Pages 部署一个单页（vitepress 或纯 HTML），内容=README 精简版 + 在线 demo（IIFE 包 + 一个交互对话框）。
- **反馈渠道**：GitHub Issues 模板（bug/feature/question 三种）+ README 底部加"反馈"链接。
- **Discord/微信群**：按社区规模再定。

**落地**：独立 PR，不影响 SDK 版本。

---

## #14 其他执行模式抽象

与 #12 相关。设想：

```typescript
// 预设模式 SDK(薄封装 createChatSdk)
createPlanExecuteSdk(opts: { planner: SubagentConfig; executor: ChatSdkOptions })
createPreActSdk(opts: { preTools: StructuredToolInterface[]; ... })
```

**更灵活方案**：`createAgent` 支持 `mode` 字段 + 对应循环实现，`createChatSdk` 透传。3.0 架构。

**建议**：2.12.0 先出编排中间件（#12 轻量版），视采用率决定是否做原生模式。

---

## #15 推荐高级 LLM

**建议**：纯文档/示例。README + quickstart 默认示例用 `deepseek-v4-pro`（或当前最强推理模型），注明"复杂任务建议用高级模型"。examples 的 demo 默认 model 也改过来。

**落地**：随 #11 一起。

---

## #16 高级多 agent 架构

**现状**：subagent 是单向委派（主→子→主聚合），子间不通信，无图/事件拓扑。`multi-agent-demo` 是多独立实例 + UI 互斥切换，非协同。`shareContext:true` 是同 id 多对话框视图共享一个 AgentCore，不是多 agent 编排。

**设想**：分模式落地。

| 模式 | 复用现状 | 新增 |
|---|---|---|
| **Supervisor** | ✅ 预声明子 agent（`subagents:[]`）= supervisor 委派 | 文档示例 + supervisor 中间件（主自动路由） |
| **Network** | ⚠️ 多独立实例 + 共享 data | `sharedData` 选项 + 事件总线（实例间经 onEvent 互通） |
| **Event-driven** | ❌ 无事件总线 | `createEventBus()` + 事件路由中间件 |
| **Graph-based** | ❌ 无图状态机 | `createGraphAgent({ nodes, edges })` 新核心 |

**建议**：
- 2.12.0：Supervisor 模式文档 + 示例（零新增，复用现有）。
- 2.13.0：Network 模式（sharedData + 事件互通）。
- 3.0：Event/Graph（需新核心模块）。

---

## #17 核心模块抽离单独使用

**现状**：`createAgent` / `defineTool` / middleware 契约 / `createVfs` / `createSessionStore` / `fetchDocTools` / `selectBuiltinTools` 已从 `index.ts` 独立导出。集成方可不装 ChatDialog，只用 harness。

**建议**：
1. **文档**：新增"按需引入"章节，列出可单独用的模块 + 各自最小示例。
2. **subpath exports**：`package.json` 加 `"./harness"` / `"./storage"` / `"./tools"` 子路径，支持 tree-shaking 精细引入。
3. **独立 mini 包**（可选）：`@page-agent-sdk/harness`（只含 createAgent + middleware，不含 Vue/UI）。

**落地**：2.11.0 文档 + subpath；mini 包按需求。

---

## #18 长任务完善

**现状**：有 checkpoint（会话级回滚）+ summarization（上下文压缩）+ vfs（大结果外存）。缺：断点续跑（跨刷新恢复执行进度）、任务队列、长任务进度持久化。

**设想**：
1. **checkpoint 持久化**：当前 checkpoint 在内存（`createCheckpointManager`），刷新即丢。加 `checkpointStorage` 选项落盘。
2. **任务队列**：`sdk.enqueue(task)` + 持久化队列，刷新后恢复未完成任务。
3. **进度事件**：`onEvent('task_progress', { step, total, ... })`。
4. **断点续跑**：mount 时自动恢复中断的任务（结合 checkpoint + todos 持久化）。

**落地**：2.13.0+，较大工程。

---

## #19 LangGraph 能否替代

**结论**：部分能，但不建议整体替换。

| 维度 | LangGraph | 本项目 |
|---|---|---|
| ReAct + state | ✅ 原生 | ✅ 自研 |
| 多模式（plan/pre-act/graph） | ✅ 原生 | ❌ 固定 ReAct |
| 浏览器/IndexedDB | ❌ 服务端导向 | ✅ 原生 |
| UI/对话框/headless | ❌ 无 | ✅ 内置 |
| 中间件/拦截器/interceptors | ⚠️ 需自建 | ✅ 丰富 |
| 数据操作工具/schema/乐观锁 | ❌ 无 | ✅ 内置 |

**建议**：保持自研核心，**可选**在 3.0 把 createAgent 循环层抽成接口，允许底层换 LangGraph 实现（给需要 graph 编排的用户一条路）。日常不引入 LangGraph 依赖（体积 + 浏览器兼容性）。

---

## #20 记忆分类型分层管理

**现状**：messages 按 role（user/assistant/tool）区分，无"类型标签"或"是否压缩过"标记。summarization 压缩后生成 summary system 消息，但原始消息直接丢弃（不可恢复）。

**设想**：

### 消息类型标记
```typescript
interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: number
  // 新增
  kind?: 'user' | 'ai' | 'tool' | 'error' | 'summary' | 'context'
  compressed?: boolean  // 是否由压缩产生
  restorable?: boolean  // 是否可从 vfs/外部恢复原文
}
```

### 分层保留策略
```typescript
memoryPolicy?: {
  keep: ('user' | 'ai' | 'tool' | 'error' | 'summary')[]
  maxPerKind?: Partial<Record<Kind, number>>
  compressThreshold?: number
}
```
- 可指定"只保留最近 10 条 user + 5 条 ai + 全部 error"。
- `compressThreshold`：超过阈值的 kind 才压缩，其余原样保留。

### 压缩可恢复
压缩时把原文写入 vfs（或独立 store），summary 消息带 `restorable:true` + `vfsPath`，需要时经 middleware 恢复。

**落地**：2.13.0，中等工程（改 AgentMessage 类型 + summarization + trimMemoryMessages）。

---

## #21 纯前端代码生成 agent

**设想**：基于现有 dataOps + vfs + 自定义 systemPrompt + 预览，做一个"只生成 html+js+css 内联页面"的专项 agent。

**实现路径**：
1. **预设**：`presets.frontendCoder`（systemPrompt 教 LLM 只输出内联 HTML）。
2. **工具**：`write_file`（写 vfs）+ `read_file` + `preview`（返回当前 vfs 里的 index.html）。
3. **预览**：集成方用 iframe `srcdoc` 渲染 vfs 里的 HTML。
4. **示例**：`examples/frontend-coder-demo`。

**落地**：2.12.0（主要是预设 + 示例，复用现有能力）。

---

## 优先级总览

| 版本 | 内容 |
|---|---|
| **2.11.0** | #3 extraWriteRules · #5 reconfigure · #6 文档+默认值 · #7 headless 导出补齐 · #8 extraBody · #9 文档 · #10 修 contextOptions bug + 文档 · #11 README 精简 · #15 默认模型 · #17 subpath + 文档 |
| **2.12.0** | #7 render-prop · #9 llmAdapter · #10 stateless · #12 编排中间件 · #14 模式 SDK · #16 supervisor/network · #21 前端代码生成 agent |
| **2.13.0+** | #16 event/graph · #18 长任务 · #20 记忆分层 |
| **3.0** | #5 细粒度 setter · #12 原生多模式 · #14 createAgent mode · #19 可选 LangGraph 底层 |

每版本保持向后兼容（除标注"破坏性"的项），遵循 semver。
