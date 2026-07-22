# Design: refactor-to-page-agent-sdk

## 决策 1:自研而非引入 Deep Agents
规避 #292 的浏览器打包风险,避免引入 LangGraph/langchain 整包。自研版架构与 Deep Agents 对齐(ReAct + middleware + backend),未来可平滑切换到真 deepagents。仅依赖现有 `@langchain/openai` + `@langchain/core`。

## 决策 2:中间件契约(必须忠实复刻的控制流)
Deep Agents 不写循环,只配置 LangGraph `createAgent` 的中间件。自研用同样生命周期(对照 `libs/deepagents/src/agent.ts` + `langchainjs/todoListMiddleware.ts`):
```
beforeAgent → wrapModelCall(洋葱) → beforeModel → [LLM.invoke] → afterModel
   → (有 tool_calls) wrapToolCall(洋葱) → [execTool] → 回 wrapModelCall
   → (无 tool_calls) afterAgent → 结束
```
- before 类钩子**正序**执行,after 类**逆序**执行。
- 钩子可返回 state 更新或改控制流。
- 自研中间件接口:
```ts
interface Middleware {
  name: string
  tools?: StructuredToolInterface[]
  stateShape?: Record<string, unknown>
  beforeAgent?: (ctx) => Update | void | Promise<Update | void>
  wrapModelCall?: (req, next) => Promise<LLMResponse>
  beforeModel?: (req) => Update | void
  afterModel?: (res) => Update | void
  wrapToolCall?: (call, next) => Promise<ToolMessage>
  afterAgent?: (ctx) => Update | void
}
```
内置中间件运行顺序(对应 Deep Agents):`todos → skills → filesystem(vfs) → summarization(context) → patchToolCalls(配对修复) → memory → hitl(预留) → 用户 middleware`。本期**不含 subagent**。`MAX_TOOL_ROUNDS` 对应 recursionLimit,单层主 agent 保持 10。

## 决策 3:State schema
```ts
interface AgentState {
  messages: AgentMessage[]
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
  files: Record<string, { content: string; mimeType?: string; updatedAt: number }>
  skillsMetadata: { name: string; description: string }[]
  memory: string
  summarization?: { cutoffIndex: number; summary: string; evictedTo?: string }
}
```
单线程主 agent 用普通赋值即可(无需 Deep Agents 的合并 reducer,那是为并行子 agent 设计的)。

## 决策 4:Skills 渐进式披露(对照 `middleware/skills.ts`)
三层:① 启动只把每个 skill 的 `name + description`(frontmatter)注入 system prompt 索引;② 全文不预加载,LLM 调 `load_skill(name)` 按需拉取;③ skill 内引用的扩展资源再按需加载。**关键:索引永远在 prompt,全文只在工具被调时进当轮 context**,skill 多也不撑爆 prompt。skill 来自运行时 `skills` 参数(非真实 FS),state 记已加载名避免重复。

## 决策 5:Context 管理升级(复用 `useContextManager`,对照 `middleware/summarization.ts` + `fs.ts` 驱逐)
`useContextManager` 思路正确,做三处升级:
1. **触发单位由轮数改 token 估算**:浏览器无 tokenizer,用 `字符数 / 4` 估算(`NUM_CHARS_PER_TOKEN = 4`,Deep Agents 同款);阈值 `0.85 × maxInputTokens` 触发。
2. **大工具结果外存而非硬截断**:工具结果 > ~20000 token(~80KB)时写入 vfs(`/large_tool_results/<id>.txt`),ToolMessage 内容替换为"预览(头5行/尾5行)+ `vfs_read` 引用"。比现有 `TOOL_RESULT_MAX = 800` 硬截断信息损失小得多。
3. **cutoff-event 模式**:不删原始消息,记录 `{ cutoffIndex, summary }`,`wrapModelCall` 重构有效视图为 `[summaryMessage, ...messages.slice(cutoffIndex)]`(现有"useChat 全量保留 + 压缩副本传 LLM"已近似此模式)。

## 决策 6:Planning(对照 `langchainjs/todoListMiddleware.ts`)
`write_todos({ todos })` 工具**整表替换**(非增量 patch,实现简单 + LLM 易用);schema `z.object({ todos: z.array(z.object({ content, status: enum })) })`。每轮 `beforeModel` 把当前 todos 清单注入 prompt 让 LLM 自跟踪。规则:首个任务标 in_progress、完成即标 completed 不批量、保持至少一个 in_progress 直到全部完成。反滥用:检测并行 `write_todos` 直接拒绝。

## 决策 7:Permissions(对照 `permissions/enforce.ts`)
声明式规则 `{ operations: ('read' | 'write')[], scopes: string[], mode: 'allow' | 'deny' }`,scope 用 glob;**first-match-wins,默认 allow**;把 deny 规则放前面。每个 window/vfs 工具入口 `enforcePermission(rules, op, scope)`。本期默认不启用,保留 `permissions?: Rule[]` 口子。

## 决策 8:window 操作 —— 属性注册表 + schema 校验(无人工审批)
**模型**:不是任意 `window.xxx = yyy`,而是**属性注册表(Property Registry)**。集成方在 `createPageAgent` 声明可操作属性,每项 `{ path, description, schema }`。所有 window 读写**只经 tool 执行**,tool 是唯一边界,借此保证**范围**与**校验**(无人工弹框审批,但 tool 层强约束)。
- **范围控制**:`set_window_prop`/`delete_window_prop` 仅允许注册表内 path;未注册拒绝,并提示用 `list_window_props` 查可用属性。
- **JSON 格式校验**:读写值均为 JSON;`set_window_prop` 按属性的 `schema`(zod)校验 value,不合法返回结构化错误供 Agent 修正,不写入。
- **属性说明文档通过 tool**:`list_window_props()` 列出所有可操作属性(path + description);`describe_window_prop({ path })` 返回单项说明 + schema。Agent 据此发现"能改什么、什么格式"。
- **工具集**:`list_window_props` / `describe_window_prop` / `get_window_prop` / `set_window_prop` / `delete_window_prop`(可选 `get_window_raw` 只读探测任意路径,默认不开放)。
- **零桥接**:工具函数体 `window` = 宿主页面主 window(无 iframe/shadow),校验通过后直接 `window[path] = value`;路径支持点号嵌套;`get` 做安全序列化(循环引用/函数/DOM 节点摘要/截断)。
- **审计**:每次 set/delete 记日志(`DebugDrawer`)。
- **与"无审批"的关系**:无人工审批保持流畅,但范围被注册表锁定 + schema 校验,大幅优于任意 window;集成方通过声明收紧边界(如只暴露 `app.*` 命名空间)。

## 决策 9:GET 文档
`fetch_document({ url, as? })` 用 `fetch` GET,返回 text/markdown。**CORS 现实约束**:浏览器只能拿同源或服务端配 CORS 的资源,跨域被拦;跨域抓取需后端代理(本期不做,列为已知约束)。

## 决策 10:Streaming 事件映射(对照 `stream.ts` + `AgentRunStream`)
把现有 `debugLogs` 升级为 typed 事件,ReAct 各阶段映射:
```ts
type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; content: string }
  | { type: 'todo_update'; todos: Todo[] }
  | { type: 'skill_loaded'; name: string }
  | { type: 'values'; state: AgentState }
```
(无 `delegate`/`delegate_result` —— 本期不做子 agent。)

## 决策 11:框架无关 SDK(Vue 打包进)
`vite.config.ts` 把 `vue` 从 external 移除 → 打包进 SDK;`@langchain/openai`/`@langchain/core`/`zod` 保持 external + peerDep。对外只暴露 `createPageAgent`/`defineTool`/`defineSkill`,内部 `createApp(ChatDialog).mount(container)`。代价:SDK +~100KB,与宿主已有 Vue 是两份独立实例(功能不冲突)。

## 参照源码(自研时对照 Deep Agents)
| 自研模块 | Deep Agents 源文件 |
|---|---|
| 中间件契约/组装 | `libs/deepagents/src/agent.ts`(`createDeepAgent`、中间件数组) |
| todos | `langchainjs/libs/langchain/src/agents/middleware/todoListMiddleware.ts` |
| skills | `libs/deepagents/src/middleware/skills.ts` + `skills/loader.ts` |
| vfs + 大结果驱逐 | `libs/deepagents/src/middleware/fs.ts` + `backends/{state,protocol}.ts` |
| context 压缩 | `libs/deepagents/src/middleware/summarization.ts` |
| permissions | `libs/deepagents/src/permissions/{types,enforce}.ts` |
| streaming | `libs/deepagents/src/stream.ts`(类型 overlay) |

## 风险与权衡
- **自研工作量**:middleware 齐备 + harness 重构是主要工作量;子 agent 延后降低复杂度。
- **GET CORS**:跨域需后端代理(本期不做)。
- **Vue 打包进 SDK**:体积 +~100KB,与宿主 Vue 双实例(功能不冲突)。
- **SDK 命名**:暂用 `page-agent`,实现时确认。
- **conversationIndex 去留**:Phase 5 定夺。
