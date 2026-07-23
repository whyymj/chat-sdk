# page-agent 架构与文件全览(Review 版)

> 本文与 [`architecture.md`](./architecture.md) 互补:后者偏运行控制流(ReAct + 中间件、window 操作安全流);本文偏**文件级职责清单、模块依赖关系、以及人工 review 关注点**。
> 最后更新:2026-07-23

## 一、定位与技术栈

**框架无关的页面内 Agent JS SDK**:以对话框形态挂载到任意网页,内置一个基于 **ReAct + 可插拔中间件** 的 Tool-Calling Agent,通过自定义 tool 直接读写宿主 `window` 对象上的属性(属性注册表 + schema 校验),具备 planning / skills / 虚拟工作区 / 快照回退 / context 压缩 / 持久化能力。

| 维度 | 选型 | 备注 |
|---|---|---|
| 框架 | Vue 3.5 | **打包进 SDK**(对外框架无关,非 peer) |
| 构建 | Vite 8(库模式) | 双配置:`vite.config.ts`(ESM/UMD,peer 外置)+ `vite.iife.config.ts`(IIFE 全量) |
| AI | `@langchain/openai` + `@langchain/core` | 浏览器子包,**不引** langchain 整包 / LangGraph(规避 `deepagentsjs#292`) |
| 校验 | zod 4 | windowProps schema、工具参数 |
| Markdown | `marked` + `highlight.js` | **打包进库** |
| 持久化 | 原生 IndexedDB / WebStorage / Memory | **零依赖**,可注入后端 |

**三种产物**:`dist/page-agent.js`(ESM)、`dist/page-agent.umd.cjs`(UMD)、`dist/page-agent.iife.js`(IIFE 全量 ~1.4MB,供 CDN `<script>`)、`dist/page-agent.css`。`types/index.d.ts` 手动维护(构建不自动生成)。

---

## 二、分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  集成层 / Demo                                               │
│  examples/page-demo/*  ·  demo/plain.html(CDN)              │
└───────────────────────────┬─────────────────────────────────┘
                            │ createPageAgent(options).mount()
┌───────────────────────────▼─────────────────────────────────┐
│  SDK 命令式入口  sdk/createPageAgent.ts                      │
│  总装:harness + 中间件 + 工具 + 后端 + UI + 持久化            │
│  共享响应式 messages · resolveStorage · 异步 mount 恢复       │
└───┬───────────────┬───────────────┬──────────────┬──────────┘
    │               │               │              │
┌───▼──────┐  ┌─────▼──────┐  ┌─────▼─────┐  ┌─────▼──────────┐
│ UI 层    │  │  harness   │  │  tools    │  │   backends     │
│ ChatDialog│ │ createAgent│  │ windowOps │  │ vfs (工作区)    │
│ useChat   │ │ (ReAct循环) │  │ fetchDoc  │  │ storage (持久化)│
│ ...       │ │ middleware │  │           │  │                │
└──────────┘  └─────┬──────┘  └───────────┘  └────────────────┘
                    │ 中间件栈(顺序:todos→skills→vfs→summarization→memory→permissions)
┌───────────────────▼───────────────────────────────────────┐
│  harness/middleware.ts  契约 + 执行器                       │
│  before 正序 · after 逆序 · wrap 洋葱(reduceRight)         │
│  8 钩子: beforeAgent/beforeModel/wrapModelCall/afterModel/ │
│         wrapToolCall/afterAgent + augmentPrompt/compressInput│
└───────────────────────────────────────────────────────────┘
                    │
┌───────────────────▼───────────────────────────────────────┐
│  底层支撑  state · types · utils(offload/rounds/id)        │
│  composables(useContextManager/useMarkdown)                │
└───────────────────────────────────────────────────────────┘
```

---

## 三、目录树(带职责)

```
src/core/                         # 通用 SDK 核心(框架无关,可整体迁移)
├── index.ts                      # 库唯一入口:聚合导出
├── types/index.ts                # 通用类型:AgentMessage / StreamEvent / ...
├── harness/                      # ★ 自研 agent harness(对齐 Deep Agents)
│   ├── createAgent.ts            #   ReAct 循环 + 中间件驱动核心
│   ├── middleware.ts             #   Middleware 契约 + 执行器
│   ├── state.ts                  #   HarnessState schema + createInitialState
│   ├── todos.ts                  #   planning 中间件(write_todos)
│   ├── skills.ts                 #   渐进式披露中间件(load_skill)
│   ├── memory.ts                 #   AGENTS.md 风格持久指令中间件
│   ├── permissions.ts            #   scope 白名单中间件(可选)
│   ├── summarization.ts          #   context 压缩中间件(复用 useContextManager)
├── sdk/                          # 命令式入口 + 工具 helper
│   ├── createPageAgent.ts        #   ★ 总装(改动最大、最核心的文件)
│   └── defineTool.ts             #   声明式自定义工具 helper
├── tools/                        # 内置工具
│   ├── windowOps.ts              #   ★ window 操作(10 工具:注册表+校验+增量编辑+快照)
│   └── fetchDoc.ts               #   GET 抓文档(同源/CORS 限制)
├── backends/                     # 存储后端
│   ├── vfs.ts                    #   内存虚拟工作区(6 工具 + Proxy 持久化捕获)
│   └── storage.ts                #   ★ 持久化(IDB/WebStorage/Memory + 配额 + LRU)
├── composables/                  # Vue 组合式逻辑
│   ├── useChat.ts                #   对话状态 + 流式/非流式发送 + 持久化钩子
│   ├── useContextManager.ts      #   上下文压缩(窗口+摘要+召回+工具结果裁剪)
│   └── useMarkdown.ts            #   marked + highlight.js 渲染
├── components/                   # 通用 UI(打包进库)
│   ├── ChatDialog.vue            #   对话框主壳
│   ├── MessageContent.vue        #   markdown 渲染 + 代码块增强
│   ├── CodePreview.vue           #   代码沙箱预览(iframe srcdoc)
│   └── DebugDrawer.vue           #   调试日志抽屉
├── utils/                        # 纯工具
│   ├── offload.ts                #   大结果外存 vfs(唯一收口于 createAgent)
│   ├── rounds.ts                 #   对话轮次分组(压缩器复用)
│   └── id.ts                     #   makeId(crypto.randomUUID 降级)
└── __tests__/selftest.ts         # 自测(无 LLM,tsx 直跑)
examples/page-demo/               # 定制 demo(开发自举)
demo/plain.html                   # 框架无关集成示例(importmap/CDN)
```

---

## 四、逐文件功能与依赖

### harness/(ReAct 引擎 + 中间件)

| 文件 | 职责(做什么) | 依赖(imports) | 被谁用 |
|---|---|---|---|
| **createAgent.ts** | ReAct 循环:`beforeAgent → while{ beforeModel→wrapModelCall→afterModel→(有 tool_calls 则)wrapToolCall } → afterAgent`。组装 system prompt(各中间件 augmentPrompt)、转 LangChain 消息、流式聚合 chunk、工具结果统一经 offload 外存。返回 `{invoke, stream, getState, allTools, debugLogs}` | vue(shallowRef)、`@langchain/openai`、`@langchain/core/messages`、`@langchain/core/tools`、`types`、`utils/offload`、`./state`、`./middleware` | `sdk/createPageAgent` |
| **middleware.ts** | `Middleware` 接口(8 钩子 + tools/augmentPrompt/compressInput);执行器:`runBeforeAgent/runBeforeModel`(正序)、`runAfterModel/runAfterAgent`(逆序)、`composeModelCall/composeToolCall`(洋葱 reduceRight);`applyUpdate` last-writer 合并 | `@langchain/core/messages`、`@langchain/core/tools`、`./state`、`../types` | `createAgent` |
| **state.ts** | `HarnessState`(messages/todos/files/skillsMetadata/skillsLoaded/memory/summarization)及子类型(Todo/VfsFile/SkillMeta/SummarizationEvent);`createInitialState` | `../types` | 所有 harness 文件 + createAgent |
| **todos.ts** | planning:`write_todos`(整表替换)+ augmentPrompt 注入清单 + wrapToolCall 拒一轮内并行多次;支持 `reset`(持久化恢复注入) | `@langchain/core/tools`、zod、`./middleware`、`./state` | createPageAgent |
| **skills.ts** | 渐进式披露:`load_skill` 按需加载全文 + augmentPrompt 注入索引 + afterModel 同步 skillsLoaded;`defineSkill` | `@langchain/core/tools`、zod、`./middleware` | createPageAgent、index.ts |
| **memory.ts** | AGENTS.md 风格指令:beforeAgent 注入 state + augmentPrompt 渲染;`reset` | `./middleware` | createPageAgent |
| **permissions.ts** | scope 白名单(first-match-wins,默认 allow):wrapToolCall 拦 window/vfs 工具的 path;glob 匹配 | `./middleware` | createPageAgent(可选) |
| **summarization.ts** | context 压缩:经 `compressInput` 钩子复用 `useContextManager.compress` | `../types`、`../composables/useContextManager`、`./middleware` | createPageAgent |

### sdk/(入口)

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **createPageAgent.ts** | ★ 总装:核心上下文抽成 `AgentCore`(`buildCore` 构造 store/messages/vfsStore/todosMw/memoryMw/agent/sessionId/initDone + send/switchSession/stream/afterRound/release);`shareContext:true` 时同 id 经 `sharedCores` 注册表 + 引用计数复用(同页多对话框=同一 agent);`mount`/`unmount` 各自渲染;解析 `agentId`/`storage`/`session`/`streaming`;vfs 持久化 wiring;`switchSession`/flush 兜底 | vue、`@langchain/core/tools`、`components/ChatDialog`、`harness/*`、`backends/vfs`+`storage`、`tools/windowOps`+`fetchDoc`、`utils/id`+`rounds`、`types` | 集成方 / demo |
| **defineTool.ts** | 包装 `@langchain/core/tools` 的 `tool()`,对象式声明(`name/description/schema/handler`),返回 `StructuredToolInterface`;非 string 返回 JSON.stringify | `@langchain/core/tools`、zod | 集成方、index.ts |

### tools/(内置工具)

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **windowOps.ts** | ★ 10 工具:`list/describe/get/get_paths/set/edit/delete_window_prop` + `snapshot/list/restore_window_snapshot`。属性注册表(范围控制)+ schema 校验(副本校验、不合法不写)+ 增量 edit(set/remove/merge/append)+ per-path 快照栈(默认 20,FIFO)+ 就地写回(不替换 reactive 根引用)+ 安全序列化(函数/DOM/循环引用摘要)+ 审计回调 | `@langchain/core/tools`、zod | createPageAgent |
| **fetchDoc.ts** | `fetch_document`:GET 抓文档,同源/CORS 限制,超 2 万字截断 | `@langchain/core/tools`、zod | createPageAgent |

### backends/(存储后端)

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **vfs.ts** | 内存虚拟工作区:6 工具(read/write/edit/ls/glob/grep)+ 中间件(beforeAgent 注入 `store.files` 共享引用)。`createVfs` 可选 `persist` → Proxy 捕获 set/deleteProperty → 800ms debounce save;暴露 `hydrate/flush/clear`。`Object.create(null)` 防原型污染 | `@langchain/core/tools`、zod、`./middleware`、`./state` | createPageAgent、selftest |
| **storage.ts** | ★ 持久化:可注入后端(`IdbBackend`/`WebStorageBackend`/`MemoryBackend`)+ `SessionStore` 编排(key 编码 `v:1::{db}::{agentId}::{sid}::{kind}` / 字节估算 / 500ms debounce / per-session 串行 commit 防丢失更新 / 单会话 10MB 软上限 / 全局 50MB + 整会话 LRU 淘汰到 0.9 水位 / 降级内存永不冒泡)。纯函数 `encodeKey/estimateBytes/selectForEviction` 可单测 | `../types`、`./state`、`../utils/id` | createPageAgent、selftest、index.ts |

### composables/(组合式逻辑)

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **useChat.ts** | 对话状态(messages/loading/error)+ 发送(流式优先,占位 assistant 增量更新);入参 `messages/onPersist/onClear` 供持久化集成;`clearMessages` 用 `splice(0)` 保持共享引用 | vue、`../types` | ChatDialog |
| **useContextManager.ts** | 跨轮压缩:窗口(最近 N 轮)+ 摘要(零成本索引或可选 LLM)+ 关键词召回(中文分词/停用词);另导出 `trimToolResults`(单轮内 ToolMessage 裁剪,**见 review 点**) | `../types`、`@langchain/core/messages`、`../utils/rounds` | summarization 中间件 |
| **useMarkdown.ts** | marked + highlight.js;自定义 `renderer.code` 输出带 `data-lang/data-code` 的 `pre`;提取 CodeBlock | vue、`marked`、`highlight.js` | MessageContent |

### components/(UI)

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **ChatDialog.vue** | 对话框主壳:消息列表(头像/气泡/思考过程折叠/工具步骤)、流式光标、日志按钮、清空、折叠;透传 `initialMessages/onPersist/onClear` 给 useChat | vue、`useChat`、`MessageContent`、`DebugDrawer`、`types`、`createAgent(DebugLog)` | createPageAgent(经 h 渲染) |
| **MessageContent.vue** | markdown 渲染 + 代码块 DOM 增强(复制/下载/运行预览按钮);Teleport 弹 CodePreview | vue、`useMarkdown`、`CodePreview` | ChatDialog |
| **CodePreview.vue** | 代码沙箱预览:iframe `srcdoc`(sandbox allow-scripts);支持 html/js/css/简易 Vue SFC;预览/源码切换 | vue | MessageContent |
| **DebugDrawer.vue** | 调试日志抽屉:按类型筛选(context/llm_request/llm_response/tool_call/tool_result/error/middleware)、卡片+原始 JSON 视图 | vue、`createAgent(DebugLog)` | ChatDialog |

### utils/ + types/ + 入口 + 自测

| 文件 | 职责 | 依赖 | 被谁用 |
|---|---|---|---|
| **offload.ts** | 大结果外存:>6000 字符且 vfs 可用 → 写 vfs 留预览+`vfs_read` 引用;否则硬截断。**唯一收口于 createAgent 的 coreExecTool** | `./state(VfsFile)` | createAgent |
| **rounds.ts** | `groupRounds`(按 user 消息切轮)+ `plainSummary`(去 md 符号)+ `roundToolNames` | `../types` | useContextManager |
| **id.ts** | `makeId`:crypto.randomUUID 降级时间+随机 | — | createPageAgent、storage |
| **types/index.ts** | 通用类型:ToolStep/AgentMessage/AgentState/StreamEvent/StreamHandler/ChatDialogProps | — | 全局 |
| **index.ts** | 库唯一入口:导出 createPageAgent/createAgent/defineTool/defineSkill/createVfs/createSessionStore/createMemoryBackend/createWebStorageBackend + `z` + 各类型 | 聚合各模块 | 外部消费者 |
| **__tests__/selftest.ts** | tsx 直跑自测:windowOps/edit+快照/offload/vfs/todos/skills/permissions/memory/middleware 执行器/storage(隔离/save-load/配额/LRU/降级/并发) | 核心各模块 | `npm test` |

---

## 五、核心依赖关系(import 图)

```
createPageAgent ──┬─► createAgent ──┬─► middleware(执行器)
                  │                 ├─► state
                  │                 ├─► offload
                  │                 └─► @langchain/openai + core
                  ├─► todos / skills / memory / permissions (中间件)
                  ├─► summarization ─► useContextManager ─► rounds
                  ├─► vfs(中间件 + 6 工具)
                  ├─► windowOps(10 工具) · fetchDoc(1 工具)
                  ├─► storage ─► id
                  ├─► ChatDialog ─┬─► useChat
                  │               ├─► MessageContent ─► useMarkdown + CodePreview
                  │               └─► DebugDrawer
                  └─► id
```

**关键边界**:harness 层(`createAgent`+`middleware`+`state`)**完全不感知** window / vfs / 持久化 —— 这些都以「中间件 + 工具」注入。这是架构可复用的核心。

**内置工具合计 19 个**:windowOps(10)+ fetchDoc(1)+ vfs(6)+ todos 的 write_todos(1)+ skills 的 load_skill(1)。其中 write_todos/load_skill 由各自中间件经 `tools` 字段贡献,最终都汇入 `allTools` 并经 `llm.bindTools()`。

---

## 六、一次请求的完整数据流

```
用户输入 → useChat.sendMessage
  → state.messages.push(user)
  → fetchStream = agent.stream(messages, onEvent)
      ┌─ createAgent.stream ────────────────────────────────┐
      │ 1. runBeforeAgent(正序):todos/skills/memory 初始化   │
      │ 2. compressInput 链(summarization):压缩跨轮历史      │
      │ 3. toLC → 注入 systemPrompt(base + 各 augmentPrompt) │
      │ 4. ReAct 循环(≤ maxToolRounds,默认 10):            │
      │    a. runBeforeModel → replaceSystem(重渲染 prompt)   │
      │    b. composeModelCall(洋葱) → coreModelCall 流式     │
      │       └ emit text/reasoning                          │
      │    c. runAfterModel(逆序)                            │
      │    d. 无 tool_calls → emit done → runAfterAgent → 结束│
      │    e. 有 tool_calls → 逐个 composeToolCall(洋葱):    │
      │       permissions 校验 → coreExecTool                │
      │         └ offloadLargeResult(>6000 → vfs 外存)       │
      │       → ToolMessage(snake_case tool_call_id)         │
      │ 5. 超 maxRounds → fallback 文本                      │
      └──────────────────────────────────────────────────────┘
  → onPersist 回调 → store.save(messages + todos)
  → vfs 变更经 Proxy → debounce → store.save(vfs)
```

---

## 七、todos(planning)工作流程专题

> todos 是 harness 的 **planning 中间件**(`harness/todos.ts`),给 LLM 一个自跟踪任务清单。**不在 UI 展示**(grep `ChatDialog`/`useChat` 无命中),仅作为 system prompt 段喂给模型,用于多步任务的"拆解→推进→勾选"。本节梳理其数据存放、跨会话生命周期与典型调用样例。

### 7.1 三处存放与数据流

todos 运行期有**三个位置**,职责分离:

```
┌───────────────────────────────────────────────────────────────┐
│ todosMw 闭包 let todos   ← 真源(core 级单例,跨 send 持续)    │
│       ▲                         │                              │
│       │ reset(snap.todos)       │ beforeAgent/beforeModel 同步  │
│       │ (持久化恢复 / 切会话)    ▼                              │
│  storage kind todos       agent.state.todos(镜像)             │
│       ▲                    ▲                                   │
│       │ load                │ afterRound → getState().todos    │
│       └──────── store.save({todos}) ───────────────────────────┘
```

**关键不变量**:todosMw 是 `buildCore` 里 `createTodosMiddleware()` 只构造一次的 **core 级单例**;而 `createAgent.stream()` 每次 `state = createInitialState()` 重置 state(`createAgent.ts:208`)。叠加效果 = **state 每轮重置,但闭包 todos 跨轮/跨 send 持续**,下一轮 `beforeModel`(`todos.ts:60`)再把闭包值同步进 state。

### 7.2 跨会话生命周期时序

```
createPageAgent → buildCore:
  todosMw = createTodosMiddleware()                 [闭包 todos = []]
  initDone = resolveAndLoad():
    await store.ready → 解析 sessionId(id / autoResume 最近 / 新建)
    snap = store.load(agentId, sid) → applySnapshot:
      if snap.todos?.length → todosMw.reset(snap.todos)      ★ 恢复 hydrate
    core.agent = createAgent({ middleware: [todosMw, ...] })

send(msg):  messages.push(user) → agent.invoke → messages.push(assistant) → afterRound:
  ├─ agent.invoke 内部 stream():
  │    state = createInitialState() ← todos 先清空
  │    runBeforeAgent → todos.beforeAgent 注入 {todos}          (闭包→state)
  │    每轮 beforeModel → state.todos = 闭包值;replaceSystem 重渲染清单
  │    有 tool_calls → composeToolCall → todos.wrapToolCall 拦 write_todos:
  │       第1次放行 → 工具体 闭包 todos = input  ★ 真源被改
  │       第2次起 → 返回 error(整表替换语义,禁一轮内并行)
  │    无 tool_calls → done
  └─ persistRuntime():                                       ★ 落盘
       store.save({messages})
       todos = agent.getState().todos                        (读镜像,总在 done 前同步过)
       store.save({todos})                                   (含空数组覆写,见 7.4-1)

switchSession(sid?):  store 未开启 → throw;flush 当前 → 清内存态(替换语义,非叠加):
  messages.splice(0,len) · vfsStore.clear() · todosMw.reset([])   ★ todos 清空
  → applySnapshot(目标 snap) → todosMw.reset(snap.todos)

UI「清空」(onClear):sessionId=makeId() · vfsStore.clear() · todosMw.reset([]) · createSession

pagehide / visibilitychange(hidden):vfsStore.flush() + store.flush()
  (todos 自身不在 flush 主动 save,只把 afterRound 已入 debounce 窗口的写落盘)

配额/淘汰/降级:todos 作为 snap kind 之一 → commit 经单会话软上限 + meta 累计;
  整会话 LRU clearPrefix 删该会话全部 kind(含 todos);QuotaExceeded → 淘汰 → 降级内存(todos 不丢)
```

### 7.3 write_todos 典型对话样例

场景:宿主 `window.page` 为 Vue reactive,用户"把三个商品卡片价格加'起'字,主标题改为'今日精选'"。`write_todos` 为**整表替换**,每轮传完整数组:

| 轮次 | LLM 动作 | `write_todos` 入参(摘要) | system 清单下一轮渲染 |
|---|---|---|---|
| R0 拆解 | `get_window_paths` 探结构后拆解 | `[in_progress:卡片1, pending:卡片2, pending:卡片3, pending:主标题]` | 1 项 in_progress,3 项 pending |
| R1 推进 | `edit_window_prop` 改卡片1 | `[completed:卡片1, in_progress:卡片2, pending:卡片3, pending:主标题]` | 卡片1 勾选,卡片2 接力 |
| R2 收尾中段 | 改卡片2、3 | `[completed×3, in_progress:主标题]` | 仅主标题在途 |
| R3 完成 | `set_window_prop` 改标题后更新清单 | `[completed×4]` → 随后无 tool_calls 输出最终文本 → done | 全勾选 |

要点:① 哪怕只改一项状态也要**重传整表**;② "保持至少一个 in_progress 直到全部完成"(`todos.ts:24` 规则);③ 一轮内第 2 次 `write_todos` 被 `wrapToolCall` 拦截(`todos.ts:65-76`)。

### 7.4 行为细节与修复点

1. **落盘恒同步(本次修复)**:`persistRuntime`(`createPageAgent.ts:327`)原仅 `if (todos?.length)` 才 save,导致会话内 todos 由有变空(`write_todos([])`)后 storage 残留旧清单、刷新恢复出遗留已完成项。**已改为始终 `store.save({todos})`**(含空数组覆写);代价是未用过 todos 的会话多写一条空记录(可忽略)。
2. **`getState().todos` 可靠**:`write_todos` 必在 done 前某轮触发,之后至少一次 `beforeModel` 同步,故 afterRound 读到的镜像恒等于闭包最新值。
3. **刷新兜底依赖 afterRound**:`flush()` 不主动 save todos,仅落盘 debounce 窗口(debounceMs=500)内已入队的写;只要最后一轮 afterRound 跑过即不丢。

---

## 八、内存与存储配额(各层达上限的淘汰机制)

| 层 | 上限(默认) | 达上限淘汰机制 | 可配 |
|---|---|---|---|
| **vfs 工作区**(内存) | 4MB | 按 `updatedAt` 最旧 **LRU 删文件**到 0.9 水位(纯内存也生效) | `options.vfs.maxBytes` |
| **对话历史 messages**(内存) | 50 轮 | 最旧轮次**压缩为摘要 system 消息**(`trimMemoryMessages`) | `options.maxMemoryRounds`(0 关闭) |
| **单会话持久化** | 10MB | 软上限,超限**拒写该 kind** + `quota` 事件(保留旧值) | `StorageConfig.maxBytesPerSession` |
| **全局持久化** | indexed/memory 50MB;local/session 4MB | **整会话 LRU 淘汰**(`lastAccessed` 最旧)到 0.9 水位 | `StorageConfig.maxBytes` |
| **浏览器真实配额**(运行时) | 浏览器决定 | `QuotaExceededError`(`isQuotaError`)→ 先淘汰最旧会话 → 仍失败**降级内存重写** + `degraded` | 自动 |

> 关键:`isQuotaError` + `commit` catch 降级,保证「各存储方式达上限都有淘汰/降级,数据不丢、不崩溃」。

---

## 九、Review 时值得关注的点(实读代码发现)

以下是基于通读发现的几处**值得人工确认**的点(非一定为 bug,但注释/实现/字段需对齐):

1. **`trimToolResults` 已实现未接线** — `useContextManager.ts` 导出并在返回值里暴露 `trimToolResults`,且 `summarization.ts:9-11` 注释声称"单轮 ReAct 内的工具结果裁剪仍由 createAgent 侧处理",但 `createAgent.ts` 全文**未调用**它。当前单轮内累积的 `ToolMessage` 仅靠 `offloadLargeResult`(工具结果外存)控制体积,无数量级裁剪。**需确认**:接线 / 删死代码 / 修注释三选一。

2. **DebugDrawer 上下文卡片字段不匹配** — `createAgent.ts:224` 的 `log('context', { model, tools, middleware })` 只传了 3 个字段;而 `DebugDrawer.vue:131-135` 的 context 卡片读取 `log.data.temperature / maxTokens / totalMessages`。→ 这几项在 UI 显示为 `undefined`。**需对齐**(补传字段或删 UI 显示)。

3. **`trimToolResults` 的 `tool_call_id` 兜底** — `useContextManager.ts:236` 用 `(m as any).tool_call_id || (m as any).lc_id || 'trimmed'`。`lc_id` 并非 `tool_call_id`,若该函数一旦接线,可能触发 CLAUDE.md 记录的 `400 missing field tool_call_id` 坑。当前因未接线而无害,但接线前需修。

4. **`fetch_document` 同源/CORS 限制** — 跨域抓取需后端代理(已注释说明,设计约束)。集成方若期望抓取任意 URL 需自知。

5. **CodePreview 的 Vue SFC 预览**用 `new Function(...)` 执行 AI 生成代码(`CodePreview.vue:62`),iframe 有 `sandbox="allow-scripts"`(无 allow-same-origin,隔离尚可)。属 demo 能力,生产集成时若暴露给不可信内容需评估。

6. **默认 `maxTokens=8192`** — CLAUDE.md 提示"操作大 JSON 需大输出窗口",默认值偏小,大对象 `set_window_prop` 可能被截断;集成方需按需调高(`VITE_AI_MAX_TOKENS`)。

7. **持久化 `memory` 只落盘集成方 `options.memory`** — Agent 无运行期写 memory 的工具(设计如此,为未来预留),加载时 `options.memory` 优先于持久化值。

---

## 十、维护提示

- todos 工作流程(三处存放 / 跨会话生命周期 / write_todos 样例)见**第七节专题**;改 `todos.ts` 或 `persistRuntime` 的 todos 落盘逻辑后请同步该节。

- 本文件为**人工 review 辅助**,会随代码演进过时。改动文件职责/依赖后,请同步更新第四节表格与第五节依赖图;若新增中间件,记得补到第二节中间件栈顺序与 createPageAgent 装配说明。
- 类型导出有**双份真相源**:`src/core/index.ts`(运行时导出)与 `types/index.d.ts`(手动镜像声明)—— 新增导出时两处都要改(CLAUDE.md 已约定)。
- 新增工具/能力优先做成**中间件或工具注入**,勿硬编码进 `createAgent`(保持 harness 与具体能力解耦)。
