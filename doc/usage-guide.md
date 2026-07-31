# page-agent-sdk 使用手册

> **[English](./usage-guide.en.md)** · **[中文](./usage-guide.md)**

> 框架无关的页面 Agent SDK:一行挂载,给任意网页装上一个能**读写宿主页面、调用工具、规划任务**的 AI 对话框。

---

## 目录

- [1. 它是什么](#1-它是什么)
- [2. 安装](#2-安装)
- [3. 快速开始(3 分钟)](#3-快速开始3-分钟)
- [4. 核心概念](#4-核心概念)
- [5. 配置项参考](#5-配置项参考)
- [6. 能力详解](#6-能力详解)
  - [6.1 数据操作(让 Agent 改你的页面)](#61-数据操作让-agent-改你的页面)
  - [6.2 自定义工具](#62-自定义工具)
  - [6.3 Skills(渐进式披露)](#63-skills渐进式披露)
  - [6.4 Memory(持久指令)](#64-memory持久指令)
  - [6.5 Planning(任务规划,自动)](#65-planning任务规划自动)
  - [6.6 持久化与会话管理](#66-持久化与会话管理)
  - [6.7 对话鲁棒性(重试 / 停止 / 重试)](#67-对话鲁棒性重试--停止--重试)
  - [6.8 上下文与内存上限](#68-上下文与内存上限)
  - [6.9 onEvent 事件回调(订阅常用时机)](#69-onevent-事件回调订阅常用时机)
  - [6.12 LLM 连接:直连 / 代理 / OpenAI 兼容端点](#612-llm-连接直连--代理--openai-兼容端点)
- [7. 高级:自定义中间件](#7-高级自定义中间件)
- [8. 命令式 API](#8-命令式-api)
- [9. 框架无关 / CDN 集成](#9-框架无关--cdn-集成)
- [10. 环境变量](#10-环境变量)
- [11. 常见问题与坑](#11-常见问题与坑)
- [12. 完整示例(简 → 繁)](#12-完整示例简--繁)

---

## 1. 它是什么

`page-agent-sdk` 是一个 **JS SDK**,把一个基于 ReAct 的 Tool-Calling Agent 以**对话框形态**挂载到任意网页。Agent 能:

- **读写宿主页面** `window` 上声明的属性(带 schema 校验 + 快照回退)→ 直接驱动你的页面 UI
- **调用工具**:抓取文档、读写虚拟工作区、以及你自定义的任意工具
- **规划多步任务**(todos)、**按需加载技能**(skills)、**记忆持久指令**(memory)
- **持久化对话**(IndexedDB,降级内存)、**多 agent 隔离**、**会话切换**
- 自动**重试**失败请求、支持**停止生成**、**出错重试**

框架无关:Vue被打包进 SDK,宿主页面无需装 Vue。兼容 OpenAI 协议(默认接 DeepSeek)。

## 2. 安装

**方式一:npm**(推荐,模块化项目)

```bash
npm install page-agent-sdk
# 同时装 peer 依赖
npm install zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
```

**方式二:CDN · ESM**(esm.sh 自动解析 peer,体积小)

```html
<script type="module">
  import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'
</script>
```

**方式三:CDN · IIFE 全量**(一行引入零配置,依赖全打包,适合无构建链路)

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
</script>
```

**按需引入(subpath exports)**:除顶层 `page-agent-sdk` 外,三个子路径入口让你只引特定能力(bundler 对未用部分 tree-shaking):

| subpath | 主要导出 | 场景 |
|---|---|---|
| `page-agent-sdk/storage` | `createSessionStore` / `createMemoryBackend` / `createWebStorageBackend` / `isQuotaError` | 只要持久化层,不引 Agent |
| `page-agent-sdk/query` | `jpEval` / `searchJson` / `runSandboxedScript` + jsonUtils / schemaUtils 全部纯函数 | JSON 查询 / 沙箱 / 路径操作 |
| `page-agent-sdk/llm` | `createProxyLlm` + `ProxyLlmMode` / `ProxyLlmOptions` | 防 apiKey 泄露的代理连接 |

```js
import { createSessionStore, createMemoryBackend } from 'page-agent-sdk/storage'
import { getByPath, setByPath, hashValue } from 'page-agent-sdk/query' // jsonUtils 纯函数
```

> 三个 subpath 当前指向同一份 dist + types(未拆多入口构建),语义清晰 + 便于 CDN 按入口拉取;未来切多入口构建时 import 路径零迁移。

## 3. 快速开始(3 分钟)

最小可用例子 —— 让 Agent 能读写你的页面主数据:

```ts
import { createChatSdk, z } from 'page-agent-sdk'

// 1. 你的页面状态(任意结构;reactive/普通对象皆可)
const app = { title: '你好', theme: 'light' }
window.app = app  // 可选:挂到 window 供页面读取;SDK 工具直接读写 bind,不强制挂 window

// 2. 挂载 Agent
createChatSdk({
  container: '#agent',                    // 挂载点(选择器或 DOM 元素)
  id: 'my-app',                           // 稳定 id(刷新后恢复对话)
  storage: 'indexed',                     // 开启持久化
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  systemPrompt: '你是页面助手。可读改主数据的 title / theme。',
  data: {
    schema: z.object({
      title: z.string().describe('页面标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
    }),
    bind: app,                            // 直连对象(工具直接读写 bind,响应式刷新)
    description: '应用配置',               // 可选:不传则自动生成
  },
}).mount()
```

打开页面,在对话框输入「把主题改成 dark」→ Agent 调用 `write({ value:{ theme:'dark' }, patch:{ op:'merge' } })` 直接改 `app.theme`。完。

## 4. 核心概念

| 概念 | 说明 |
|---|---|
| **Agent** | ReAct 循环:思考 → 调工具 → 观察 → 再思考,直到给出最终回复 |
| **data** | 你声明「Agent 可以读写哪个主数据对象 + 值的 schema」。Agent 只能改 schema 允许的值(范围 + 校验) |
| **工具(tool)** | Agent 的手脚。内置 window/vfs/文档抓取工具 + 你用 `defineTool` 加的 |
| **中间件(middleware)** | 插入 Agent 生命周期的钩子。内置 todos/skills/vfs/summarization/memory/permissions/verify,也可自定义 |
| **持久化(storage)** | 对话/工作区/todos/memory 落盘(IndexedDB 等),刷新可恢复 |

**心智模型**:你只负责 ① 声明 `data`(Agent 能碰什么)② 写 `systemPrompt`(Agent 该干嘛)③ 可选加 `tools`/`skills`/`middleware`。其余交给 Agent。

## 5. 配置项参考

```ts
createChatSdk({
  /* ===== 必填 ===== */
  container: '#agent',          // 挂载点(选择器字符串 或 HTMLElement)
  llm: {
    apiKey: 'sk-xxx',           // LLM API Key
    baseUrl: 'https://...',     // OpenAI 兼容端点(可选)
    model: 'deepseek-chat',     // 模型名(可选)
    temperature: 0.7,           // 温度(可选;操作大 JSON 建议 0.3)
    maxTokens: 16384,           // 输出上限(默认 16384;大 JSON 场景可调大)
  },
  // provider 抽离:llm 也可传任意 LangChain 模型实例(接 Anthropic/Google/Ollama 等,装对应 peerDep)
  // llm: new ChatAnthropic({ model: 'claude-sonnet-4-...' }),

  /* ===== 身份与隔离 ===== */
  id: 'my-app',                 // agent 实例 id(强烈建议传稳定值;多 agent 共存隔离 + 刷新恢复)
  systemPrompt: '...',          // Agent 身份与业务流程指令(可选:不传用内置默认——JSON 操作助手 + reliableWriteRules;传了则完全覆盖。默认 appendReliableWriteRules:true 自动用 '---' 分隔线追加 reliableWriteRules,设 false 关闭)
  // ⚠️ 工具用法(read/write/get/set/patch/autoLock/snapshot 等)由 usageHints 中间件按 toolMode 自动注入,无需在此声明;systemPrompt 只写「业务知识」:身份、可改字段含义、业务流程、技能引用
  shareContext: false,          // true:同 id 的多个实例共享同一 Agent(同页多对话框 = 同一 agent)

  /* ===== 能力注入 ===== */
  data: { schema, bind, description? },  // 单主对象:bind 直连 reactive/普通对象(工具直接读写 bind);schema 字段 .describe() 自动注入 systemPrompt「可操作数据」段
  tools: [...],                 // 自定义工具(defineTool)
  skills: [...],                // 渐进式披露技能(defineSkill)
  memory: '...',                // AGENTS.md 风格持久指令
  permissions: [...],           // scope 白名单(默认不启用)
  middleware: [...],            // 自定义中间件(见第 7 节)

  /* ===== 持久化与会话 ===== */
  storage: 'indexed',           // 'indexed'/'session'/'local'/'memory'/配置对象/false(默认关闭)
  session: { id?, autoResume?, title? },  // 会话控制

  /* ===== 容量与鲁棒性 ===== */
  vfs: { initialFiles?, maxBytes?, poolBytes? },      // 虚拟工作区(默认总上限 8MB;2.16.0+ 三池分池:large_results/drafts/userFiles 各自 LRU,`poolBytes` 单池配)
  maxSnapshots: 20,             // 主数据快照数(默认 20,FIFO)
  maxMemoryRounds: 50,          // 内存保留对话轮数(默认 50,超限压缩为摘要;0 关闭)
  maxToolRounds: 10,            // 单轮最多工具调用轮次(默认 10)
  maxRetries: 2,                // 模型调用失败重试次数(默认 2;网络/429/5xx 重试)
  capabilities: { dataOps: true, fetch: true, planning: true, vfs: true, verify: true },  // 能力开关(默认全开;关掉省 token。dataOps/fetch 控制内置工具装载;verify 反向:默认关,需显式 verify:true)
  verify: { maxAttempts: 2 },        // 自检(需 capabilities.verify:true;check 省略→默认写后读回验证;见 6.10)

  /* ===== UI 与其他 ===== */
  streaming: true,              // 流式逐字输出(默认 true)
  contextPreset: 'auto',        // 压缩预设:auto(默认)/conservative(省成本)/aggressive(省上下文)/complex(多步复杂任务/大 JSON/长流程,2.16.0+)
  contextOptions: {...},        // 压缩细参,覆盖 preset 个别字段(false 关闭压缩)
  summaryLlm: { apiKey, baseUrl, model },  // 摘要专用模型(不配用主 llm)
  summaryTemperature: 0.3,      // 摘要 LLM 温度(默认 0.3)
  summaryMaxTokens: 1024,        // 摘要 LLM 输出上限(默认 1024)
  summaryTimeoutMs: 15000,       // 摘要 LLM 超时(默认 15s,超时回退索引摘要)
  dialog: {                      // 对话框 UI 归组配置
    title: 'AI 助手',             // 对话框标题
    placeholder: '输入消息...',   // 输入框占位
  },
  debug: false,                 // 调试日志
}).mount()
```

## 6. 能力详解

### 6.1 数据操作(让 Agent 改你的页面)

这是 SDK 的核心。你用 `data` 声明 Agent 能碰的主数据对象:

```ts
data: {
  schema: z.object({
    theme: z.enum(['light', 'dark', 'auto']).describe('页面主题'),  // 写入校验 + 字段说明自动注入 systemPrompt
    title: z.string().describe('页面标题'),
  }),
  bind: page,                    // 直连 reactive/普通对象(工具直接读写 bind,响应式刷新)
  description: '应用配置',       // 可选:不传则自动生成
}
```

Agent 自主调用这些内置工具(无需你写):

| 工具 | 作用 |
|---|---|
| **`read`** / **`write`**(推荐) | 高层读写入口,合并 describe/get 与 set/edit/delete + 自动乐观锁 + 自动快照,LLM 认知负担最低 |
| `describe_data` | 查看主数据说明 + schema 字段描述(simple 模式隐藏,被 `read` 合并) |
| `get_data` | 读主数据(支持 `jsonPath` 精确读局部;simple 模式隐藏,被 `read` 合并) |
| `set_data` | 整体替换主数据(**按 schema 校验**,不合法返回错误不写入;simple 模式隐藏,被 `write` 合并) |
| `edit_data` | 增量 patch(`op=set/remove/merge/append` + `jsonPath`),避免重传整个大 JSON(simple 模式隐藏,被 `write` 合并) |
| `delete_data` | 删子路径(simple 模式隐藏,被 `write` 合并) |
| `query_data` / `search_data` / `eval_script` | 大 JSON 查询(JSONPath)/ 模糊搜索 / 沙箱脚本 |
| `snapshot_data` / `list_data_snapshots` / `restore_data` | 快照 / 回退 |

**要点**:
- **schema 校验**:`set`/`edit`/`write` 不合法值会被拦截(不写入),返回结构化错误给 Agent 自纠。
- **快照回退**:每次 `set`/`edit`/`delete` 前自动存快照,`restore_data` 一键回退。
  - 自动快照:写操作前自动入栈(默认 20,FIFO 丢最旧)
  - 手动检查点:`snapshot_data(label?)` 命名快照
  - 查看时间线:`list_data_snapshots()` —— 序号 / op / 标签 / 大小
  - 回退:`restore_data(id?)` —— 不传 id 回退最近一次,传 id 回退指定;就地还原保留响应式、不入栈
  - 例:Agent 误改 `theme`,对话「回退最近一次修改」→ Agent 调 `restore_data()`
- **Vue 响应式友好**:`edit` 就地改子属性、不替换根引用 → 你的 `reactive()` 页面能正常响应更新。
- **解耦 window**:`bind` 直连对象,工具直接读写 bind,SDK 不再自动挂 window(集成方按需自己挂 `window.app = app` 供页面读取)。

### 高层读写工具 `read`/`write`(推荐)

为降低 LLM 认知负担(从 13 个底层工具收敛到 2 个高层入口),新增 `read`/`write`:

```ts
// read:不传 jsonPath 读整个主数据 + 说明;传 jsonPath 读子路径
// Agent: read({}) → "主数据说明: 应用配置\n格式: ...\n\n主数据 = {\"title\":\"首页\",\"theme\":\"light\"} (hash=a1b2)"
// Agent: read({ jsonPath: 'title' }) → "主数据 @ title = \"首页\" (hash=a1b2)"

// write:三种意图
// ① 整体替换(value 直传 JSON 对象,无需 stringify)
write({ value: { title: '新标题', theme: 'dark' } })
// ② 增量 patch(op=set/remove/merge/append,jsonPath 相对主数据根)
write({ value: 'c', patch: { op: 'append', jsonPath: 'items' } })
write({ value: { title: '合并标题' }, patch: { op: 'merge' } })
write({ value: 180, patch: { op: 'set', jsonPath: 'components.0.price' } })
// ③ 删除子路径
write({ patch: { jsonPath: 'oldField' }, del: true })
```

`write` 自动:① schema 校验(失败不写)② 存快照(可 `restore_data` 回退)③ 乐观锁(autoLock,用 `read` 返回的 hash 比对整体,冲突触发 `VERSION_CONFLICT` 或人工介入)。

### `toolMode` 工具呈现模式

```ts
createChatSdk({
  // ...,
  toolMode: 'simple',  // 默认:主推 read/write,隐藏底层 get/set/edit/delete/describe(5 个),保留 read/write + query/search/eval/snapshot/list/restore(共 8 个数据工具)
  // toolMode: 'advanced',  // 全暴露(13 个,等价 11 底层 + read/write;依赖底层工具名时用)
  // toolMode: 'minimal',   // 只 read/write(2 个,最简)
})
```

- `simple`(默认):LLM 只见 `read`/`write` + 高级查询/快照,认知负担最低;`usageHints` 自动注入 read/write 用法
- `advanced`:全暴露(兼容旧代码/调试/需精确控制时用)
- `minimal`:只 `read`/`write`(纯读写场景,最省 token)

### `interceptors` 读写拦截器

集成方可脱敏/转换/审计/拒绝 LLM 的读写:

```ts
createChatSdk({
  // ...,
  interceptors: {
    // LLM 读时拦截:脱敏(只改 LLM 看到的值,不改实际存储)
    read: (value) => value?.secret ? { ...value, secret: '***' } : value,
    // LLM 写时拦截:转换/审计/拒绝
    write: (payload, current) => {
      if (payload?.locked) return { error: '该字段禁止修改' }
      return payload  // 放行(可改写后返回)
    },
  },
})
```

- `read(value)`:返回值改写后给 LLM(脱敏/派生);抛错返回 `READ_INTERCEPT`
- `write(payload, current)`:返回改写后的值放行,或 `{error}` 拒绝(返回 `WRITE_INTERCEPT`)
- `input(input)`/`output(json)`:agent 级 IO 预处理/后处理
  - `input`:send 入口预处理 user message(可改写/审计)
  - `output`:agent 返回前 postprocess(可改写最终回复)

#### schema 即白名单(只暴露声明字段)+ 拦截器补充不可见字段

当 `data.schema` 是 `z.object(...)`(或其可选/默认/懒加载包装)时,SDK 自动启用**白名单模式**:只暴露 schema 声明的字段给 LLM,未声明字段对 LLM 不可见、不可读写。这适合「bind 是大 JSON,但只希望 agent 操作其中部分字段」的场景——集成方把可操作字段写进 schema,其余字段(内部状态、敏感数据、冗余缓存)自动隐藏,无需额外配置。

- **读**:`read` 整体读按顶层 schema 投影;**子路径读也按该位置的子 schema 递归投影**(如 `read components.0` 会按 `components` 的元素 schema 投影,隐藏子对象未声明字段)。读未声明的(子)路径返回 `PATH_DENIED`。
- **写**:`set`/`write(set)` 整对象用 **merge 语义**——只更新 schema 声明字段,未传的字段保留不动(防误删);`edit`/`write(patch)` 增量改子路径同理,逐段校验路径必须在 schema 声明内。
- **拦截器补充不可见字段**:`interceptors.write` 返回的 payload 中,若含**不在 schema 声明内**的字段(如自动生成的 `id`/`_createdAt`/内部状态),SDK 会在 schema 校验 + merge 之后**写回 bind**(信任集成方拦截器/用户显式传值),不会因 schema strip 丢失。典型用法:agent `append` 一个新组件,拦截器自动补 `id`/`createdAt` 等不想暴露给 LLM 的内部字段:

```ts
createChatSdk({
  data: {
    // schema 只声明 agent 可操作字段(不声明 _createdAt → 对 agent 不可见)
    schema: z.object({ title: z.string(), items: z.array(z.object({ name: z.string() })) }),
    bind: app,
  },
  interceptors: {
    write: (payload, current) => {
      // agent push 新 item 时,自动补 _createdAt(不在 schema,对 agent 不可见,但落地保留)
      if (payload && Array.isArray((payload as any).items)) {
        const now = Date.now()
        ;(payload as any).items = (payload as any).items.map((it: any) =>
          it._createdAt ? it : { ...it, _createdAt: now }
        )
      }
      return payload
    },
  },
})
```

> 注:白名单模式仅对 `z.object` 启用;`z.any()`/`z.record()`/`z.discriminatedUnion()` 等非 object schema 不启用(全开放,向后兼容)。`passthrough()` 的 object 仍启用白名单(声明字段才对 LLM 可见,额外字段写入保留但读时隐藏)——若希望额外字段也对 LLM 可见,需在 schema 显式声明。

### `data` 单主对象配置

`data` 是唯一的数据配置入口,集声明 schema + 直连对象 + 自动注入字段说明于一体:

```ts
import { reactive } from 'vue'  // 或任何响应式实现
const PageSchema = z.object({
  title: z.string().describe('页面标题'),
  count: z.number().describe('计数'),
})
const page = reactive({ title: '首页', count: 0 })

const sdk = createChatSdk({
  // ...,
  data: {
    schema: PageSchema,       // zod schema:写入校验 + 字段 .describe() 自动注入 systemPrompt「可操作数据」段
    bind: page,               // 必填:reactive/普通对象直连,工具直接读写 bind
    description: '页面配置',   // 可选:不传则自动生成
  },
})
// LLM write page → page 响应式自动更新;集成方改 page → LLM read 可见
```

- `bind` 必填:直连 reactive/普通对象,工具直接读写 bind(响应式刷新);SDK 不再自动挂 window,集成方按需自己挂 `window.app = app` 供页面读取
- `schema` 字段的 `.describe()` 自动提取(经 `extractSchemaHint`)注入 systemPrompt「可操作数据」段,集成方不用手写 description
- 预览将注入的提示:`extractSchemaHint(schema)`(已导出)
- **`bind` 不强制 reactive**:任何对象都行。区别在于「写后是否响应式刷新」:
  - 传 `reactive(obj)`(Vue):Agent `write` 改属性 → 模板/watch 自动响应(推荐 UI 场景)
  - 传普通对象:Agent `write` 能改数据,但页面不响应(适合 headless / 后端 / 集成方自己 `onEvent` 或 `watch` 后刷新)
  - 工具 `set`/`write` 用 `restoreInPlace` 就地改子属性(不替换根引用),兼容 reactive 代理;非 reactive 对象也能正常写入
- **通知外界对象已修改**的机制(详见 §6.9 onEvent):
  - `onEvent` / `sdk.hook` 订阅 `data_change` 事件(写后触发,含 `operation`/`value`)—— 适合 headless / 非 Vue / 普通对象 bind
  - Vue 响应式(bind 传 reactive)—— 模板/watch 自动响应,无需手动通知
  - `onEvent` 与响应式可并用:响应式管 UI 刷新,`onEvent` 管审计/埋点/跨系统联动
- **运行时替换主数据**:`sdk.setData(config)` / `sdk.getData()`(替代旧 add/remove/listDataSlots)
- **运行时替换 skill**:`sdk.setSkills(skills)`(同名 skill 覆盖更新;清 skill 全文缓存,下轮 system prompt 索引重渲染,下次 `load_skill` 取最新全文含 vfs doc)/ `sdk.invalidateSkillCache(name?)`(动态 skill 内容变化时主动失效缓存,不传清全部,传 name 清指定)
- **用户创建 skill(运行时 + 独立持久化)**:`sdk.addSkill(skill)`(用户在聊天界面内创建/编辑/删除自定义 skill,自动加入 agent,持久化由**独立 SkillStore**管理——默认 indexedDB,与 `storage` 选项分离,即使 `storage:false` 也持久化,跨刷新自动恢复;同名覆盖)/ `sdk.removeSkill(name)`(仅删用户创建的,不删集成方 `skills` 选项传入的 initialSkills)/ `sdk.listUserSkills()`(列出用户创建的 skill 名,UI 面板刷新用)/ `sdk.getUserSkill(name)`(读取用户创建的 skill 详情,SkillPanel 编辑时调)。内置 `ChatDialog` 头部有「Skill 管理」按钮打开 `SkillPanel` 组件,支持创建/编辑(点击已创建 skill 加载到表单)/删除;集成方也可单独 `import { SkillPanel }` 自建 UI。需开启 `capabilities.skills`(默认开)。**跨页面/跨 agent 复用**:手动指定 `skillStorage: { id: 'shared-skills' }`,多个 `createChatSdk` 实例(不同 agentId)用同一 id 即可共享同一套用户 skill;不传 `id` 则默认按 `agent::{agentId}` 隔离(每 agent 独立 skill 集)。`skillStorage: false` 关闭持久化(仅当前会话内存有效,刷新丢失)。

- **大 JSON 增量改**:改数组元素某字段用 `write({ value:180, patch:{ op:'set', jsonPath:'components.0.price' } })` 增量 patch,只发改动、不重传整个数组。改大对象/数组优先用 patch,避免整体重传被 max_tokens 截断致 JSON 不完整。
- **树形/递归 children 结构**:节点含 `children` 自引用时,用 zod `z.lazy(() => TreeNode)` 声明递归 schema,`.passthrough()` 让节点可带未声明字段:

  ```ts
  const TreeNode: z.ZodType = z.object({
    id: z.number(),
    type: z.string(),
    text: z.string().optional(),
    children: z.array(z.lazy(() => TreeNode)).optional(),  // 自引用 → 任意深度
  }).passthrough()

  data: { schema: z.object({ components: z.array(TreeNode) }), bind: page, description: '组件树' },
  ```

  - **查**:递归找任意深度的节点用 `query_data` 的 `$..*[?(@.type=="card")]`(找所有 card);精确定位用 `$.components.0.children.0.children.0.text`
  - **改**:增量改深层节点用 `write({ value:'新文本', patch:{ op:'set', jsonPath:'components.0.children.0.children.0.text' } })` —— jsonPath 逐级定位,只发改动,无需重传整棵树
  - **校验**:递归 schema 自动穿透到 children,append 非法节点(如缺 `id`)被拒;passthrough 保留节点的额外字段(extra/style 等)
  - **复杂遍历**(如带父路径聚合、按多条件递归筛选)用 `eval_script` 写递归 visit 函数最直观

#### 乐观锁(防"基于过期值覆盖")与冲突人工介入

当主数据可能被**外部代码 / 其他 agent / 用户手动**并发修改时,启用乐观锁:Agent `get_data`/`read` 返回值末尾附 `hash=xxx`(整体 bind 的 hash),写入时回传 `expectedHash` 校验。

```ts
// Agent 工作流(由 LLM 自动执行,集成方无需写;simple 默认 + autoLock 自动)
// 1. read({ jsonPath:'title' }) → "主数据 @ title = old (hash=a1b2)"
// 2. write({ value:'new', patch:{ op:'set', jsonPath:'title' } })   // 自动用上次 read 的 hash 比对整体
//    若期间外部改过任一字段 → 整体 hash 不匹配 → 触发冲突(VERSION_CONFLICT),重新 read 再改
```

**冲突时(默认开启人工介入):** 工具挂起,`sdk.pendingConflict` ref 置为冲突信息,内置 ChatDialog 弹冲突条让用户三选一:

| 选项 | 行为 | 结果 |
|------|------|------|
| **保留外部** | 不写入,保留外部改后的值 | Agent 重新 get 再改 |
| **强制覆盖** | 执行 Agent 写入 | 覆盖外部修改 |
| **回退** | 回退到快照栈顶(历史检查点) | 撤销外部改 + Agent 不写入 |

```ts
const sdk = createChatSdk({ /* ... */ })
await sdk.mount()

// 内置 UI 已自动处理冲突条;若 headless 自建 UI:
import { watch } from 'vue'
watch(sdk.pendingConflict, (c) => {
  if (!c) return
  // c: { id, path, op, agentValue, currentValue, currentHash, expectedHash, snapshotId }
  showConflictDialog(c, (action) => sdk.resolveConflict(action)) // 'keep_external'|'overwrite'|'restore'
})

// 或经事件订阅
sdk.hook((e) => {
  if (e.type === 'conflict') showConflictDialog(e.conflict, (a) => sdk.resolveConflict(a))
})
```

**挂起自动收口(防永久挂起):** 用户停止生成(abort)/ `unmount()` / `switchSession()` 时,自动按「保留外部」收口挂起的冲突。

> 不传 `expectedHash` → 向后兼容直接写(不校验)。独立使用 `createDataOps(props, { onConflict })` 不接 ChatDialog 时,自行处理冲突(返回 `Promise<{action}>`)。

#### 乐观锁与并发工具(`maxParallelTools > 1`)

`autoLock`(默认 `true`)让 `write` 自动比对乐观锁 hash:它复用 **LLM 最近一次 `read` 返回的整体 bind hash**(内部共享的 `lastReadHash`)做整体快照比对,集成方无需手传 `expectedHash`。单工具串行场景下这等价于"基于我自己刚 read 的值写入"。

**并发工具下,`autoLock` 退化为"整体快照语义"。** 当 `maxParallelTools > 1` 时,同一轮的多个 `read` 会**并发写同一个共享 `lastReadHash`**,完成顺序不确定,后续 `write` 比对的是"**最后完成的那个 `read` 的整体 hash**"——跨工具维度"我这个 write 用的是我自己那次 read 的 hash 吗"**不可重现**。这不破坏安全边界(仍是整体快照校验,冲突仍能被捕获),但失去了"每个 write 精确对应它自己的 read"的语义。

**并发场景需要精确乐观锁时:让 LLM 显式传 `expectedHash`。** 取它自己那次 `read` 返回值里的 `hash`,在 `write` 里回传:

```ts
// Agent 工作流(并发场景,由 LLM 自动执行)
// 1. read({ jsonPath:'title' }) → "主数据 @ title = old (hash=a1b2)"   ← 记住这个 hash
// 2. write({ patch:{ op:'set', jsonPath:'title', value:'new' }, expectedHash:'a1b2' })
//    精确比对 LLM 自己那次 read 的 hash,绕开共享 lastReadHash 的竞态
```

显式 `expectedHash` 优先于 `autoLock` 的共享 hash,跨并发工具可重现、可推理。

> **hash 算法**:2.16+ 起 `hashValue` 升级为 **cyrb53(53-bit)**,替代旧 djb2(32-bit),显著降低碰撞概率。`expectedHash` 直接取 `read`/`get_data` 返回值里的 `hash` 字段即可,无需集成方自己算。

### 6.2 自定义工具

给 Agent 加任意能力(API 调用、计算、宿主页面操作……):

```ts
import { defineTool, z } from 'page-agent-sdk'

const getWeather = defineTool({
  name: 'get_weather',
  description: '查询指定城市天气',
  schema: z.object({ city: z.string().describe('城市名') }),
  handler: async ({ city }) => {
    const r = await fetch(`/api/weather?city=${city}`)
    return await r.json()   // 返回 string 原样回传,其他值自动 JSON.stringify
  },
})

createChatSdk({ /* ... */ tools: [getWeather] })
```

`handler` 里 `this`/全局 `window` 就是宿主页面,可直接操作 DOM 或调用页面已有方法。

### 6.3 Skills(渐进式披露)

把**大段上下文**(如组件库文档、操作指南)做成 skill,Agent 按需加载,避免一次性塞满 prompt:

```ts
import { defineSkill } from 'page-agent-sdk'

createChatSdk({
  skills: [
    defineSkill({
      name: 'component-lib',
      description: '组件库使用文档',
      whenToUse: '用户要用组件库搭页面时',
      // 内容来源二选一(doc 优先于 getContent):
      getContent: () => fetch('/docs/components.md').then(r => r.text()),
      // 或用 doc 文档源(skill 内容与代码解耦,放 md 文档维护):
      // doc: 'https://host/components.md',        // 远程 md(同源/CORS)
      // doc: 'vfs://skills/components.md',        // vfs 启用时从工作区读
    }),
  ],
})
```

Agent 会在需要时调用 `load_skill('component-lib')` 把内容载入上下文。`doc` 源在加载时自动读取(http fetch / vfs 读取),读取失败(跨域 / 未找到 / vfs 未启用)返回结构化错误提示,超长截断(20000 字符)。

### 6.4 Memory(持久指令)

写入 AGENTS.md 风格的持久指令(项目规范、固定约束),**每次对话都生效**,且会持久化:

```ts
createChatSdk({
  memory: `
## 项目规范
- 所有金额单位为分(整数)
- 修改表单前必须先读取当前值
- 颜色只用 #667eea / #764ba2 色系
`,
})
```

**支持异步函数 source(适合 RAG / 异步加载文档)**:

```ts
// 异步加载知识库文档作为 memory
createChatSdk({
  memory: async () => await fetch('/kb/faq.md').then((r) => r.text()),
})

// 同步函数读运行时变量(注意:函数 source 默认缓存首次求值结果)
let lang = 'zh'
createChatSdk({ memory: () => `请用${lang}回答。` })
// lang 变了需 sdk.refreshMemory() 强制重新求值
```

| source 形态 | 求值时机 | 缓存 | 适用场景 |
|---|---|---|---|
| `string` | 立即 | 无需 | 静态文本(规范、约束) |
| `() => string` | 首次 `beforeAgent` | 是,`refreshMemory()` 重求 | 读运行时变量 |
| `() => Promise<string>` | 首次 `beforeAgent`(后台预求值) | 是,`refreshMemory()` 重求 | 异步加载 RAG 文档 |

> **缓存策略**:函数 source 首次求值后缓存结果,后续 `beforeAgent` 直接用缓存(避免每轮重复 fetch)。`setMemory(newSource)` 或 `refreshMemory()` 可清缓存重求。异步求值失败降级为空串(不阻塞 agent)。
> **持久化**:函数 source 不可序列化,落盘的是已解析的文本;reload 时 `options.memory` 仍是函数会重新求值(文档可能已更新,符合预期)。

### 6.5 Planning(任务规划,自动)

SDK 内置 todos 规划能力(中间件),**默认开启,无需配置**。遇到多步任务时,Agent 会:

1. 调 `write_todos` 把任务拆成清单(pending / in_progress / completed)
2. 逐项执行,每完成一项更新清单状态
3. 清单每轮注入 prompt,Agent 始终看得到全局进度

想让规划**可靠触发**,在 `systemPrompt` 里加一句引导:

```ts
systemPrompt: '遇到多步骤任务(≥3 步)时,先用 write_todos 拆解成清单,逐项执行并更新状态。'
```

简单任务 Agent 会直接做,不规划(符合预期)。todos 会随持久化保存,刷新可恢复。

### 6.6 持久化与会话管理

**开启**:给 `storage` 赋值即开启(默认关闭 = 纯内存):

```ts
storage: 'indexed'                          // IndexedDB(推荐,容量大)
storage: 'session'                          // sessionStorage(标签页内)
storage: 'local'                            // localStorage(持久)
storage: 'memory'                           // 纯内存(测试/降级)
storage: { backend: 'local', maxBytes: 2*1024*1024 }  // 配置对象
storage: false                              // 显式关闭
```

**持久化什么**:对话历史 / vfs 工作区 / todos / memory。(**主数据 `bind` 不持久化** —— `bind` 是集成方的业务对象(可能含函数/DOM/循环引用,SDK 不擅自深拷贝);集成方若需跨刷新/会话恢复 `bind`,自行存储后用 `sdk.setData({ bind: restoredBind })` 注入。dataOps 的 per-path 快照栈亦不持久化,刷新后清空。)

**多 agent 隔离**:靠 `id` 区分。同页多个 Agent 传不同 `id`,数据互不串扰。

**容量与淘汰**:各后端达上限自动按 LRU 淘汰最旧会话;隐私模式 / 撞配额自动降级内存,**不崩溃**。

**会话切换(命令式)**:

```ts
const agent = createChatSdk({ id: 'my-app', storage: 'indexed', /* ... */ })
await agent.mount()

await agent.switchSession()              // 新建会话
await agent.switchSession('session-xyz') // 切到指定会话(不存在则以该 id 新建)
```

**自动恢复**:`session.autoResume`(默认 true)刷新后自动恢复该 agent 最近会话。

### 6.7 对话鲁棒性(重试 / 停止 / 重试)

**① 自动重试(底层,对用户透明)**
模型调用遇到网络错误 / 429 / 5xx 自动指数退避重试(默认 `maxRetries: 2` = 最多 3 次尝试)。4xx(参数错误)不重试。调 `maxRetries` 可改:

```ts
createChatSdk({ maxRetries: 4 })   // 更激进,适合网络不稳
createChatSdk({ maxRetries: 0 })   // 关闭自动重试
```

**② 停止生成**
对话框发送按钮在 Agent 思考/回复时变成灰色「■ 停止」按钮,点击立即中止。**已生成的内容会保留**(等同 ChatGPT 的停止),不会报错。

**③ 出错重试**
请求失败时,错误条上出现「重试」按钮,点击移除失败回复、用最后一条用户消息重发。

### 6.8 上下文与内存上限

长会话不会撑爆内存:

- **上下文压缩**:`summarization` 中间件自动滑动窗口 + 摘要 + 关键词召回(默认开启)。摘要默认用 LLM(低温 0.3、限输出 1024)把旧轮次改写为连贯段落,失败/超时自动回退零成本索引摘要。
- **压缩预设**(`contextPreset`,默认 `auto`):普通场景选档即可,特殊情况用 `contextOptions` 细参覆盖个别字段。
  - `auto`:自适应,LLM 摘要 + 召回 Top-3,触发阈值 0.5、窗口 0.4
  - `conservative`:大模型/省成本,阈值 0.7、窗口 0.5,召回 Top-2,关 LLM 摘要用索引摘要
  - `aggressive`:小模型/省上下文,阈值 0.3、窗口 0.3,召回 Top-5
  - `complex`(2.16.0+):多步复杂任务/大 JSON/长流程,比例制:窗口 0.6、触发阈值 0.7、召回 Top-5、开 LLM 摘要;`preserveLastToolResults` 默认含 `describe_data`/`read`/`query_data`/`search_data`(大 JSON 场景防字段描述被摘要丢)。详见下文「complex 预设 + vfs JSON 感知工具」
- **摘要专用模型**:`summaryLlm` 可指定更便宜的小模型做摘要(不配用主 `llm`);`summaryTemperature`/`summaryMaxTokens`/`summaryTimeoutMs` 微调摘要 LLM。
- **对话历史上限**:`maxMemoryRounds`(默认 50)超限把最旧轮次压缩为一条摘要 system 消息。
- **vfs 工作区上限**:`vfs.maxBytes`(默认 8MB,2.16.0+)超限按 LRU 淘汰最旧文件。2.16.0+ **三池分池**:`large_results/*`(工具结果外存,自动)、`drafts/*`(草稿)、`userFiles`(用户文件)各自独立 LRU 互不挤占(默认单池 2MB,large_results 4MB),`vfs.poolBytes` 可单池配,读写跨池透明。

这些在 `storage: false`(纯内存)下也生效,防 OOM。

压缩统计可在 DebugDrawer「🧬 Agent 信息」tab 的「🗜️ 上轮压缩」段查看(触发与否、摘要轮次、召回条数、策略名),排查"上下文为何变了"。

#### 三者关系(`maxMemoryRounds` vs `contextOptions.windowRounds` vs `capabilities.summarization`)

三个配置各管不同层级,易混淆,对比:

| 配置 | 层级 | 作用 | 默认 | 关掉后果 |
|---|---|---|---|---|
| `capabilities.summarization` | 总开关 | 是否装载压缩中间件 | `true`(开) | 不压缩,只剩 `maxMemoryRounds` 硬截断(最旧轮次直接丢弃,无摘要) |
| `contextOptions.windowRounds` | 每轮 LLM 输入层 | 滑动窗口保留最近 N 轮**原文**,更老的进摘要区 | 6(`auto` 预设) | 窗口=0 则全进摘要区(每轮都压缩,省上下文但丢原文细节) |
| `maxMemoryRounds` | 持久化/内存层 | 对话历史**硬上限**,超限把最旧轮次压缩为一条摘要 system 消息 | 50 | 无上限(长会话 OOM 风险) |

**易混点澄清**:
- `maxMemoryRounds` ≠ `windowRounds`:前者是「历史最多存多少轮」(超限压缩归档),后者是「每轮给 LLM 看多少轮原文」(更老的摘要化)。例:`maxMemoryRounds=50, windowRounds=6` = 最多存 50 轮历史,但每轮 LLM 只看最近 6 轮原文 + 更老的摘要。
- `contextPreset`(`auto`/`conservative`/`aggressive`)是 `contextOptions` 的预设档,改 preset 等于批量调 `windowRounds`/`summaryThresholdRounds` 等阈值;`contextOptions` 显式字段覆盖 preset。
- 关 `capabilities.summarization` 后,`contextOptions` 全部失效(中间件不装载),只剩 `maxMemoryRounds` 硬截断 —— 适合「上下文由接口方管理,SDK 不压缩」的场景。

#### complex 预设 + vfs JSON 感知工具(2.16.0+)

面向**多步复杂任务 / 大 JSON 操作 / 长流程编排**场景,2.16.0 新增 `complex` 上下文预设 + vfs JSON 感知工具 + 三池分池 + offload 结构化元数据,提升长流程的上下文稳定性与大文件局部编辑能力。

**① `complex` 上下文预设**

`auto`/`conservative`/`aggressive` 面向普通对话,而多步复杂任务(低代码页面搭建、大型配置编排、长文档处理)的特点是:工具结果体积大、单轮上下文需求高、关键字段描述需跨轮保留。`complex` 用**比例制**适配这类场景:

| 字段 | complex | auto(对比) | 说明 |
|---|---|---|---|
| `windowRatio` | 0.6 | 0.4 | 每轮保留最近 60% 上下文窗口给原文(大 JSON 工具结果需更多原文) |
| `summaryThresholdRatio` | 0.7 | 0.5 | 上下文用量达 70% 才触发压缩(晚压缩,减少丢细节) |
| `recallTopK` | 5 | 3 | 召回更多旧轮次(复杂任务上下文关联性强) |
| `enableLLMSummary` | true | true | 用 LLM 摘要(保证摘要质量) |
| `preserveLastToolResults` | `['describe_data','read','query_data','search_data']` | `['describe_data','read']` | 额外保留 query/search 结果摘要(大 JSON 查询场景防丢) |

```ts
createChatSdk({
  contextPreset: 'complex',   // 一键启用多步复杂任务档
  // 也可逐字段覆盖(与 auto/conservative/aggressive 相同)
  contextOptions: { recallTopK: 8 },  // 例:任务特别长,召回更多旧轮次
  // ...
})
```

> `inspect().contextPreset`(2.16.0+)可在 DebugDrawer 查看 Agent 实际生效的预设档。

**② vfs JSON 感知工具**(`vfs_json_read` / `vfs_json_patch` / `vfs_write` jsonString)

vfs 工作区常用于存大 JSON(抓取的 API 响应、组件库快照、配置树草稿)。2.16.0 之前只能整体 `vfs_read` 读 + `vfs_write` 整体覆盖重写,大 JSON 整体重传易被 `max_tokens` 截断。新增两个工具支持**按 jsonPath 局部读写**:

```ts
// vfs_json_read:按 jsonPath 读 vfs 文件内 JSON 子树(省略读整体)
vfs_json_read({ path: 'drafts/config.json' })                          // 读整体
vfs_json_read({ path: 'drafts/config.json', jsonPath: 'components.0' }) // 只读某子树(省 token)

// vfs_json_patch:在 vfs 文件内原子 jsonPath patch(在 clone 上应用,任一失败整体不写回)
vfs_json_patch({
  path: 'drafts/config.json',
  patches: [
    { op: 'set',    jsonPath: 'title',         value: '新标题' },
    { op: 'append', jsonPath: 'items',         value: { id: 99 } },
    { op: 'merge',  jsonPath: 'style',         value: { color: 'red' } },
    { op: 'remove', jsonPath: 'deprecated' },
  ],
})
// 任一 patch 失败 → 返回 PATCH_FAILED,原文件不变(原子)

// vfs_write jsonString:true → 写入前校验 content 是合法 JSON(非法返 VFS_JSON_INVALID,不写入)
vfs_write({ path: 'drafts/config.json', content: '{"a":1}', jsonString: true })
```

| 工具 / 错误 | 含义 |
|---|---|
| `vfs_json_read` 返 `VFS_JSON_INVALID` | 文件内容不是合法 JSON |
| `vfs_json_read` 返 `VFS_PATH_NOT_FOUND` | jsonPath 在 JSON 中不存在 |
| `vfs_json_patch` 返 `PATCH_FAILED` | patch 应用失败,原文件未改(原子) |
| `vfs_write(jsonString:true)` 返 `VFS_JSON_INVALID` | content 非合法 JSON,不写入 |

> 动机:大 JSON 局部编辑走 jsonPath patch,只发改动、不重传整文件,规避 `max_tokens` 截断导致整体 JSON 不完整。配合主数据侧的 `write({patch})` 同构语义。

**③ vfs 三池分池**

2.16.0 前 vfs 是单池 LRU,工具结果外存(`large_results/*`)与用户草稿(`drafts/*`)/用户文件(`userFiles`)抢同一配额,大结果挤掉草稿(误删用户数据)。现分三池独立 LRU:

| 池 | 前缀 | 默认配额 | 用途 |
|---|---|---|---|
| `large_results` | `large_results/*` | 4MB | 工具结果自动外存(>6000 字符;>10000 附 `suggestedReadPlan`) |
| `drafts` | `drafts/*` | 2MB | Agent / 集成方写入的草稿 |
| `userFiles` | `userFiles`(无固定前缀) | 2MB | 用户文件 |

`vfs.maxBytes`(总,默认 8MB)、`vfs.poolBytes`(单池,可覆盖)。读写跨池透明(路径前缀自动路由)。

```ts
createChatSdk({
  vfs: {
    maxBytes: 16 * 1024 * 1024,            // 总上限调大(默认 8MB)
    poolBytes: { drafts: 4 * 1024 * 1024 }, // 单池配:草稿池给 4MB(其余默认)
  },
})
```

**④ offload 结构化元数据 + suggestedReadPlan**

工具结果外存(>阈值)的返回值升级为 `OffloadResult`,附结构化元数据。**大结果(>10000 字符)附 `suggestedReadPlan`**——给 LLM 一份 `vfs_read` 分页/分段读取建议(如先读哪段、分几页),引导 Agent 分块消费而非一次塞满上下文。集成方无需配置,自动生效。

### 6.9 子 agent(委派与并行)

主 agent 可委派**独立子 agent**处理子任务,只把最终结论收回主上下文(**过程隔离**,省主 token)。默认开启,Agent 自动获得两个工具:

- `spawn_agent({ prompt, role?, tools?, model? })` —— 委派一个子 agent
- `spawn_agents({ tasks: [{ prompt, role? }, ...] })` —— 并行委派多个,聚合结论

**适用**:分治大任务、多路调研、多视角审查、批量处理。

```ts
createChatSdk({
  // ...
  tools: [myResearchTool],
  subagent: {
    allowedTools: ['myResearchTool'],  // 子 agent 可用的额外工具(默认仅只读主数据 + fetch)
    maxDepth: 1,    // 递归深度(默认 1:主可 spawn,子不可再 spawn)
    maxParallel: 4, // spawn_agents 并发上限(默认 4)
    // enabled: false  // 关闭子 agent
  },
  maxParallelTools: 1,  // 同轮工具并发(默认 1 串行;与 subagent.maxParallel 不同)
})
```

**要点**:
- **过程隔离**:子 agent 的思考/工具调用**不进入主上下文**,只进最终结论(省 token + 不干扰主推理)。
- **只读默认**:子 agent 默认只用只读工具(window 只读 + fetch),不直接改页面;写回交主 agent。经 `allowedTools` 放开额外工具。
- **signal 继承**:主对话停止 → 子 agent 也停。
- **进度展示**:子 agent 跑时,对话框里 `spawn_agents` 步骤下方**实时嵌套显示**每个子 agent 正在调用的工具(如 `[子任务1] get_source ✅`)。子过程**只进 UI、不进主上下文**。

**自定义子 agent**(4 层级,从简到繁):
- ① **配置级**:`subagent: { allowedTools, maxDepth, maxParallel, enabled }` —— 放开子 agent 可用工具、控制递归/并发
- ② **调用级**:LLM 调 spawn 时按需设 `role`(子 agent 身份)/ `tools`(本次限定)/ `model`
- ③ **引导级**:systemPrompt 指导何时/如何委派(如「多方案对比用 spawn_agents」)
- ④ **高级**:直接 `createSubagentMiddleware({ llm, allTools, allowedTools, ... })` 自构造中间件(自定义 harness)
- ⑤ **预声明级(命名子 agent)**:`subagents: [...]` 预声明一组命名子 agent,每个自动生成 `use_<id>` 委派工具,配置同主(独立 llm / systemPrompt / tools / skills / 温度),缺省继承主。适合**固定角色**(调研专家 / 代码审查 / 文案):
```ts
createChatSdk({
  llm: mainLlm,
  subagents: [
    { id: 'researcher', description: '调研专家', llm: claudeLlm, systemPrompt: '你是调研专家…', tools: [...] },
    { id: 'reviewer', description: '代码审查', llm: deepseekLlm },
  ],
})
// 主 LLM 直接调:use_researcher({ task }) / use_reviewer({ task })
// 子 agent 配置缺省继承主(不传 llm/systemPrompt 则同主);与 spawn_agent 共存
```

**规划-反思-执行模式**(创作/设计场景):预声明高温 `planner`(创意规划,只读)+ 低温 `reflector`(反思审查,只读),主 agent 低温度落地。`usageHints` 中间件按 `subagents` 的 temperature/description **自动注入路由提示**(高温≥0.7 或描述含"规划/创意/设计"→ planner;低温且描述含"反思/审查/挑刺"→ reflector),无需手写 prompt:

```ts
createChatSdk({
  llm: { ...mainLlm, temperature: 0.3 },          // 主 agent 低温度:执行落地要稳
  subagents: [
    { id: 'planner', description: '创意设计规划师,擅长页面主题/风格方案设计(只出方案,不落地)',
      temperature: 0.9,                            // 高温度 → 创造力
      systemPrompt: '你是创意设计规划师。只读主数据,给出 2-3 套方案(JSON 草稿),不要调写工具。' },
    { id: 'reflector', description: '设计反思审查员,挑方案的不一致/不可行/体验问题',
      temperature: 0.3,
      systemPrompt: '你是设计反思审查员。对方案挑刺并给修订建议,不要重写整个方案。' },
  ],
  approval: { tools: ['write'] }, // 落地写前确认
})
// 流程:用户"设计夏日主题" → 主 agent 识别创作类 → use_planner 出方案
//      → (可选)use_reflector 审查 → request_human_confirmation 让用户选 → write 落地
```

> 路由由主 agent 自判(usageHints 提示词引导);若误判率高,可升级为路由中间件(`beforeModel` 跑轻量 router 判模式,`augmentPrompt` 注入模式指令)。`planner-demo`(`/examples/planner-demo/`)演示完整闭环。

> 子 agent 边界:默认**只读**(不改页面)、**过程隔离**(只回结论)、**递归物理切断**(maxDepth)、**signal 继承**(主停则子停)。

**示例**:`npm run dev` 后访问
- `/examples/subagent-demo/` —— 方案并行调研(spawn_agents 基础)

### 6.10 Verify 自检(Agent 返回前验证 + 自纠)

Agent 给出最终答**之前**,自动跑一次 `check` 验证结果;不通过则把 feedback 回灌给 Agent,驱动它修正后再答(限 `maxAttempts` 次,防死循环)。**默认关闭**(烧 token),需显式开启。

```ts
createChatSdk({
  capabilities: { verify: true },      // 开启(默认关)
  verify: {
    maxAttempts: 2,                     // 自纠上限(默认 2)
    // check: async ({ messages, state }) => ({ ok: true }),  // 自定义;省略 → 默认写后读回验证
  },
})
```

**内置 check(默认)**:`createWriteBackCheck()` —— Agent 写了主数据(`write`/`set/edit/delete_data`)后,读回值确认写入生效 + 符合 schema。读回根对象自动取 `data.bind`(经 getter,适配 `sdk.setData` 运行时替换 bind;旧 windowProps 模式回退 `window`):
- **写后读回**:set/edit 后读回为空 → 「未生效」反馈;读回不符合 schema → 反馈
- **delete 语义**:delete 后读回空 = 删除成功(放行);仍有值 → 「未删干净」
- **跳过被拒写**:写被合法拒绝(schema 校验失败 / 范围拒绝 / 白名单 `PATH_DENIED`)时**不误报**(读回无值是预期)
- dataOps 写入同步,check 读回无需 `await`

**自定义 check**:写领域相关的验证(业务规则、不变量)。好 check 返回**具体可操作**的 feedback:
```ts
verify: {
  check: async ({ messages, state }) => {
    const last = messages[messages.length - 1]
    // ✗ 不要「结果不对」这种模糊话;✓ 给具体可修的指引
    return { ok: false, feedback: '回复缺少价格字段,请补充' }
  },
}
```

**何时用**:Agent 改主数据后想确保写入生效 / 符合预期。**何时不用**:纯问答(无写操作,check 自动放行)、对延迟敏感(自纠多跑 LLM 轮次)。

**查看状态**:`agent.inspect().verify` → `{ enabled, maxAttempts }`。

> **对抗验证**(`verify.adversarial: true`):check 通过后 spawn 一个**配只读工具**的"找茬"子 agent(refute 姿态,可实证读回主数据检查而非臆测,突破自审偏差)再审一遍。默认关(每次烧一个多轮子 agent token)。
>
> **策略**:开 verify 即用 `createWriteBackCheck`(写后读回 + schema 校验,低成本**必备**);adversarial 作可选增强(语义复杂场景才开)。

### 6.11 Approval 人工确认(工具调用前 human-in-the-loop)

人工确认分**主动**与**被动**两侧,默认行为不同:

- **主动侧(默认开启)**:装载 `request_human_confirmation` 工具,LLM 在**不确定 / 多方案 / 高风险不可逆**时主动调用征询用户(把选项做成可点选按钮,而非自行猜测);usageHints 自动注入默认提示词引导何时调用(无需你写 prompt)。`humanConfirm: false` 关闭。
- **被动侧(白名单,默认关闭)**:`approval.tools`/`approval.confirm` 指定的工具调用前自动弹确认框,用户「允许/拒绝」后才执行——防 AI 误改页面/误删数据。需传 `approval` 选项声明(业务相关,无法自动推断)。

```ts
createChatSdk({
  // ... 其他配置
  // humanConfirm: true,  // 主动征询(默认开启,不传也开;false 关闭)
  approval: {
    tools: ['write'], // 被动:需确认的工具名(simple 模式主入口;advanced 模式可列底层 set/edit/delete_data)
    // confirm: (name, args) => args?.path?.startsWith('Editor.'),  // 自定义判定(优先于 tools)
    // timeoutMs: 30000,  // 超时自动拒绝(0=不超时,默认)
    // humanConfirmTool: false,  // 传 approval 时亦可关主动侧(等价于顶层 humanConfirm:false)
  },
})
```

**机制**:`wrapToolCall` 拦截 → 发 `approval_request` 流式事件(带 `resolve` 回调,`resolve(boolean | string)`)→ 内置 `ChatDialog` 渲染确认条:
- 被动确认:展示工具名 + 参数预览 + 允许/拒绝
- 主动征询:展示问题(question)/可选方案(options)/推荐(recommendation),多方案时渲染选项按钮供用户选

用户点击 `resolveApproval(true/false/方案)` → 中间件收口:允许则执行,拒绝则返回结构化 error(LLM 可据此改方案,如换只读路径)。

**主动征询示例**:LLM 调 `request_human_confirmation({ question: '主标题改红色还是蓝色?', options: ['红色','蓝色'], recommendation: '红色更醒目' })`,UI 弹出问题 + 两个选项按钮,用户点「红色」→ 工具返回 `用户选择了:红色` → LLM 据此执行。

**abort 联动**:用户「停止生成」或进入时 signal 已 abort → 自动拒绝(防永久挂起);`timeoutMs` 超时也自动拒绝。

**headless 自建 UI**(`ui:false`):自监听 `approval_request` 事件,事件对象含 `{ toolName, args, resolve }`,自建确认框后调 `resolve(true/false/方案)` 收口。

> **开启条件速查**(「主动征询如何开启」):
> - **主动征询默认开启**(不猜测):不传任何选项也装载 `request_human_confirmation` 工具 + 注入默认提示词,LLM 遇不确定/多方案/高风险时主动征询。
> - 关闭主动征询:`humanConfirm: false`(顶层),或传 `approval` 时用 `approval.humanConfirmTool: false`。
> - **被动确认仍需声明**(业务相关,无法自动推断):`approval: { tools: [...] }` 指定写操作白名单;不传则无被动拦截。
> - 主动征询的「何时该调」由 `usageHints` 中间件自动注入默认提示词,无需自己写 prompt。

> **与 verify 区别**:approval = 执行**前**人工把关(防误改);verify = 返回**后**自动自纠(防错答)。二者可叠加。
> - `nested-demo`(`/examples/nested-demo/`):综合演示嵌套树编辑 + 写操作被动确认 + checkpoint。
> - `human-confirm-demo`(`/examples/human-confirm-demo/`):聚焦 AI 主动征询——开放性需求 → 弹可点选方案按钮 → 用户选定 → 落地写操作再弹一次被动确认,两层 human-in-the-loop 一次看清。

### 6.12 Checkpoint 会话级回滚(回到上次正常时)

流程异常、AI 改坏页面、或走偏时,一键回退到上一个正常状态。默认关闭,传 `checkpoint` 选项开启。

```ts
const sdk = createChatSdk({
  // ... 其他配置
  checkpoint: true,            // 或 { maxCheckpoints: 5, auto: true }
  data: { schema, bind, description? },  // checkpoint 整体快照主数据
})
sdk.mount()

// 一键回退(对话历史 + 主数据 + vfs + todos 整体还原)
sdk.restoreLastCheckpoint()
sdk.listCheckpoints()  // 查看可用回退点
```

**自动存档**(`auto` 默认 true):每轮 agent 行动前(beforeModel 首次)自动存一个 checkpoint = 上一正常态 + 本轮 user 消息。回滚后**保留 user 消息、撤销 agent 本轮改动**,可直接重试本轮。

**快照内容**(整体,区别于 dataOps 的快照):对话历史 + 主数据 + vfs + todos。仅存内存(会话级,非持久化);FIFO 限长(默认 5)。

**三个回滚入口**:
- **UI**:ChatDialog error-bar「↩ 回退」按钮 + footer 常驻回退按钮(`canUndo` 时显示)——用户一键回退
- **LLM 工具**:`restore_last_checkpoint`(流程异常/改坏页面时 AI 自纠回退)、`list_checkpoints`
- **SDK API**:`sdk.restoreLastCheckpoint()` / `sdk.listCheckpoints()`(headless 自建 UI 用)

**就地还原**:主数据就地清空+重填(保留 Vue reactive 容器引用,UI 自动更新);messages 用 splice 替换内容(保留同一响应式数组引用);vfs 清空重填;todos reset。

> **与 dataOps 快照区别**:dataOps 快照(`restore_data`)随 set/edit/delete 自动入栈,单次回退最近一次写;checkpoint 整体,回滚到某轮起点(跨多次写 + 对话 + vfs + todos)。二者叠加:小错用 dataOps 精细修,大错用 checkpoint 整体回。`nested-demo` 已开启 `checkpoint: true`。

### 6.10 MCP(外部工具接入)

连远程 MCP server,动态把其 tools 注入 agent(标准化扩展工具生态):

```ts
createChatSdk({
  mcp: [
    { transport: 'http', url: 'https://mcp.example.com/mcp' },  // StreamableHTTP(推荐,fetch)
    { transport: 'websocket', url: 'wss://mcp.example.com/ws' },
    // { transport: 'sse', url: '...' },  // 需 eventsource(旧式)
  ],
})
```

- **浏览器仅远程 transport**:`http`(fetch)/ `websocket`(原生 WebSocket)/ `sse`(eventsource);不支持 `stdio`(无 node)。
- **动态加载**:仅配了 `mcp` 才加载 `@modelcontextprotocol/sdk`(optional peerDep;ESM/UMD 集成方按需装,IIFE 已打进)。
- **故障隔离**:单 server 连接失败跳过 + `console.warn`,不影响主 agent 与其他 server。
- MCP 工具自动出现在 `agent.inspect()` 与 DebugDrawer「Agent 信息」tab。

### 6.9 onEvent 事件回调(订阅常用时机)

`createChatSdk({ onEvent })` 提供一个轻量事件回调,订阅 Agent 运行中的常用时机,用于**外部联动**(宿主页面响应式刷新、埋点、日志、自建 UI 同步),替代轮询。UI 与 headless 模式均生效。

**事件类型**(`SdkEvent`):

| 事件 | 时机 | 字段 |
|---|---|---|
| `data_change` | Agent 调写工具后(`write` 高层入口,或底层 `set`/`edit`/`delete`/`restore_data`) | `operation`(`set`/`edit`/`delete`/`restore`,`write` 按 args 推断) / `value`(改后值,即整个 bind) |
| `message_update` | 每轮 Agent 结束 | `count`(消息数) |
| `tool_call` | 工具调用前(stream 模式) | `name` / `args` |
| `tool_result` | 工具返回后(stream 模式) | `name` / `result` / `status` |
| `text` / `reasoning` | 流式文本/思考增量(stream 模式) | `delta` |
| `round_start` | 每轮模型调用开始 | `round` |
| `subagent` | 子 agent 工具进度 | `taskId`/`label`/`kind`/`name`/... |
| `done` | 一轮回复完成(stream 模式) | `content` |
| `usage` | 每轮 LLM 调用后(若 provider 返回 usage) | `round` / `usage`(本轮 prompt/completion/total_tokens) / `cumulative`(累计) |
| `session_restored` | storage 恢复会话快照后(mount 自动恢复 / `switchSession` 切到已存会话) | `sessionId` / `rounds`(恢复的消息数) |
| `error` | 模型调用/工具抛错 | `message` |

> ⚠️ `approval_request` 不外发(UI 已处理,避免集成方误调 `resolve` 双重收口)。
> ⚠️ `tool_call`/`tool_result`/`text`/`done` 等流式事件仅在 **stream 模式**触发(UI 默认走 stream;命令式 `sdk.send` 走 invoke 无流式事件,但 `data_change`/`message_update`/`error` 仍会发)。

**示例**(宿主页面响应式刷新,替代 `setInterval` 轮询):

```ts
createChatSdk({
  /* ... */
  onEvent(event) {
    if (event.type === 'data_change') {
      // Agent 改了主数据 → 实时刷新你的 UI 镜像
      renderState()
    } else if (event.type === 'tool_call') {
      analytics.track('agent_tool_call', { name: event.name })
    } else if (event.type === 'error') {
      console.error('agent error', event.message)
    }
  },
}).mount()
```

> 更深度的拦截/增强(改 messages、包裹模型调用、贡献工具)用**自定义中间件**(见下节);`onEvent` 适合只读观察。

**`sdk.hook(handler)` —— 运行时动态订阅(可多个监听器、可取消)**

除构造时 `onEvent`,实例还提供 `hook` 方法,运行时随时订阅,可注册多个监听器,返回取消函数:

```ts
const sdk = createChatSdk({ /* 不必传 onEvent */ }).mount()

// 订阅 1:宿主页面响应式刷新
const off1 = sdk.hook((event) => {
  if (event.type === 'data_change') renderUI()
})

// 订阅 2:埋点(与订阅 1 共存,互不影响)
const off2 = sdk.hook((event) => {
  if (event.type === 'tool_call') analytics.track('tool', { name: event.name })
})

// 取消订阅
off1()
off2()
```

`onEvent` 与 `hook` 互补:前者构造时单回调,后者运行时多监听器;两者可并存。事件类型与过滤规则同上(`approval_request` 不外发;流式事件仅 stream 模式)。

### 6.10 便捷 API(导出/导入/用量/审计)

除事件订阅外,SDK 实例还提供几个便捷 API,覆盖备份迁移、用量统计、审计追溯:

| API | 作用 | 备注 |
|---|---|---|
| `sdk.exportData()` | 返回主数据 `bind` 的**深拷贝**(JSON 序列化) | 备份/迁移用;改返回值不影响原 bind;dataOps 关闭或无 data 返回 `null` |
| `sdk.importData(json, opts?)` | 整体替换 `bind`(就地还原,保留 reactive 引用) | 默认经 `schema` 校验,不合法返回 `{ok:false,error}`;`opts.validate:false` 跳过校验;`opts.emit:false` 不发 `data_change` |
| `sdk.setSkills(skills)` | 运行时替换整个 skill 列表(同名覆盖) | 立即生效:下轮 system prompt 索引重渲染;清 skill 全文缓存与本轮已加载记录,下次 `load_skill` 取最新全文(含 vfs doc);需开启 skills(默认开) |
| `sdk.invalidateSkillCache(name?)` | 清 skill 全文缓存(主动失效) | 不传 `name` 清全部,传 `name` 清指定;动态 skill 内容变化时用;下次 `load_skill` 重新 `getContent`/`readSkillDoc`;需开启 skills(默认开) |
| `sdk.addSkill(skill)` | 用户创建 skill(运行时 + 独立持久化) | `skill: { name, description, prompt \| getContent \| doc }`;自动加入 agent,持久化由**独立 SkillStore**管理(默认 indexedDB,与 `storage` 分离,即使 `storage:false` 也持久化,跨刷新恢复);同名覆盖;需开启 skills(默认开)+ `skillStorage` 非 `false` 才持久化 |
| `sdk.removeSkill(name)` | 删除用户创建的 skill | 仅删用户创建的(`addSkill` 加的),不删集成方 `skills` 选项传入的;从 SkillStore 移除;返回 `boolean`(是否删除成功);需开启 skills |
| `sdk.listUserSkills()` | 列出用户创建的 skill 名 | 返回 `string[]`(仅用户创建的,不含 initialSkills);UI 面板刷新用 |
| `sdk.getUserSkill(name)` | 读取用户创建的 skill 详情 | 返回 `{ name, description, content }` 或 `undefined`(不存在时);SkillPanel 编辑时调 |
| `skillStorage` 选项 | 用户 skill 独立持久化配置 | 默认 `{ backend: 'indexed' }`(与 `storage` 分离);`false` 关闭(仅当前会话);`id` 手动指定同一 id → 跨页面/跨 agent 复用同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离 |
| `SkillPanel` 组件 | 用户创建/编辑/删除 skill 的 UI 面板 | 内置 `ChatDialog` 头部「Skill 管理」按钮已集成(支持创建/编辑/删除);集成方也可 `import { SkillPanel } from 'page-agent-sdk'` 单独用于自建 UI |
| `sdk.usage` | 累计 token 用量 `{prompt_tokens, completion_tokens, total_tokens}` | 每轮 LLM 调用累加;无调用时全 0;单轮明细经 `onEvent('usage')` 外发 |
| `onAudit(entry)` 选项 | 数据写操作结构化审计回调(独立于 `debug`) | 每次 `set`/`edit`/`delete`/`restore` 经此回调外发 `{op, jsonPath, opDetail, timestamp, success, error?}`;合规审计/操作追溯 |

```ts
// 备份 + 恢复
const backup = sdk.exportData()
localStorage.setItem('backup', JSON.stringify(backup))
// ...出问题后恢复
sdk.importData(JSON.parse(localStorage.getItem('backup')))

// 用量统计
onEvent(e => { if (e.type === 'usage') costMeter.add(e.usage) })
console.log(sdk.usage)  // 累计

// 审计
createChatSdk({
  onAudit: (entry) => auditLog.append(entry),  // 无需 debug:true
  // ...
})
```

### 6.11 运行时动态重配置(tools / llm / memory / subagents)

除 `setData`/`setSkills` 外,SDK 还支持运行时动态重配置 **工具 / LLM / memory / 预声明子 agent**,全程零破坏(不调用 = 现状行为),无需重建 agent(保留对话历史与中间件状态)。所有 setter 触发 `infoTick++` → DebugDrawer 实时刷新;`inspect()` 的 tools/model/memory/subagent.subagents 动态取最新。

| API | 作用 | 备注 |
|---|---|---|
| `sdk.setTools(tools)` | 运行时替换**用户工具**集 | 内置工具(由 `capabilities` 控制)不动;内部 `rebindTools` 重新绑定到 LLM,下一轮即生效;支持按权限/业务阶段/A-B 实验动态切换工具组 |
| `sdk.addTool(tool)` | 运行时追加用户工具 | 去重 by name;内置不动 |
| `sdk.removeTool(name)` | 运行时移除用户工具 | 内置不动;返回是否移除成功 |
| `sdk.setLlm(llm)` | 运行时切换 LLM | 参数 `BaseChatModel` 或 `LLMConfig`(内部构造 `ChatOpenAI`);rebind + 重解析模型能力(`contextWindow`/`maxOutputTokens`);`summaryLlm` 不受影响;新模型不支持 `bindTools` 则工具调用失效(agent 不崩) |
| `sdk.setMemory(source)` | 运行时更新持久指令 memory | 支持 `string` 与同步/异步函数;异步函数后台求值,下一轮 `augmentPrompt` 注入最新;`setMemory('')` 清空(空串跳过注入) |
| `sdk.refreshMemory()` | 重新求值当前 memory 函数 source | RAG 文档更新后强制刷新;返回最新文本;字符串 source 直接返回当前值 |
| `sdk.setSubagents(configs)` | 运行时替换预声明子 agent | 重新生成 `use_<id>` 委派工具 + 触发 rebind;需创建时配 `subagents:[]`(空数组也启用 controller,支持「初始无子 agent,运行时动态 add」) |
| `sdk.addSubagent(config)` | 运行时追加预声明子 agent | id 重复 warn 跳过;需创建时配 `subagents:[]` |
| `sdk.removeSubagent(id)` | 运行时移除预声明子 agent | 返回是否移除成功;需创建时配 `subagents:[]` |

```ts
// 场景 1:按业务阶段切换工具组(浏览期只读 / 编辑期可写)
sdk.setTools([readOnlyTool1, readOnlyTool2])
// ...用户点「编辑」按钮
sdk.setTools([writeTool1, writeTool2, readOnlyTool1])

// 场景 2:配额耗尽切便宜模型 / 复杂任务切强模型
sdk.setLlm({ apiKey, baseUrl, model: 'gpt-4o-mini' })  // 省钱
sdk.setLlm({ apiKey, baseUrl, model: 'gpt-4o' })      // 复杂任务

// 场景 3:运行时追加业务约束到 memory
sdk.setMemory('当前用户是 VIP,优先展示会员价;回答简洁。')

// 场景 3.5:异步加载 RAG 文档到 memory(支持 string 与同步/异步函数 source)
// - 创建时直接传异步函数:后台预求值,首次对话前尽量就绪
createChatSdk({
  memory: async () => await fetch('/kb/faq.md').then((r) => r.text()),
  /* ... */
})
// - 运行时切换为异步函数(如用户切换了知识库)
sdk.setMemory(async () => await fetch('/kb/product-v2.md').then((r) => r.text()))
// - 文档更新后强制刷新(重新求值当前函数 source)
await sdk.refreshMemory()
// - 也可以传同步函数读运行时变量
let lang = 'zh'
sdk.setMemory(() => `请用${lang}回答。`)
lang = 'en' // 变量变了,需 refreshMemory() 才重求值(函数 source 默认缓存首次结果)

// 场景 4:运行时根据任务类型动态委派子 agent
// (创建时配 subagents:[] 占位启用 controller)
sdk.addSubagent({ id: 'translator', description: '中英互译子 agent', systemPrompt: '你是翻译助手。' })
// ...任务结束移除
sdk.removeSubagent('translator')
```

> **说明**:`setSystemPrompt` / `setMiddleware`(中间件数组运行时替换)仍未实现,改动深入 harness 核心,留待后续;当前可用 `setData`/`setSkills`/`augmentSystem` 钩子覆盖大部分动态 system prompt 场景。详见 `doc/roadmap.md` #5。

### 6.12 LLM 连接:直连 / 代理 / OpenAI 兼容端点

SDK 兼容任意 OpenAI Chat Completions 协议端点。三种连接方式按「apiKey 是否暴露到浏览器」选:

#### 方式一:直连(浏览器持有 apiKey)

适合内部工具 / 开发期 / apiKey 可暴露的场景。`LLMConfig.baseUrl` 指向任意 OpenAI 兼容端点:

```ts
import { createChatSdk } from 'page-agent-sdk'

createChatSdk({
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',  // deepseek / qwen / glm / 文心 等 OpenAI 兼容端点
    model: 'deepseek-v4-pro',
    temperature: 0.3,
    // 2.12.2+:透传额外请求 body 参数(如 deepseek thinking)
    extraBody: { thinking: { type: 'enabled' } },
    // 透传 configuration 额外字段(如 headers/timeout/customFetch),与 baseUrl 合并
    extraConfig: { timeout: 60000 },
  },
  // ...其他配置
}).mount()
```

> **主流国产模型 OpenAI 兼容端点**:
> - DeepSeek:`https://api.deepseek.com/v1`
> - 通义千问:`https://dashscope.aliyuncs.com/compatible-mode/v1`
> - 智谱 GLM:`https://open.bigmodel.cn/api/paas/v4`
> - 文心一言:`https://qianfan.baidubce.com/v2`

#### 方式二:代理模式(防 apiKey 泄露)

适合公开网站 —— 浏览器只持有用户 token,真实 apiKey 留在服务端代理。用 `createProxyLlm`:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

createChatSdk({
  llm: createProxyLlm({
    mode: 'proxy',           // 代理模式:浏览器 → 你的代理 → LLM 服务
    proxyUrl: '/api/llm-proxy',  // 你的后端代理地址
    userToken: getUserToken(),   // 用户登录态(由你的后端校验),非 apiKey
    // 代理后端负责:校验 userToken → 注入真实 apiKey → 转发到 LLM → 返回 OpenAI 格式
  }),
  // ...其他配置
}).mount()
```

#### 方式三:直连模式(代理 + 浏览器持有 apiKey)

`createProxyLlm` 的 `direct` 模式 —— 走代理但 apiKey 在浏览器(适合代理只做转发/审计,不持有 key):

```ts
createChatSdk({
  llm: createProxyLlm({
    mode: 'direct',
    proxyUrl: '/api/llm-direct',
    apiKey: 'sk-xxx',
    model: 'deepseek-v4-pro',
  }),
}).mount()
```

#### 三种方式对比

| 方式 | apiKey 位置 | 适用场景 | 安全性 |
|---|---|---|---|
| 直连(`LLMConfig`) | 浏览器 | 内部工具 / 开发期 | 低(key 暴露) |
| 代理 `proxy` 模式 | 服务端 | 公开网站 | 高(浏览器只有 userToken) |
| 代理 `direct` 模式 | 浏览器 | 代理只做转发/审计 | 中(key 暴露但走代理) |

> **代理后端要求**:只需返回 OpenAI Chat Completions 兼容格式(`{ choices: [{ message: { role, content } }] }`),SDK 即可对接。详见 `examples/proxy-demo/`(需 `npm run proxy:mock` 起本地 mock 代理)。

#### 运行时切换 LLM

配合 §6.11 动态重配置,运行时切换 LLM(含 `extraBody`/`extraConfig`):

```ts
// 配额耗尽切便宜模型 + 开启 thinking
sdk.setLlm({
  apiKey, baseUrl, model: 'deepseek-v4-pro',
  extraBody: { thinking: { type: 'enabled' } },
})
```

## 8. 高级:自定义中间件

最彻底的外接方式 —— 把你的逻辑插到 Agent 生命周期的任意节点,和内置的 todos/skills/memory 平起平坐。

**8 个钩子**:

| 钩子 | 时机 | 典型用途 |
|---|---|---|
| `beforeAgent(state)` | Agent 启动 | 初始化状态 |
| `beforeModel(req)` | 每轮模型调用前 | 更新 state |
| `augmentPrompt(state)` | 每轮渲染 system prompt | **增强提示词**(返回追加段) |
| `compressInput(msgs)` | 构建上下文前 | 压缩历史 |
| `wrapModelCall(req, next)` | 包裹模型调用 | **拦截/改写请求与响应** |
| `afterModel(res, state)` | 模型返回后 | 观察/埋点 |
| `wrapToolCall(ctx, next)` | 包裹工具执行 | **审计/拦截/改写工具** |
| `tools` | (字段,非钩子) | 贡献自定义工具 |

> 执行顺序:before 类正序、after 类逆序、wrap 类洋葱。用户中间件在内置之后注入。

**例子 1:埋点/审计**(最常用)

```ts
import { createChatSdk, type Middleware } from 'page-agent-sdk'

const analytics: Middleware = {
  name: 'analytics',
  afterModel: (res) => {
    console.log('[埋点] 模型响应', { len: res.content.length, tools: res.toolCalls.length })
  },
  wrapToolCall: async (ctx, next) => {
    const t = Date.now()
    const result = await next(ctx)
    console.log('[埋点] 工具', ctx.name, `${Date.now() - t}ms`, result.status)
    return result
  },
  afterAgent: () => console.log('[埋点] 对话结束'),
}

createChatSdk({ /* ... */ middleware: [analytics] })
```

**例子 2:Prompt 增强**(注入运行时上下文)

```ts
const injectCtx: Middleware = {
  name: 'inject-ctx',
  augmentPrompt: () => `当前时间:${new Date().toLocaleString('zh-CN')}\n域名:${location.hostname}`,
}
```

**例子 3:拦截写操作**

```ts
const guard: Middleware = {
  name: 'guard',
  wrapToolCall: async (ctx, next) => {
    if (ctx.name === 'write' && ctx.args.path === 'app.critical') {
      return { content: '该字段禁止 Agent 修改', status: 'error' }  // 不调 next = 拦截
    }
    return next(ctx)
  },
}
```

> `page-demo/App.vue` 里有一个可直接运行(`npm run dev`)的埋点示例中间件。

## 8. 命令式 API

`createChatSdk()` 返回一个 `ChatSdk` 实例:

```ts
const agent = createChatSdk({ /* ... */ })

await agent.mount()                          // 渲染对话框(异步:含持久化恢复)
await agent.send('把标题改成 Hello')          // 命令式发送,返回 AI 回复
const newId = await agent.switchSession()    // 切换/新建会话(storage 未开启时抛错)
const reply = await agent.stream(msgs, cb)   // 底层流式(高级:自行管理历史)
agent.unmount()                              // 卸载

// 乐观锁冲突人工介入(内置 UI 自动处理;headless 自建 UI 时用)
agent.pendingConflict                        // 响应式 ref<PendingConflict|null>,有冲突时非 null
agent.resolveConflict('keep_external')       // 收口挂起的冲突:'keep_external'|'overwrite'|'restore'
agent.hook((e) => { if (e.type === 'conflict') { /* e.conflict 含冲突详情 */ } })
```

`send()` 与 UI 对话框共享同一份消息历史(唯一来源),命令式和 UI 可混用。

**headless 模式**(自建 UI):`ui: false` 不渲染内置对话框,`agent.messages` 暴露**响应式消息数组**,集成方自行渲染 + 用 `send`/`stream` 驱动。适合 React/原生/自定义 UI。
```ts
const agent = createChatSdk({ llm, ui: false, id, storage })
await agent.mount()
agent.messages                // 响应式数组,自建 UI 据此渲染
await agent.send('...')       // 发送(数组自动更新)
agent.unmount()
```

**复用内置 UI 模块**:headless 模式下也可 `import { ChatDialog, useChat }` 复用内置对话框组件与流式/重试/停止/重新生成逻辑(`ChatDialog` 接 `fetchStream`/`getInfo` 等 props),而不必从零实现 UI。

**主题定制**:`ChatDialog`/`DebugDrawer` 暴露 CSS 变量(`--cs-primary` 等,默认中性主题)与 props(`showAvatar`/`showTyping` 关头像/打字动画)。覆盖变量即可换主题:
```css
.pa-chat { --cs-primary: #0ea5e9; }  /* 改主色(类名按实际容器) */
```

**预设**(常见场景一键装载):
```ts
import { createChatSdk, presets } from 'page-agent-sdk'
createChatSdk({ ...presets.pageBuilder, container: '#root', llm, data })  // 页面构建助手
createChatSdk({ ...presets.researcher, container, llm })                         // 并行调研
createChatSdk({ ...presets.minimal, container, llm, data })               // 极简(关高级能力)
```
可用预设:`pageBuilder`(读写 window 驱动页面)、`researcher`(spawn_agents 并行调研)、`minimal`(关闭所有高级能力,省 token)。

### 8.5 服务端(Node.js)用法

SDK 核心是**框架无关的 JS**,可在 Node.js 服务端跑(headless 模式),用作后端 Agent(自定义工具编排、文档抓取、子 agent 并行、自检自纠)。

**服务端配置要点**:
- `ui: false` —— headless,不渲染 ChatDialog(服务端无 DOM)
- `capabilities: { dataOps: false, fetch: false }` —— 关浏览器依赖工具(dataOps 需 `window` 对象;`fetch_document` 需 `fetch`,Node 18+ 有全局 fetch,可保留)
- `storage: 'memory'` —— 用内存后端(服务端无 IndexedDB/localStorage);不传则纯内存不持久化
- 用 `tools` 注入你的业务工具(`defineTool`),`send`/`stream` 命令式驱动

**示例**(Node.js 后端 Agent + 自定义工具):

```ts
import { createChatSdk, defineTool, z } from 'page-agent-sdk'

const add = defineTool({
  name: 'add', description: '两数相加',
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: (args) => `${args.a + args.b}`,
})

const sdk = createChatSdk({
  container: null, ui: false, id: 'server-agent',
  storage: 'memory',
  llm: { apiKey: process.env.AI_API_KEY, baseUrl: '...', model: '...' },
  systemPrompt: '你是计算助手,用 add 工具做加法。',
  capabilities: { dataOps: false, fetch: false },
  tools: [add],
})
await sdk.mount()
const reply = await sdk.send('3 加 5 等于多少?')
console.log(reply) // AI 调 add 工具 → "3 + 5 = 8"
```

**服务端可用能力**:自定义工具 / `fetch_document`(Node 18+)/ 子 agent / verify 自检 / vfs 工作区 / context 压缩 / memory / onEvent 事件回调 / dataOps 主体(`read`/`write`/`get`/`edit`/`delete`/`query`/`search`,传任意 `data.bind` 对象即可,不依赖 `window`)
**服务端不可用**:ChatDialog UI(需 DOM)/ `eval_script`(依赖 Web Worker)/ IndexedDB·localStorage·sessionStorage 持久化(用 `memory` 替代)

> 注:`eval_script` 依赖 Web Worker,属 dataOps,关掉即不装。MCP 远程工具(http/sse/websocket)在 Node 也可用(动态 import `@modelcontextprotocol/sdk`)。

### 8.6 代理连接(防 apiKey 泄露)

浏览器直连 LLM API 会把 `apiKey` 暴露在前端代码/网络请求中,上线后任何人都能从 DevTools 抓走你的 key 盗刷。**生产环境必须经服务端代理**:浏览器只持用户 token,你的服务端注入真实 `apiKey` 转发到 LLM API。

SDK 提供 `createProxyLlm` 工厂统一管理两种接入模式,dev/prod 切换不改代码结构:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

// ===== 上线:代理模式(防泄露)=====
// 浏览器只持 userToken,服务端注入真实 apiKey 转发
const sdk = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'proxy',
    baseUrl: '/api/llm',        // 你的代理地址(同源避免 CORS)
    userToken: getUserToken(),   // 用户登录态 token(代理验证后换真实 key)
    model: 'deepseek-chat',
    temperature: 0.3,
    // 可选:token 过期自动刷新(401 时调一次,返回新 token 重试)
    refreshToken: async () => (await fetch('/api/refresh')).json().then(r => r.token),
    // 可选:附加 headers(如租户标识)
    headers: { 'X-Tenant': 'acme' },
  }),
  // ...其余配置
})

// ===== 开发:直连模式(便捷)=====
// 浏览器持真实 apiKey,仅本地开发用(生产会泄露)
const sdkDev = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'direct',
    apiKey: 'sk-xxx',            // 真实 key(仅开发环境)
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }),
  // ...其余配置
})
```

**两种模式对比**:

| | `proxy`(代理,上线) | `direct`(直连,开发) |
|---|---|---|
| apiKey 位置 | 服务端(浏览器不可见) | 浏览器(DevTools 可见) |
| 浏览器持有 | userToken(登录态) | 真实 apiKey |
| token 刷新 | 支持(401 自动重试) | 不需要 |
| 自定义 headers | 支持 | 不需要 |
| 适用场景 | 生产环境 | 本地开发/内网工具 |

**代理服务端实现要点**(你的后端,SDK 不管):
- 接收浏览器请求,验证 userToken,注入真实 `apiKey`,转发到 LLM API
- 处理 CORS(同源最省事,或设 `Access-Control-Allow-*`)
- 透传 SSE 流式响应(流式生成不能缓冲)
- 透传 tool calling 字段(`tools`/`tool_choice`/`tool_calls`)
- 可选:用量统计、限流、按用户配额

> `summaryLlm`(摘要专用模型)若也要走代理,同样用 `createProxyLlm({ mode:'proxy', ... })` 构造后传入 `summaryLlm` 选项。

#### 8.6.1 支持的接口格式

`createProxyLlm` 内部用 `ChatOpenAI`,所以**两种模式都要求接口是 OpenAI Chat Completions 兼容格式**。区别只在 apiKey 放哪里,不在协议格式。

**请求**(浏览器 → 代理):

```
POST {baseUrl}/chat/completions
Authorization: Bearer {userToken}      ← proxy 模式传用户 token
Authorization: Bearer sk-xxx           ← direct 模式传真实 key
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "..." }, ...],
  "tools": [...],          // tool calling 字段(可选)
  "tool_choice": "auto",
  "temperature": 0.3,
  "max_tokens": 16384,
  "stream": true           // 流式时为 SSE
}
```

> `ChatOpenAI` 自动在 `baseUrl` 后拼接 `/chat/completions`,所以 `baseUrl` 传 `/api/llm` 即可,实际请求打到 `/api/llm/chat/completions`。

**响应**(代理 → 浏览器),需返回 OpenAI 兼容格式:

非流式:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{ "message": { "role": "assistant", "content": "...", "tool_calls": [...] }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
}
```

流式(SSE):
```
data: {"choices":[{"delta":{"content":"你好"}}]}
data: {"choices":[{"delta":{"tool_calls":[...]}}]}
data: [DONE]
```

**401 刷新**(仅 proxy 模式):代理返回 `401` 时,SDK 自动调 `refreshToken` 拿新 token,重试一次原请求。

**不支持的格式**:非 OpenAI 协议(如原生 Claude `/v1/messages`、Gemini `generateContent`)需后端做协议转换,转换后仍以 OpenAI 格式返回给 SDK;自定义 RPC / GraphQL 同理,后端转换成 OpenAI 兼容响应即可。

#### 8.6.2 代理服务端示例(Node.js)

仓库自带 mock 代理 server(`scripts/proxy-mock-server.ts`),`npm run proxy:mock` 启动,监听 `http://localhost:3002`:

- `POST /chat/completions` —— 验证 `Authorization: Bearer {userToken}`,注入真实 apiKey(从服务端 `.env` 读 `VITE_AI_API_KEY`),转发到上游 LLM API(`VITE_AI_BASE_URL`),透传 SSE 流
- `POST /api/refresh` —— token 刷新演示端点,返回新 token
- 演示 token 规则:`demo-token-xxx` 正常 / `demo-token-expired` 返 401 触发刷新

最小可用代理(生产参考,Node.js 原生 `http`):

```ts
import http from 'node:http'

const REAL_API_KEY = process.env.REAL_API_KEY  // 服务端环境变量,浏览器拿不到
const UPSTREAM = 'https://api.deepseek.com/v1'

http.createServer(async (req, res) => {
  // CORS(开发跨域;生产建议同源去掉)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url !== '/chat/completions' || req.method !== 'POST') {
    res.writeHead(404); res.end('not found'); return
  }

  // 1. 验证用户 token
  const userToken = req.headers.authorization?.slice(7)
  if (!userToken || !await verifyUserToken(userToken)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid token' } }))
    return
  }

  // 2. 读 body
  const body = await new Promise<Buffer>(r => {
    const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c)))
  })

  // 3. 注入真实 apiKey 转发(透传 tools/tool_calls/stream)
  const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REAL_API_KEY}` },
    body,
  })

  // 4. 透传响应(SSE 流式直接 pipe,不缓冲)
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
  if (upstream.body) {
    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    while (true) { const { done, value } = await reader.read(); if (done) break; res.write(dec.decode(value)) }
  }
  res.end()
}).listen(3002, () => console.log('proxy @ 3002'))

async function verifyUserToken(token: string): Promise<boolean> {
  // 接你的鉴权:JWT 校验 / 查 session / 查用户表 …
  return token.startsWith('demo-token-')
}
```

**生产部署要点**:
- 真实 apiKey 只存服务端环境变量(或密钥管理服务),**绝不**下发浏览器、不进 git
- 同源部署(`/api/llm` 与前端同域)省 CORS;跨域需配 `Access-Control-Allow-*`
- 流式响应用 `pipe` 逐块转发,不要 `await res.json()` 缓冲(会破坏流式生成)
- 透传 `tools`/`tool_choice`/`tool_calls` 字段(Agent 的 tool calling 依赖这些)
- 可选:按 userToken 计费用量、限流、按用户配额、审计日志

#### 8.6.3 完整示例页面

仓库 `examples/proxy-demo/` 提供完整可运行示例:

```bash
# 终端 1:启动代理 server(读 .env 的真实 apiKey)
npm run proxy:mock
# → http://localhost:3002,真实 apiKey 在服务端

# 终端 2:启动 dev
npm run dev
# → 访问 http://localhost:3000/examples/proxy-demo/
```

示例页面演示:
- 浏览器只持 `userToken`(`demo-token-xxx`),DevTools 看不到真实 apiKey
- 切换为 `demo-token-expired` → 发消息触发 401 → SDK 自动调 `refreshToken` 刷新重试(界面显示刷新次数)
- 附加 `X-Tenant` header 演示自定义 header 透传

## 9. 框架无关 / CDN 集成

宿主页面无需任何构建链路,用 IIFE 全量包一行接入:

```html
<!DOCTYPE html>
<html>
<body>
  <div id="agent"></div>
  <script src="https://unpkg.com/page-agent-sdk"></script>
  <script>
    const { createChatSdk, z } = window.ChatSdk
    const app = { count: 0 }
    createChatSdk({
      container: '#agent',
      llm: { apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      data: { schema: z.object({ count: z.number() }), bind: app, description: '计数' },
    }).mount()
  </script>
</body>
</html>
```

完整示例见仓库 `demo/plain.html`(importmap + esm.sh)。⚠️ 第三方页注入时,AI 配置对该页 origin 可见,请注意。

## 10. 环境变量

开发时通过 `.env`(前缀 `VITE_`):

| 变量 | 说明 |
|---|---|
| `VITE_AI_API_KEY` | API Key |
| `VITE_AI_BASE_URL` | OpenAI 兼容端点 |
| `VITE_AI_MODEL` | 模型名 |
| `VITE_AI_TEMPERATURE` | 温度(操作大 JSON 建议 0.3) |
| `VITE_AI_MAX_TOKENS` | 输出上限(不配则按模型自动取值,如 deepseek-v4→384K) |
| `VITE_AI_SYSTEM_PROMPT` | 系统提示词(**必须单行**;page-demo 会用自有 systemPrompt 覆盖) |

> 生产环境(库模式)由集成方在 `createChatSdk({ llm, contextOptions, summaryLlm, maxMemoryRounds })` 显式传入,不依赖 `.env`。上下文压缩策略经 `contextOptions`/`summaryLlm` 配置,无 `.env` 项。

## 11. 常见问题与坑

**Q: 刷新后对话没了?**
A: 没开持久化。传 `storage: 'indexed'` + 稳定的 `id`(`id` 不传会随机生成并告警,刷新无法恢复)。

**Q: Agent 报 `400 missing field tool_call_id`?**
A: 这是 SDK 内部 LangChain 消息字段约定,已处理。如果你自定义中间件构造 `ToolMessage`,记得用 snake_case 的 `tool_call_id`。

**Q: Agent 改不了某个字段?**
A: 值不符合 `schema`(校验拦截)。检查 schema 定义与传入值。

**Q: 操作大 JSON 时 Agent 报错 / 截断?**
A: ① 用 `write` 的 `patch` 增量改而非整体重传 `value`;② 调大 `maxTokens`;③ 降低 `temperature`(0.3)。

**Q: 怎么关闭某项内置能力?**
A: 用 `capabilities: { dataOps: false, fetch: false, planning: false, skills: false, vfs: false, ... }` 关掉对应内置工具/中间件(默认全开)。`dataOps:false` → 不装 dataOps 工具集(纯调研场景);`fetch:false` → 不装 `fetch_document`。⚠️ vfs 关 → 大结果外存退化为截断;summarization 关 → 长会话不压缩。

**Q: 多个 Agent 同页共存会串数据吗?**
A: 不会。给每个传不同的 `id` 即隔离。若想让多个对话框共享**同一个** Agent,用 `shareContext: true`(同 `id`)。

**Q: 隐私模式 / 存储满了会崩吗?**
A: 不会。自动降级内存,数据不丢(可能不再持久化),并触发 `degraded` 事件。

---

## 12. 完整示例(简 → 繁)

从最简到复杂,覆盖全部能力。复制即用。

### 12.1 最简(30 秒起步)

```ts
import { createChatSdk, z } from 'page-agent-sdk'

createChatSdk({
  container: '#agent',
  llm: { apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  systemPrompt: '你是页面助手,帮用户改主数据。',
  // 声明 agent 能碰的主数据(schema 校验,读写都经工具)
  data: {
    schema: z.object({
      title: z.string().describe('页面标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
    }),
    bind: { title: '首页', theme: 'light' },
    description: '页面配置',
  },
}).mount()
```

零配置自动获得内置工具(read/write + get/set/edit/delete + query/search/eval + snapshot/list/restore + fetch + todos + load_skill + vfs + spawn)。

### 12.2 中等:自定义工具 + skill 文档源 + 持久化

```ts
import { createChatSdk, defineTool, defineSkill, z } from 'page-agent-sdk'

const searchProduct = defineTool({
  name: 'search_product',
  description: '搜索商品库',
  schema: z.object({ keyword: z.string() }),
  handler: ({ keyword }) => fetch(`/api/search?q=${keyword}`).then(r => r.text()),
})

createChatSdk({
  container: '#agent',
  id: 'shop-editor',              // 稳定 id:多 agent 隔离 + 刷新恢复
  storage: 'indexed',             // 持久化(对话 / vfs / todos / memory)
  llm: { apiKey, baseUrl, model: 'deepseek-chat' },
  systemPrompt: '你是商品页编辑助手。复杂任务先 write_todos 拆解。',
  data: { schema: z.object({ components: z.array(z.any()) }), bind: { components: [] }, description: '组件树' },
  tools: [searchProduct],
  skills: [
    defineSkill({ name: 'style-guide', description: '设计规范', doc: 'https://host/style.md' }),  // doc 文档源(http 远程 / vfs 本地)
  ],
  memory: '用简体中文;价格显示 ¥。',
}).mount()
```

### 12.3 复杂:全能力(预声明子 agent + 独立 llm + verify + 中间件)

```ts
import { createChatSdk, defineTool, defineSkill, z, type Middleware } from 'page-agent-sdk'

const searchProduct = defineTool({ name: 'search_product', /* ... */ } as any)

// 自定义中间件:工具埋点
const analytics: Middleware = {
  name: 'analytics',
  afterToolCall: async (ctx, next) => {
    const res = await next(ctx)
    console.log('[埋点]', ctx.name, res?.status)
    return res
  },
}

createChatSdk({
  container: '#agent',
  id: 'shop-editor',
  storage: 'indexed',

  // —— 主 agent ——
  llm: { apiKey, baseUrl, model: 'deepseek-chat', temperature: 0.3, maxTokens: 16384 },
  systemPrompt: '你是商品页编辑助手。复杂任务先 write_todos;调研用 use_researcher;审查用 use_reviewer。',
  data: { schema: z.object({ components: z.array(z.any()) }), bind: { components: [] }, description: '组件树' },
  tools: [searchProduct],
  skills: [defineSkill({ name: 'style-guide', description: '设计规范', doc: 'vfs://skills/style.md' })],
  memory: '用简体中文;价格显示 ¥。',

  // —— 预声明子 agent(命名角色,各配独立 llm / provider)——
  subagents: [
    {
      id: 'researcher', description: '市场调研,擅长分析竞品',
      llm: { apiKey, baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },  // 不同 provider
      systemPrompt: '你是市场调研专家,给数据支撑的结论。',
      tools: [searchProduct],
      temperature: 0.2, maxTokens: 8192,
    },
    { id: 'reviewer', description: '文案审查', systemPrompt: '你是文案审查者,找语病和不合规表述。' },  // 不传 llm → 继承主
  ],

  // —— 自检:返回前验证主数据写入(写后读回 + schema)——
  capabilities: { verify: true },
  verify: { maxAttempts: 2 },

  middleware: [analytics],
  debug: true,
}).mount()
```

主 LLM 会自动:多步任务先 `write_todos` → 调研调 `use_researcher({task})` → 审查调 `use_reviewer({task})` → 改 `components` 前自动 snapshot(误改可 `restore_data`)→ 返回前 verify 自检。

### 12.4 headless 自建 UI(不渲染内置对话框)

```ts
import { createChatSdk } from 'page-agent-sdk'

const agent = createChatSdk({ ui: false, llm, data })
agent.mount()
agent.messages        // 响应式数组,自建 UI 读它
await agent.send('加一个提交按钮')
```

也可 `import { ChatDialog, useChat } from 'page-agent-sdk'` 复用对话框组件与流式 / 重试 / 停止 / 重生成逻辑。

### 12.5 主题定制(换主色)

默认主色墨绿 `#1f4d3a`(去 AI 风 indigo)。覆盖 CSS 变量即可换主题:

```css
#agent { --cs-primary: #b45309; }   /* 换成焦糖棕 */
```

可覆盖变量:`--cs-primary`(主色)/ `--cs-bg`(背景)/ `--cs-radius`(圆角);props:`showAvatar` / `showTyping`(关装饰)。

---

## 更多

- 架构与文件清单:见 `doc/architecture.md` / `doc/architecture-files.md`
- 框架无关集成示例:`demo/plain.html`
- 开发自举 demo:`examples/page-demo/`(`npm run dev`)
- 类型声明:`types/index.d.ts`

## 使用案例索引(端到端场景)

下列 9 个端到端场景含可复制代码,见随包 Agent Skill 的 `skills/page-agent-sdk-integrate/references/use-cases.md`(npm 包内同样包含;安装 skill 见 README「给 AI 工具使用者的 Skills」):

| # | 场景 | 关键配置 |
|---|---|---|
| 1 | 低代码页面搭建 | `data`=组件树;`write` 的 `patch` jsonPath 增量;`onEvent`→画布刷新;`checkpoint`+`approval` |
| 2 | 表单设计器 | `data`=字段定义(枚举/必填 schema);schema 校验防错 |
| 3 | CMS 批量运营 | `eval_script` 批量循环;`search_data` 筛选;`write` 的 `patch` 精确改 |
| 4 | 运维配置台 | `approval` 人工确认;`capabilities.verify:true` 写后读回;`checkpoint` |
| 5 | AI 原生助手 | `capabilities:{dataOps:false,fetch:false}` + 自定义 `tools`(产品 API) |
| 6 | 调研 agent | `capabilities:{dataOps:false}`;`subagent:{allowedTools:['fetch_document']}`;`contextPreset:'conservative'` |
| 7 | 服务端 Node.js | `ui:false`+`storage:'memory'`+`capabilities:{dataOps:false,fetch:false}`;`sdk.send` 驱动 |
| 8 | 同页多 agent | 同 `id`+`shareContext:true`→多对话框共享同一 `AgentCore` |
| 9 | MCP 集成 | `mcp:[{transport,url}]` 远程工具;`@modelcontextprotocol/sdk` 可选 peerDep |
| 10 | 多 Agent 并行 + 互斥切换 | 多个 `createChatSdk`(不同 `id` 各管各 `data`)+ `dialog.drawer:true`;切换调 `hide()`/`show()`(保留各自历史/生成进程,不卸载) |

各场景对应的可运行 demo:`examples/nested-demo`(1)、`examples/page-demo`(1/2)、`examples/subagent-demo`(6)、`examples/mcp-demo`(9)、`examples/human-confirm-demo`(4)、`examples/planner-demo`(规划)、`examples/toolsets-demo`(工具分离)、`examples/animation-demo`(动画 + hide/show)、`examples/multi-agent-demo`(多 Agent 并行 + 互斥切换)。

### 多 Agent 并行 + 互斥切换

同一页面挂多个独立 Agent(各自 `createChatSdk` + 不同 `id` 隔离),各管各 `data`/历史/工具,可并行跑各自生成任务;聊天框互斥切换用 `dialog.drawer` + `hide()`/`show()`——切换时 `hide` 旧的(保留 agent/历史/生成进程)、`show` 新的(历史恢复),不卸载不丢对话:

```ts
const agents = [
  createChatSdk({ id: 'agent-a', container: boxA, dialog: { drawer: true }, data: { schema: schemaA, bind: objA }, ... }),
  createChatSdk({ id: 'agent-b', container: boxB, dialog: { drawer: true }, data: { schema: schemaB, bind: objB }, ... }),
  createChatSdk({ id: 'agent-c', container: boxC, dialog: { drawer: true }, data: { schema: schemaC, bind: objC }, ... }),
]
await Promise.all(agents.map(a => a.mount()))  // 三个独立 agent 并行就绪
agents.slice(1).forEach(a => a.hide())         // 初始只显示第一个

let active = 0
function switchTo(i: number) {
  agents[active].hide(); active = i; agents[i].show()  // 互斥切换,历史各自保留
}
```

**要点**:
- 不同 `id` 隔离:各自独立 agent 实例/历史/工具/storage,互不串扰
- 各管各 `data` 对象无冲突;多 agent 操作同一 `data` 需协调(乐观锁 `expectedHash` 或按 `jsonPath` 分区)
- `hide()` 不卸载 vueApp/不 release agent,保留聊天历史与正在进行的生成进程;`show()` 恢复可见
- 切换按钮若在抽屉遮罩下,需提高 `z-index`(高于遮罩 `9998` + ChatDialog `9999`)确保可点

完整示例:`examples/multi-agent-demo/`。

### 抽屉模式宽度 + 默认隐藏(点击按钮才出现聊天框)

抽屉模式(`dialog.drawer: true`)下,可自定义聊天框宽度,并支持「mount 后默认隐藏,点击按钮才显示」的场景:

```ts
const sdk = createChatSdk({
  id: 'my-agent', container: '#box',
  dialog: {
    drawer: true,             // 抽屉模式
    drawerWidth: 500,          // 宽度 500px(也可传 '500px' / '40vw' / '50%' 等 CSS 字符串);默认 420
    drawerHidden: true,        // mount 后默认隐藏,需 sdk.show() 才显示
  },
  llm, data: { schema, bind },
})
await sdk.mount()            // 挂载但不可见(drawerHidden 生效)

// 点击按钮 → 显示聊天框
document.querySelector('#open-chat-btn')!.addEventListener('click', () => sdk.show())
// 聊天框关闭按钮/遮罩点击 → 默认调 hide()(保留 agent/历史/生成进程),再次 show() 恢复
```

**要点**:
- `dialog.drawerWidth`:纯数字按 `px` 处理;字符串原样透传(支持 `vw`/`%` 等响应式单位);仅 `drawer: true` 生效,inline 模式宽度由 `container` 决定
- `dialog.drawerHidden`:`mount` 后立即调 `hide()`(加 `cs-hidden` class,不可见但 vueApp/agent 已就绪);首次 `show()` 移除隐藏 class,后续 `hide()`/`show()` 切换可见性
- 关闭按钮/遮罩点击默认调 `hide()`(抽屉模式);传 `dialog.onClose` 可自定义关闭行为

**进阶扩展详细例子**(自定义 tool / skills / subagents / MCP)见随包 Agent Skill 的 `skills/page-agent-sdk-integrate/references/advanced.md`:含 `defineTool`(错误处理 + 与 dataOps 共存)、`defineSkill`(内联内容 + 远程 doc)、子 agent(ad-hoc `spawn_agent`/`spawn_agents` + 预声明 `subagents`→`use_<id>`)、MCP(http/sse/websocket + 鉴权 + dev 坑)的可复制代码。
