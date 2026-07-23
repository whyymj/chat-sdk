# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。

## 项目概述

`page-agent`(npm 包名 `page-agent`,仓库目录仍名 `zhuanti-agent`)是一个**框架无关的 JS SDK**:以对话框形态挂载到任意网页,内置一个基于 ReAct 模式的 Tool-Calling Agent。Agent 通过自定义 tool 直接读写宿主页面 `window` 对象上的属性(基于**属性注册表 + schema 校验**)、GET 抓取文档,并具备 planning / skills / 内存工作区 / context 管理能力。

由原 `zhuanti-agent`(Vue3 库、绑定"什么值得买专题"业务)重构而来,采用**自研 Deep Agents 风格 harness**(规避 `deepagentsjs#292` 浏览器打包阻塞,不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent.js`(ESM,peer 外置)、`dist/page-agent.umd.cjs`(UMD)、`dist/page-agent.iife.js`(IIFE 全量,供 CDN `<script>` 直引)、`dist/page-agent.css`
- 类型声明:`types/index.d.ts`(手动维护,构建不自动生成)
- 入口:`src/index.ts`

## Agent 身份

通用「页面操作助手」。systemPrompt 由 `createPageAgent({ systemPrompt })` 注入,不再硬编码业务身份。修改身份只传 systemPrompt,无需改代码。

## 技术栈

- **框架**:Vue 3.5(**打包进 SDK**,对外框架无关;非 peer)
- **构建**:Vite 8(库模式 `build.lib`)
- **语言**:TypeScript 7
- **AI**:LangChain **浏览器子包**(`@langchain/openai` + `@langchain/core`),兼容 OpenAI 协议(默认接 DeepSeek)。**不引入** `langchain` 整包 / LangGraph
- **校验**:zod 4(window 属性 schema、工具参数)
- **Markdown**:`marked` + `highlight.js`(打包进库)

## 常用命令

```bash
npm run dev       # 本地开发(端口 3000;被占则自动换,如 3001)
npm run build     # 库模式构建到 dist/
npm run preview   # 预览构建产物
npm run test      # 自测(tsx 跑 src/__tests__/selftest.ts,51 项断言)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`,生产模板见 `.env.example`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS`(缺省 8192,大 JSON 需大输出窗口)/ `VITE_AI_SYSTEM_PROMPT`(单行)/ `VITE_DEBUG`(生产 false)。上下文压缩相关 `VITE_CONTEXT_*`(见 `useContextManager`)。

⚠️ `VITE_AI_SYSTEM_PROMPT` 必须单行(`.env` 不支持多行值)。dev demo(`App.vue`)会覆盖 systemPrompt 为通用页面操作助手。

## 目录结构

```
src/
└── core/                       # 通用 SDK 核心(框架无关,可整体迁移复用)
    ├── harness/                # 自研 agent harness(对齐 Deep Agents)
    │   ├── createAgent.ts      # ReAct 循环 + 中间件驱动核心
    │   ├── middleware.ts       # Middleware 契约 + 执行器(正序/逆序/洋葱)
    │   ├── state.ts            # HarnessState schema
    │   ├── todos.ts            # planning(write_todos 整表替换)
    │   ├── skills.ts           # 渐进式披露(defineSkill + load_skill)
    │   ├── memory.ts           # AGENTS.md 风格持久指令
    │   ├── permissions.ts      # scope 白名单(first-match-wins,默认不启用)
    │   └── summarization.ts    # context 压缩(compressInput,复用 useContextManager)
    ├── sdk/                    # createPageAgent(命令式入口)/ defineTool
    ├── tools/                  # windowOps(属性注册表+增量编辑+快照)/ fetchDoc
    ├── backends/vfs.ts         # 内存虚拟工作区(read/write/edit/ls/glob/grep)
    ├── backends/storage.ts     # IndexedDB 持久化(降级内存)+ 多 agent 隔离 + 配额/LRU 淘汰
    ├── utils/                  # offload(大结果外存)/ rounds
    ├── composables/            # useChat / useContextManager / useMarkdown
    ├── components/             # ChatDialog / MessageContent / CodePreview / DebugDrawer(通用 UI)
    ├── types/index.ts
    ├── __tests__/selftest.ts   # 自测(51 项)
    └── index.ts                # 库唯一入口(只导出通用核心)
examples/
└── page-demo/                  # 定制 demo(开发自举):App / main / PageRenderer / pageSchema / useAgentConfig
index.html                      # dev 入口(指向 examples/page-demo/main.ts)
doc/                            # architecture.md(架构图)+ README.md(索引)
demo/plain.html                 # 框架无关集成示例(importmap + esm.sh)
```

## 架构要点

### 自研 harness(`createAgent` + 中间件)
- `createAgent(options)`:ReAct 循环 + 可插拔中间件,不绑定具体工具/能力
- **中间件契约**(`Middleware`):`beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent` + `augmentPrompt`/`compressInput`/`tools`。**before 类正序、after 类逆序、wrap 类洋葱(reduceRight)**
- 内置中间件顺序:`todos → skills → vfs → summarization → memory → permissions(可选)`
- `createPageAgent` 组装:harness + 内置工具(`windowOps`/`fetchDoc`/`vfs`)+ 用户 `tools`/`skills`/`memory`/`windowProps`

### window 操作(属性注册表 + schema 校验 + 增量编辑 + 快照回退 + 大结果外存)
- 集成方声明 `windowProps: [{ path, description, schema }]`
- 工具:`list/describe/get/get_paths/set/edit/delete_window_prop` + `snapshot/list/restore_window_snapshot`(共 10 个)
- `set/edit/delete` 仅限注册表内(范围控制);`set/edit` 按 schema 校验,不合法返回结构化错误(不写入)
- `get`/`get_window_paths` 可读注册属性的**祖先路径**与**后代子路径**(如注册了 `page.components`,`get('page.components.0.text')` 精确读局部;`get_window_paths` 批量读多路径)
- `edit_window_prop` 按 `jsonPath`(如 `components.0.text`)发 patch(set/remove/merge/append),避免 LLM 重传整个大 JSON;校验在副本、**就地写回改子属性不替换根引用** → 兼容 Vue reactive
- **快照回退**:`set/edit/delete` 前自动存快照(per-path 栈,默认 20);`restore_window_snapshot`(不传 id=最近一次)一键回退,就地还原保留 reactive 引用,不入栈
- **大结果外存**:工具结果 > 6000 字符由 `createAgent` 的 `coreExecTool` 统一经 `ctx.state.files` 转存 vfs,只留预览 + `vfs_read`/`vfs_grep` 引用(不再硬截断丢信息);vfs 不可用退化为截断
- **零桥接**:工具函数体 `window` = 宿主页面主 window(无 iframe/shadow 隔离,直接改)
- 审计:set/edit/delete/restore 记日志

### 响应式绑定(测试模块 `demo/pageSchema.ts`)
`window.page` 用 Vue `reactive()`;Agent `set` 子属性(**不替换引用**)→ `PageRenderer` 响应式更新。

### 记忆管理(含纯内存上限,防 OOM)
- 上下文压缩(纯内存、会话级,非持久化):`summarization` 中间件经 `compressInput` 复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回)
- **纯内存上限**(storage:false 也生效,防长会话/大结果外存撑爆内存):
  - vfs 工作区:`maxBytes`(默认 4MB,`createVfs` opts / `options.vfs.maxBytes`)→ 超限按 `updatedAt` 最旧 **LRU 淘汰文件**
  - 对话历史:`maxMemoryRounds`(默认 50,`options.maxMemoryRounds`)→ 超限把最旧轮次**压缩为一条摘要 system 消息**(`trimMemoryMessages`,经 `afterRound` 在每轮后收口;0 关闭)

### 持久化存储(多后端 + 多 agent 隔离 + 全局配额/LRU 淘汰)
- **默认关闭,赋值开启**:`storage` 不传 / `false` / `{ enabled: false }` → 关闭(纯内存);赋值后端字符串 `'indexed'`/`'session'`/`'local'`/`'memory'` 或配置对象 → 开启。例:`storage: 'session'`、`storage: { backend: 'local', maxBytes: 2*1024*1024 }`
- **三层命名空间**:`DB(page-agent)→ agentId → sessionId`,单 DB + 单 `kv` objectStore,复合 key `v:1::{dbName}::{agentId}::{sessionId}::{kind}`(kind ∈ messages/vfs/todos/memory/__meta__)
- **id 必传稳定值**:多 agent 共存靠 `options.id` 隔离;不传则随机生成 + `console.warn`(刷新后无法恢复)
- **可注入后端**(`backends/storage.ts`):`StorageBackend` 实现 = `IdbBackend`(原生 IndexedDB)/ `WebStorageBackend`(localStorage·sessionStorage)/ `MemoryBackend`(测试+降级);指定后端不可用(隐私模式/QuotaExceeded)自动降级内存,不崩溃
- **配额与淘汰(各后端达上限均淘汰老旧数据)**:全局总配额**按后端类型给默认**(indexed/memory 50MB;local/session 4MB,贴合浏览器 WebStorage ~5MB 留余量;均可 `maxBytes` 覆盖)+ 单会话软上限(默认 10MB);超限按 `lastAccessed` **整会话 LRU 淘汰**到 0.9 水位线;**运行时撞浏览器真实配额**(`QuotaExceededError`,导出的 `isQuotaError` 判定)→ 先淘汰最旧会话腾空间 → 仍失败则**降级内存重写**(数据不丢)+ `emit degraded`;`SessionStore.onEvent` 收 degraded/quota/evicted/flush
- **切换上下文**:`PageAgent.switchSession(sessionId?)`(传 id 载入/不存在则以该 id 新建;不传则新建)→ flush 当前 → 清内存态 + 灌入目标快照(替换语义)→ 返回新 id。**storage 未开启时抛错**。同实例切上下文用此 API;换 agentId(切命名空间)需重建实例
- **共享上下文(同页)**:`shareContext: true` 时同 `id` 的多个 createPageAgent 复用同一 `AgentCore`(messages/agent/vfs/store/todos/memory 全共享 = 同一 agent 的多个对话框视图);模块级 `sharedCores` 注册表 + 引用计数,`unmount` 归零才真销毁。默认 `false`(每实例独立)
- **流式输出**:`streaming`(默认 `true` 逐字流式);`false` 时 ChatDialog 走 `fetchResponse`(等整段回复,底层仍 stream 聚合)
- **持久化数据**:对话历史 / vfs 工作区 / todos / memory;**window 快照栈不持久化**(刷新后宿主值已变)
- **集成**:vfs 经 Proxy 捕获 `store.files` 变更 → debounce save(工具层无感);`mount()` 异步 init(await ready → 解析 sessionId → load 恢复 → 构造 agent);`send()` 与 UI 共享同一响应式 `messages` 数组(唯一来源);`pagehide`/`visibilitychange` → `flush()` 兜底
- **自测**:`selftest.ts` 用 `createMemoryBackend` + 纯函数(encodeKey/estimateBytes/selectForEviction)覆盖隔离/save-load/配额/淘汰/降级(IdbBackend 仅手动验证)

## 关键约定与坑

### LangChain 消息字段名
`ToolMessage` 构造参数用 snake_case `tool_call_id`(非 camelCase),否则 DeepSeek/OpenAI 报 `400 missing field tool_call_id`。`call.id` 可能 undefined,需生成兜底 id。

### ChatOpenAI 参数
用 `apiKey`(非 `openAIApiKey`)、`model`(非 `modelName`),`baseUrl` 通过 `configuration.baseURL` 传入。

### 库构建 external
`vite.config.ts`:`vue` **打包进 SDK**(框架无关);`zod` / `@langchain/*` external(peerDep);`marked`/`highlight.js` 打包进。**不引 langchain 整包/LangGraph**(规避 `deepagentsjs#292`)。

### 中间件生命周期
before 类正序、after 类逆序、wrap 类洋葱。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`。

### window 工具零桥接
工具函数体 `window` = 宿主页面主 window。改 window 必经 `set_window_prop`(范围 + 校验)。

### 自测
`npm test`(tsx 跑 `selftest.ts`,78 项)覆盖核心逻辑,不依赖 LLM。

## SDK 用法
```ts
import { createPageAgent, defineTool, defineSkill } from 'page-agent'
createPageAgent({
  container: '#root', llm: { apiKey, baseUrl, model },
  systemPrompt: '...', windowProps: [{ path, description, schema }],
  tools: [...], skills: [...], memory: '...',
}).mount()
```
框架无关集成见 `demo/plain.html`(importmap + esm.sh 提供 peer dep)。

## 编码规范
- `<script setup lang="ts">`,Composition API;注释用中文,只解释非显而易见处
- 新增 composable/组件/工具在 `src/index.ts` 导出并同步 `types/index.d.ts`
- 改构建依赖同步 `vite.config.ts` 的 external/globals
- `.env` 的 `VITE_AI_SYSTEM_PROMPT` 写单行

## 发布与引入
包名 `page-agent`(`package.json` 已配 `exports`/`files`/`peerDependencies`/`unpkg`/`jsdelivr`/`sideEffects`)。`vue` 打包进库(非 peer);`zod`/`@langchain/*` 为 peer(npm 安装时由消费者装)。三种引入方式:

- **npm**:`npm install page-agent` → `import { createPageAgent, z } from 'page-agent'`(同时装 peer:`zod`、`@langchain/openai`、`@langchain/core`)。
- **CDN · ESM(esm.sh)**:`import { createPageAgent, z } from 'https://esm.sh/page-agent'`(peer 由 esm.sh 自动解析,体积小,推荐模块化场景)。
- **CDN · IIFE 全量**:`<script src="https://unpkg.com/page-agent"></script>` → 全局 `window.PageAgent`(`PageAgent.createPageAgent` / `PageAgent.z`),依赖全打包进单文件,一行引入零配置,体积 ~1.4MB。示例见 `demo/plain.html`。

构建:`npm run build` = `build:lib`(ESM + UMD,peer 外置)+ `build:iife`(IIFE 全量,配置 `vite.iife.config.ts`)。发布前确保 `npm run build` + `npm test` 通过,`types/index.d.ts` 与 `src/core/index.ts` 导出一致。
