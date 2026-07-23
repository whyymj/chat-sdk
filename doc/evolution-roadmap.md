# page-agent 进化设计规划书(Roadmap)

> 目标:在保留「网页内嵌 + window 安全操作」差异化优势的前提下,把 page-agent 从「页面操作助手」升级为「可对标成熟 agent(Claude Code 等)的通用 harness」。
>
> 本文给出 6 个进化方向的**原理(对标成熟方案)+ 设计规划(在本仓库架构上的落地路径)+ 难点 + 工作量**,作为逐项实施的依据。本文只做设计,不含完整实现代码。

---

## 目录

- [总览:优先级 / 依赖 / 工作量](#总览优先级--依赖--工作量)
- [1. 子 agent 与并行编排(P0)](#1-子-agent-与并行编排p0)
- [2. Plan mode 与交互问答(P1)](#2-plan-mode-与交互问答p1)
- [3. MCP client(P1)](#3-mcp-clientp1)
- [4. 任务系统增强(P2)](#4-任务系统增强p2)
- [5. Verify 自检中间件(P2)](#5-verify-自检中间件p2)
- [6. Prompt caching(P3)](#6-prompt-cachingp3)
- [分阶段实施建议](#分阶段实施建议)

---

## 总览:优先级 / 依赖 / 工作量

| # | 方向 | 优先级 | 工作量 | 依赖 | 核心收益 |
|---|---|---|---|---|---|
| 1 | 子 agent 与并行编排 | P0 | L | 无 | 分治/并行/隔离,架构级跃升 |
| 2 | Plan mode + 交互问答 | P1 | M | 无 | 高危操作审批 + 决策澄清 |
| 3 | MCP client | P1 | M | 无 | 标准化外接生态 |
| 4 | 任务系统增强 | P2 | S-M | 无 | 复杂规划(依赖/增量) |
| 5 | Verify 自检中间件 | P2 | S | ①(对抗验证) | 结果可信度 |
| 6 | Prompt caching | P3 | S | 无 | 长会话降本 |

**依赖关系**:⑤ 的「对抗式验证」需要 ①(子 agent);其余互相独立,可并行推进。

**架构契合点**:6 项**全部**可以「中间件 + 工具」形式注入,无需改 `createAgent` 的 ReAct 主循环结构(除 ① 需放开工具并行执行)。这正是当前中间件架构的设计红利。

---

## 1. 子 agent 与并行编排(P0)✅ 已实现

### 现状
`createAgent` 是**单 agent 单线程**:一个 ReAct 循环,工具串行执行(`for (const call of response.toolCalls)`),无委派、无并行。大任务全挤在主上下文里。

### 原理(对标)
Claude Code 的 `Agent` 工具:主 agent 调用 `spawn`,创建一个**独立 agent**(可有自己的角色/工具子集/隔离上下文),并行运行,只把**最终结论**返回主 agent(过程不污染主上下文)。用于:分治大任务、并行探索、专项审查(researcher/reviewer)、广度搜索。

### 设计规划

**新增工具**(用户工具或专门中间件贡献):
- `spawn_agent({ prompt, role?, tools?, model? })` → 同步返回子 agent 的最终文本结论。
- `spawn_agents({ tasks: [{ prompt, role? }, ...] })` → 并行 spawn 多个,聚合结果数组返回。

**子 agent 构造**(复用 `createAgent`):
- 共享:LLM 配置(apiKey/model 等)、`memory`(可选)、vfs(只读访问,经 `vfs_read`)。
- 隔离:独立 `messages`(不从主 agent 继承历史,只接收 `prompt`)、独立 `state`、简化中间件栈(默认**不带** todos/skills,避免无限递归)、独立 `maxToolRounds`(更小,如 6)。
- 工具子集:默认只给只读工具(`get_window_prop`/`vfs_read`/`fetch_document`)+ 用户指定;**不给 `spawn_agent`**(防递归)。
- 大结果:复用现有 offload 机制(子 agent 结果 > 阈值转 vfs,主 agent 拿引用)。

**与主 agent 的通信**(核心:工具语义,单向委派 + 过程隔离):
- **本质**:主 agent 视角下 `spawn_agent` 就是个普通工具 —— **主→子 = 工具参数**(`prompt`/`schema`/`tools`),**子→主 = 工具返回值**(最终结论 → `tool_result`),主 agent 在下一轮模型调用读到。与 Claude Code 的 `Agent` 工具一致(只回 final message,子 transcript 不进主上下文)。
- **结果形态**:① 纯文本(默认);② 结构化(`schema` 参数 → 子 agent 强制输出符合 schema 的对象,主 agent 拿可解析 JSON);③ 大结果经 offload 转 vfs,主 agent 拿「预览 + `vfs_read` 引用」(复用现成机制)。
- **过程隔离**:子 agent 的中间思考/工具调用/消息历史**不进入**主上下文,只有最终结论进入 —— 这是子 agent 的核心价值(省主上下文 token)。
- **共享只读(可选配置)**:`shareMemory` → 子 agent 读主的 memory(行为规范一致);`shareVfs`(默认)→ 子 agent 只读访问主 vfs(不能写,防互污染);messages/todos **永不继承**(隔离底线)。
- **❌ 反向通信不支持**:子 agent 不能反问主 agent(主此刻正 `await` 子的工具返回 → 死锁)。子遇不确定只能自行决断 / 结果标注「需确认」 / 查只读共享上下文。
- **多子并行不互通**:`spawn_agents([...])` 各自独立返回,子 agent 两两不直接通信,由主 agent 聚合。
- **进度展示(已实现)**:子 agent 的工具调用进度经 `subagent` 事件转发到主 UI(`ToolStep.children` 嵌套展示),**不进入主 LLM 上下文**(只进 UI);文本/思考不转发。

**并行执行改造**(`createAgent`):
- 当前工具循环串行。放开为:同一轮的多个 tool_call **并行 await**(已有 signal 支持,abort 仍有效)。
- 加并发上限(如 `maxParallelTools`,默认 4),防雪崩。

**落地点**:
- 新模块 `src/core/harness/subagent.ts`(spawn 实现 + 工具定义)。
- 改 `createAgent.ts`:工具并行执行(串行 for → `Promise.all` + 并发上限)。
- 中间件贡献工具:`createSubagentMiddleware({ llm, allowedTools })`。

### 难点
- **工具并行**:改动 `createAgent` 工具执行模型(目前串行,且 tool_result 按序 push);要保证并行结果仍按 tool_call_id 正确回填消息序列。
- **递归防护**:子 agent 默认不含 spawn 工具 + 深度计数(主=0,子=1,超阈值拒)。
- **成本**:子 agent 各自烧 token —— 需可配置(是否启用、并发上限、单子任务轮次上限)。
- **上下文边界**:子 agent 是否继承主 agent 的 todos/memory(默认不继承,保持隔离)。

### 工作量:L(改 harness 工具执行模型 + 新模块 + 中间件 + 递归/并发控制)

---

## 2. Plan mode 与交互问答(P1)

### 现状
Agent 拿到任务直接执行(写 window、调工具),**无审批闸**;LLM 想澄清只能输出文本,用户得自己读懂再回复,**无结构化问答**。

### 原理(对标)
- **Plan mode**:Claude Code 的 `EnterPlanMode`/`ExitPlanMode` —— agent 进入「只读探索」态,产出方案 → 用户审批 → 才切回执行态。
- **交互问答**:`AskUserQuestion` —— LLM 结构化提问(题 + 选项),UI 渲染成可点选卡片,阻塞循环等用户作答。

### 设计规划

**新增工具**:
- `exit_plan_mode({ plan: string })`:提交方案,触发审批 UI,阻塞等用户「批准/拒绝/修改」。
- `ask_user({ question, options: [{ label, description }][], multiSelect? })`:提问,触发问答 UI,阻塞等用户选择。

**核心机制 —— Agent 循环的 pause/resume**:
- 这是本项的关键。当前 `stream()` 是 `while` 跑到底。需引入「挂起信号」:工具返回特殊状态 → 中断循环 → 把控制权交还 UI → UI 收集用户输入 → 把输入作为新的 tool_result/消息注入 → 恢复循环。
- 实现路径:工具 handler 返回一个 `Pending` 对象(含 resume callback),`stream()` 检测到则 `await` 一个 Promise(由 UI 侧 resolve)。

**UI 状态机**(`ChatDialog.vue` 新增卡片组件):
- **Plan 审批卡**:渲染 `plan` 文本 + [批准] [拒绝] [修改] 按钮 → 批准则 resume(空 tool_result),拒绝则 resume(带反馈)。
- **问答卡**:渲染问题 + 选项 chips(支持 multiSelect)→ 用户点选 → resume(结构化答案)。
- 卡片挂起期间:发送按钮禁用(或显式「取消」)。

**权限模式选项**:`permissionMode: 'default' | 'plan' | 'auto'`
- `plan`:写工具(`set/edit/delete_window_prop`)经 permissions 中间件拦截 → 提示 LLM「需先 exit_plan_mode」。
- 复用现有 `permissions` 中间件,加模式感知。

**落地点**:
- `createAgent.ts`:stream 循环加 pause/resume 挂起处理。
- 新工具(经中间件或内置):`exit_plan_mode` / `ask_user`。
- `ChatDialog.vue`:PlanCard / QuestionCard 组件 + 挂起态 UI。
- `useChat.ts`:暴露 resume 通道。

### 难点
- **pause/resume 机制**:把同步跑完的循环改成可挂起/恢复,状态管理复杂(挂起期间用户刷新?持久化挂起态?)。
- **UI ↔ agent 循环同步**:Vue 响应式与 agent Promise 的桥接。
- **plan 与执行的衔接**:批准后如何让 agent 从「方案」无缝进入「执行」(方案作为新上下文)。

### 工作量:M(机制设计是难点,代码量中等)

---

## 3. MCP client(P1)

### 现状
外接能力只能靠 `defineTool`/`middleware`(代码级,集成时写死)。无运行时标准化协议,无法接外部工具生态。

### 原理(对标)
**MCP(Model Context Protocol)**:标准 C/S 协议。Agent 作为 **client** 连 **MCP server**,动态发现 server 暴露的 `tools` / `resources` / `prompts`,转换为本 agent 的工具。Transport:stdio(本地)/ SSE / WebSocket(远程)。

### 设计规划

**新增模块** `src/core/mcp/client.ts`:
- 基于 `@modelcontextprotocol/sdk`(或自实现轻量 client)。
- 支持 transport:**浏览器环境只支持 SSE/WebSocket**(stdio 需 Node,浏览器 SDK 用不了 —— 这是关键约束)。
- 生命周期:`connect()` → `listTools()` → `listResources()` → 监听变更 → `close()`。

**配置**:
```ts
createPageAgent({
  mcp: [
    { transport: 'sse', url: 'https://mcp.example.com/sse' },
    { transport: 'websocket', url: 'wss://...' },
  ],
})
```

**工具动态合并**:
- `mount()` 阶段:async 连所有 MCP server → `listTools()` → 每个 MCP tool 转成 LangChain `StructuredToolInterface`(name/schema 来自 MCP,handler 代理 `client.callTool`)→ 合并进 `allTools`。
- 工具就绪前 agent 可正常跑(工具延迟注册)或 mount 等待(可配)。

**落地点**:
- 新模块 `src/core/mcp/`(client + transport + 工具适配)。
- `createPageAgent`:加 `mcp` 选项,mount 时连 server 并注册工具。
- 类型:`mcp?: McpServerConfig[]`。

### 难点
- **浏览器约束**:仅远程 transport(stdio 不可用)—— 文档需明确,且依赖宿主页能访问 MCP server。
- **依赖体积**:`@modelcontextprotocol/sdk` 可能较大,影响 IIFE(1.4MB)→ 评估是否懒加载或自实现轻量版。
- **异步工具发现**:工具在 mount 后才就绪,LLM 首轮可能看不到 → 需等待策略或动态注入。
- **断线重连 / 错误隔离**:单个 MCP server 挂不能影响主 agent。

### 工作量:M(协议集成 + 体积/异步处理)

---

## 4. 任务系统增强(P2)

### 现状
`todos` 中间件:平铺清单,`write_todos` **整表替换**(每次重发全部项,含未变的),无依赖、无优先级;`renderTodos` 不折叠已完成项。

### 原理(对标)
Claude Code 的 Task 系统:任务有 `id/subject/status/blocks/blockedBy/owner`,支持 **DAG 依赖**、并行、状态机;更新多为增量。

### 设计规划

**Todo 模型扩展**(`state.ts`):
```ts
{ content, status, id?, priority?, dependsOn?: string[] }
```

**增量更新**(省 token,二选一或并存):
- 方案 A:`write_todos` 加 `op` 模式 —— `{ op: 'replace', todos }`(兼容现状)或 `{ op: 'patch', changes: [{ id, status? }] }`(增量)。
- 方案 B:新增 `update_todo({ id, status? })` 工具,单点改状态;`write_todos` 仍用于整体拆解。

**渲染增强**(`renderTodos`):
- 按依赖拓扑排序,标注 `[blocked by #2]`。
- **已完成项折叠**:默认只显示最近 N 条 completed 的摘要,节省 prompt token(可配 `collapseCompleted`)。

**落地点**:
- `harness/todos.ts`:Todo 模型 + 增量 op + 渲染折叠。
- `harness/state.ts`:Todo 类型扩展。
- 持久化兼容(旧数据无新字段,降级处理)。

### 难点
- **LLM 维护依赖的可靠性**:复杂 DAG 可能超出 LLM 稳定维护能力 → 默认轻量(优先级 + 简单依赖),不强求完整 DAG。
- **增量 vs 整表**:增量省 token 但 LLM 易出错(漏改状态);建议 `update_todo`(单点)+ `write_todos`(整体)并存。
- **向后兼容**:已有持久化 todos 无新字段。

### 工作量:S-M(模型扩展 + 渲染 + 增量工具)

---

## 5. Verify 自检中间件(P2)

### 现状
Agent 执行完直接返回,无内置「自检」机制。结果对不对全靠 LLM 自觉 + 用户肉眼看。

### 原理(对标)
Claude Code:执行后跑测试确认、`code-reviewer` 子 agent 审查、loop-until-dry(连续 K 轮无新发现才停)、**对抗式验证**(spawn skeptic agent 试图反驳)。

### 设计规划

**可选中间件模板** `createVerifyMiddleware({ check })`:
- `check(state, messages) => Promise<{ ok: boolean; issues?: string[] }>`:由集成方定义领域检查。
- 触发点:新增钩子或复用 `afterAgent` —— 执行完跑 `check`,不通过则把 `issues` 作为新 user 消息注入 → agent 自纠(限 N 轮)。

**page-agent 典型 check**(领域适配):
- 「写后读回验证」:check 内调 `get_window_prop` 读回被改属性,对比预期。
- 「schema 完整性」:校验 window 结构仍符合集成方不变量。

**对抗式验证**(依赖 ① 子 agent):
- spawn 一个「找茬」子 agent,给它结果 + 原始需求,让它挑错 → 有错则回灌主 agent。

**落地点**:
- 新中间件 `harness/verify.ts`(`createVerifyMiddleware`)。
- 可能需 `afterAgent` 之外的新钩子(或用 `wrapModelCall` 拦截 done)实现「自纠循环」。
- `createPageAgent({ middleware: [createVerifyMiddleware({ check })] })`。

### 难点
- **通用 check 难定义**:高度领域相关 → 中间件只提供框架,check 由集成方写。
- **循环终止**:自纠设上限(默认 2 轮),避免无限「改了又查、查了又改」。
- **触发点**:现有钩子(`afterAgent`)在 return 后,不便「回灌消息继续跑」→ 可能需扩展循环。

### 工作量:S(中间件模板;对抗验证部分依赖 ①)

---

## 6. Prompt caching(P3)

### 现状
每轮把完整 system prompt(base + 各中间件 augmentPrompt 段)+ 全历史发给模型,**无 cache 利用**。长会话/大 prompt 成本高。

### 原理(对标)
Anthropic/OpenAI 的 prompt cache:把**稳定前缀**(system + 早期消息)标为 cache breakpoint,重复请求命中 cache → 降本 + 加速。Claude Code 大量依赖此降本。

### 设计规划

**核心:稳定段与不稳定段分离**
- 当前 `buildSystemPrompt()` 每轮拼接 `[base systemPrompt, ...augmentPrompt 段]`。其中 **todos 段每轮变**(状态推进)→ 导致 system 整体变 → cache miss。
- 改造:把 system 拆成 **稳定段**(base + memory,不变)+ **变动段**(todos 等,每轮变)。只对稳定段加 cache breakpoint。

**provider 适配**(`createAgent.ts` 的 LLM 调用):
- Anthropic:system message 加 `cache_control: { type: 'ephemeral' }`。
- OpenAI:自动 cache(无需标记,靠前缀匹配)。
- DeepSeek:支持自动 prefix cache(确认)。
- 加 `enableCache` 选项 + provider 检测。

**落地点**:
- `createAgent.ts`:`buildSystemPrompt` 分段 + `coreModelCall` 注入 cache 标记。
- 配置:`cachePrefix?: boolean`(默认按 provider 自动)。

### 难点
- **provider 差异**:不同模型 cache 机制不同,需适配层。
- **system 每轮变化**:todos/skills 段变动会破坏 cache → 必须分段,只 cache 真正稳定的 base+memory。
- **效果依赖 provider**:DeepSeek/其他兼容端点是否真支持 cache prefix 需验证。

### 工作量:S(效果取决于底层 provider 支持)

---

## 分阶段实施建议

**阶段一(架构跃升,1 项)**:`#1 子 agent + 并行`
→ 完成后 agent 具备分治/并行/隔离能力,是后续对抗验证的基础。

**阶段二(体验与生态,2 项并行)**:`#2 Plan mode + 交互问答`、`#3 MCP client`
→ 一个补「人机协作」(审批/问答),一个补「外接生态」(标准化工具),互相独立。

**阶段三(质量与成本,3 项)**:`#4 任务系统增强`、`#5 Verify`(含对抗验证,依赖阶段一)、`#6 Prompt caching`
→ 提升规划深度、结果可信度、长会话成本。

**贯穿原则**:
- 所有方向以**中间件/工具**注入为主,保持 `createAgent` 主循环稳定(除 ① 的并行执行改造)。
- 每项落地后补 `selftest` 纯函数测试 + 更新本手册与 `CLAUDE.md`。
- 保持向后兼容:新选项默认关闭或与现状等价,不破坏现有集成。

---

> 本规划书是设计层蓝图。每项进入实施前,建议单独进 plan mode 细化(确认 API 形状、状态机、边界),再动手。
