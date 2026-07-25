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
  - [6.1 window 操作(让 Agent 改你的页面)](#61-window-操作让-agent-改你的页面)
  - [6.2 自定义工具](#62-自定义工具)
  - [6.3 Skills(渐进式披露)](#63-skills渐进式披露)
  - [6.4 Memory(持久指令)](#64-memory持久指令)
  - [6.5 Planning(任务规划,自动)](#65-planning任务规划自动)
  - [6.6 持久化与会话管理](#66-持久化与会话管理)
  - [6.7 对话鲁棒性(重试 / 停止 / 重试)](#67-对话鲁棒性重试--停止--重试)
  - [6.8 上下文与内存上限](#68-上下文与内存上限)
  - [6.9 onEvent 事件回调(订阅常用时机)](#69-onevent-事件回调订阅常用时机)
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

## 3. 快速开始(3 分钟)

最小可用例子 —— 让 Agent 能读写页面上的 `window.app`:

```ts
import { createChatSdk, z } from 'page-agent-sdk'

// 1. 你的页面状态(任意结构)
window.app = { title: '你好', theme: 'light' }

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
  systemPrompt: '你是页面助手。可读改 window.app 的 title / theme。',
  windowProps: [
    { path: 'app.title', description: '页面标题', schema: z.string() },
    { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
  ],
}).mount()
```

打开页面,在对话框输入「把主题改成 dark」→ Agent 调用 `set_window_prop` 直接改 `window.app.theme`。完。

## 4. 核心概念

| 概念 | 说明 |
|---|---|
| **Agent** | ReAct 循环:思考 → 调工具 → 观察 → 再思考,直到给出最终回复 |
| **windowProps** | 你声明「Agent 可以读写 window 上哪些属性 + 值的 schema」。Agent 只能动这些(范围控制) |
| **工具(tool)** | Agent 的手脚。内置 window/vfs/文档抓取工具 + 你用 `defineTool` 加的 |
| **中间件(middleware)** | 插入 Agent 生命周期的钩子。内置 todos/skills/vfs/summarization/memory/permissions/verify,也可自定义 |
| **持久化(storage)** | 对话/工作区/todos/memory 落盘(IndexedDB 等),刷新可恢复 |

**心智模型**:你只负责 ① 声明 `windowProps`(Agent 能碰什么)② 写 `systemPrompt`(Agent 该干嘛)③ 可选加 `tools`/`skills`/`middleware`。其余交给 Agent。

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
  systemPrompt: '...',          // Agent 身份与行为指令(可选:不传用内置默认——页面操作助手 + reliableWriteRules;传了则完全覆盖)
  shareContext: false,          // true:同 id 的多个实例共享同一 Agent(同页多对话框 = 同一 agent)

  /* ===== 能力注入 ===== */
  windowProps: [...],           // 可读写的 window 属性(范围 + schema 校验)
  tools: [...],                 // 自定义工具(defineTool)
  skills: [...],                // 渐进式披露技能(defineSkill)
  memory: '...',                // AGENTS.md 风格持久指令
  permissions: [...],           // scope 白名单(默认不启用)
  middleware: [...],            // 自定义中间件(见第 7 节)

  /* ===== 持久化与会话 ===== */
  storage: 'indexed',           // 'indexed'/'session'/'local'/'memory'/配置对象/false(默认关闭)
  session: { id?, autoResume?, title? },  // 会话控制

  /* ===== 容量与鲁棒性 ===== */
  vfs: { initialFiles?, maxBytes? },      // 虚拟工作区(默认内存上限 4MB,LRU 淘汰)
  maxSnapshots: 20,             // 每个 window 属性快照数(默认 20,FIFO)
  maxMemoryRounds: 50,          // 内存保留对话轮数(默认 50,超限压缩为摘要;0 关闭)
  maxToolRounds: 10,            // 单轮最多工具调用轮次(默认 10)
  maxRetries: 2,                // 模型调用失败重试次数(默认 2;网络/429/5xx 重试)
  capabilities: { windowOps: true, fetch: true, planning: true, vfs: true, verify: true },  // 能力开关(默认全开;关掉省 token。windowOps/fetch 控制内置工具装载;verify 反向:默认关,需显式 verify:true)
  verify: { maxAttempts: 2 },        // 自检(需 capabilities.verify:true;check 省略→默认写后读回验证;见 6.10)

  /* ===== UI 与其他 ===== */
  streaming: true,              // 流式逐字输出(默认 true)
  contextPreset: 'auto',        // 压缩预设:auto(默认)/conservative(省成本)/aggressive(省上下文)
  contextOptions: {...},        // 压缩细参,覆盖 preset 个别字段(false 关闭压缩)
  summaryLlm: { apiKey, baseUrl, model },  // 摘要专用模型(不配用主 llm)
  summaryTemperature: 0.3,      // 摘要 LLM 温度(默认 0.3)
  summaryMaxTokens: 1024,        // 摘要 LLM 输出上限(默认 1024)
  summaryTimeoutMs: 15000,       // 摘要 LLM 超时(默认 15s,超时回退索引摘要)
  title: 'AI 助手',             // 对话框标题
  placeholder: '输入消息...',   // 输入框占位
  debug: false,                 // 调试日志
}).mount()
```

## 6. 能力详解

### 6.1 window 操作(让 Agent 改你的页面)

这是 SDK 的核心。你用 `windowProps` 声明 Agent 能碰的属性:

```ts
windowProps: [
  {
    path: 'app.theme',          // window 上的路径,支持点号嵌套(app.user.name)
    description: '页面主题',     // Agent 据此判断何时用
    schema: z.enum(['light', 'dark', 'auto']),  // 写入时校验
  },
]
```

Agent 自主调用这些内置工具(无需你写):

| 工具 | 作用 |
|---|---|
| `list_window_props` / `describe_window_prop` | 列出 / 查看可操作属性 |
| `get_window_prop` / `get_window_paths` | 读属性(支持后代路径精确读局部;字段白名单读模式默认禁止祖先整体读,避免大 JSON 进上下文) |
| `set_window_prop` | 写属性(**按 schema 校验**,不合法返回错误不写入) |
| `edit_window_prop` | 增量 patch(`components.0.text`),避免重传整个大 JSON |
| `delete_window_prop` | 删属性 |
| `snapshot_window_prop` / `list_window_snapshots` / `restore_window_snapshot` | 快照 / 回退 |

**要点**:
- **范围控制**:Agent 只能动 `windowProps` 里声明的路径,其它一律拒绝。
- **schema 校验**:`set`/`edit` 不合法值会被拦截(不写入),返回结构化错误给 Agent 自纠。
- **快照回退**:每次 `set`/`edit`/`delete` 前自动存快照,`restore_window_snapshot` 一键回退。
  - 自动快照:写操作前自动入栈(per-path,默认 20,FIFO 丢最旧)
  - 手动检查点:`snapshot_window_prop(path, label?)` 命名快照
  - 查看时间线:`list_window_snapshots(path?)` —— 序号 / op / 标签 / 大小
  - 回退:`restore_window_snapshot(path, id?)` —— 不传 id 回退最近一次,传 id 回退指定;就地还原保留响应式、不入栈
  - 例:Agent 误改 `page.theme`,对话「回退 page.theme 最近一次修改」→ Agent 调 `restore_window_snapshot({ path: 'page.theme' })`
- **Vue 响应式友好**:`edit` 就地改子属性、不替换根引用 → 你的 `reactive()` 页面能正常响应更新。
- **零桥接**:工具直接操作宿主页面主 `window`,无 iframe/shadow 隔离。
- **大 JSON 只暴露声明字段**(字段白名单读模式,默认开启):当宿主有个大 JSON(如 `window.page` 含上百字段),你不必声明完整 schema,也无需让 Agent 看到全貌。做法:
  - 注册「可操作子路径」而非顶层,各自 schema;数组元素用 `.passthrough()` 只校验必要 key、其余放行:

    ```ts
    windowProps: [
      { path: 'page.title', description: '页面标题', schema: z.string() },
      { path: 'page.theme.color', description: '主题色', schema: z.string() },
      { path: 'page.components', description: '组件数组',
        schema: z.array(z.object({
          id: z.number(), type: z.string(), price: z.number(), title: z.string()
        }).passthrough()) },  // 元素其余字段(internal 等)不校验、放行
    ],
    ```

  - Agent 只能 `get`/`set`/`edit` 这些声明字段;`get_window_prop('page')`(未注册祖先)被拒 → 完整 JSON 不进上下文,省 token、防泄露。
  - 改数组元素某字段用 `edit_window_prop('page.components', { op:'set', jsonPath:'1.price', value:'180' })` 增量 patch,只发改动、不重传整个数组。
  - 需整体读祖先时设 `createChatSdk({ ..., })` 内 `windowOps` 选项 `whitelist:false`(回退原行为)。
- **树形/递归 children 结构**:节点含 `children` 自引用时,用 zod `z.lazy(() => TreeNode)` 声明递归 schema,`.passthrough()` 让节点可带未声明字段:

  ```ts
  const TreeNode: z.ZodType = z.object({
    id: z.number(),
    type: z.string(),
    text: z.string().optional(),
    children: z.array(z.lazy(() => TreeNode)).optional(),  // 自引用 → 任意深度
  }).passthrough()

  windowProps: [
    { path: 'page.components', description: '组件树(递归 children)', schema: z.array(TreeNode) },
  ],
  ```

  - **查**:递归找任意深度的节点用 `query_window_prop` 的 `$..*[?(@.type=="card")]`(找所有 card);精确定位用 `$.components.0.children.0.children.0.text`
  - **改**:增量改深层节点用 `edit_window_prop('page.components', { op:'set', jsonPath:'0.children.0.children.0.text', value:'"新文本"' })` —— jsonPath 逐级定位,只发改动,无需重传整棵树
  - **校验**:递归 schema 自动穿透到 children,append 非法节点(如缺 `id`)被拒;passthrough 保留节点的额外字段(extra/style 等)
  - **复杂遍历**(如带父路径聚合、按多条件递归筛选)用 `eval_window_script` 写递归 visit 函数最直观

#### 乐观锁(防"基于过期值覆盖")与冲突人工介入

当属性可能被**外部代码 / 其他 agent / 用户手动**并发修改时,启用乐观锁:Agent `get_window_prop` 返回值末尾附 `hash=xxx`,写入时回传 `expectedHash` 校验。

```ts
// Agent 工作流(由 LLM 自动执行,集成方无需写)
// 1. get → "page.title = old (hash=a1b2)"
// 2. set_window_prop({ path:'page.title', value:'"new"', expectedHash:'a1b2' })
//    若期间外部改过 → hash 不匹配 → 触发冲突
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

> 不传 `expectedHash` → 向后兼容直接写(不校验)。独立使用 `createWindowOps(props, { onConflict })` 不接 ChatDialog 时,自行处理冲突(返回 `Promise<{action}>`)。

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

**持久化什么**:对话历史 / vfs 工作区 / todos / memory。(window 快照栈不持久化 —— 刷新后宿主值已变。)

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
- **摘要专用模型**:`summaryLlm` 可指定更便宜的小模型做摘要(不配用主 `llm`);`summaryTemperature`/`summaryMaxTokens`/`summaryTimeoutMs` 微调摘要 LLM。
- **对话历史上限**:`maxMemoryRounds`(默认 50)超限把最旧轮次压缩为一条摘要 system 消息。
- **vfs 工作区上限**:`vfs.maxBytes`(默认 4MB)超限按 LRU 淘汰最旧文件。

这些在 `storage: false`(纯内存)下也生效,防 OOM。

压缩统计可在 DebugDrawer「🧬 Agent 信息」tab 的「🗜️ 上轮压缩」段查看(触发与否、摘要轮次、召回条数、策略名),排查"上下文为何变了"。

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
    allowedTools: ['myResearchTool'],  // 子 agent 可用的额外工具(默认仅只读 window + fetch)
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
      systemPrompt: '你是创意设计规划师。只读 window 数据,给出 2-3 套方案(JSON 草稿),不要调写工具。' },
    { id: 'reflector', description: '设计反思审查员,挑方案的不一致/不可行/体验问题',
      temperature: 0.3,
      systemPrompt: '你是设计反思审查员。对方案挑刺并给修订建议,不要重写整个方案。' },
  ],
  approval: { tools: ['set_window_prop', 'edit_window_prop'] }, // 落地写前确认
})
// 流程:用户"设计夏日主题" → 主 agent 识别创作类 → use_planner 出方案
//      → (可选)use_reflector 审查 → request_human_confirmation 让用户选 → edit_window_prop 落地
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

**内置 check(默认)**:`createWriteBackCheck()` —— Agent 写了 window(`set/edit/delete_window_prop`)后,读回值确认写入生效 + 符合 schema:
- **写后读回**:set/edit 后读回为空 → 「未生效」反馈;读回不符合 schema → 反馈
- **delete 语义**:delete 后读回空 = 删除成功(放行);仍有值 → 「未删干净」
- **跳过被拒写**:写被合法拒绝(schema 校验失败 / 范围拒绝)时**不误报**(读回无值是预期)
- windowOps 写入同步,check 读回无需 `await`

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

**何时用**:Agent 改页面(window 写)后想确保写入生效 / 符合预期。**何时不用**:纯问答(无写操作,check 自动放行)、对延迟敏感(自纠多跑 LLM 轮次)。

**查看状态**:`agent.inspect().verify` → `{ enabled, maxAttempts }`。

> **对抗验证**(`verify.adversarial: true`):check 通过后 spawn 一个**配只读工具**的"找茬"子 agent(refute 姿态,可实证读回 window 检查而非臆测,突破自审偏差)再审一遍。默认关(每次烧一个多轮子 agent token)。
>
> **window 场景策略**:开 verify 即用 `createWriteBackCheck`(写后读回 + schema 校验,低成本**必备**);adversarial 作可选增强(语义复杂场景才开)。

### 6.11 Approval 人工确认(工具调用前 human-in-the-loop)

人工确认分**主动**与**被动**两侧,默认行为不同:

- **主动侧(默认开启)**:装载 `request_human_confirmation` 工具,LLM 在**不确定 / 多方案 / 高风险不可逆**时主动调用征询用户(把选项做成可点选按钮,而非自行猜测);usageHints 自动注入默认提示词引导何时调用(无需你写 prompt)。`humanConfirm: false` 关闭。
- **被动侧(白名单,默认关闭)**:`approval.tools`/`approval.confirm` 指定的工具调用前自动弹确认框,用户「允许/拒绝」后才执行——防 AI 误改页面/误删数据。需传 `approval` 选项声明(业务相关,无法自动推断)。

```ts
createChatSdk({
  // ... 其他配置
  // humanConfirm: true,  // 主动征询(默认开启,不传也开;false 关闭)
  approval: {
    tools: ['set_window_prop', 'edit_window_prop', 'delete_window_prop'], // 被动:需确认的工具名
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
  windowProps: [{ path: 'Editor.PageInfo', schema, ... }],  // checkpoint 整体快照这些注册属性
})
sdk.mount()

// 一键回退(对话历史 + 注册 window 属性 + vfs + todos 整体还原)
sdk.restoreLastCheckpoint()
sdk.listCheckpoints()  // 查看可用回退点
```

**自动存档**(`auto` 默认 true):每轮 agent 行动前(beforeModel 首次)自动存一个 checkpoint = 上一正常态 + 本轮 user 消息。回滚后**保留 user 消息、撤销 agent 本轮改动**,可直接重试本轮。

**快照内容**(整体,区别于 windowOps 的 per-path 精细快照):对话历史 + 全部注册 window 属性 + vfs + todos。仅存内存(会话级,非持久化);FIFO 限长(默认 5)。

**三个回滚入口**:
- **UI**:ChatDialog error-bar「↩ 回退」按钮 + footer 常驻回退按钮(`canUndo` 时显示)——用户一键回退
- **LLM 工具**:`restore_last_checkpoint`(流程异常/改坏页面时 AI 自纠回退)、`list_checkpoints`
- **SDK API**:`sdk.restoreLastCheckpoint()` / `sdk.listCheckpoints()`(headless 自建 UI 用)

**就地还原**:window 注册属性就地清空+重填(保留 Vue reactive 容器引用,UI 自动更新);messages 用 splice 替换内容(保留同一响应式数组引用);vfs 清空重填;todos reset。

> **与 windowOps 快照区别**:per-path 快照(`restore_window_snapshot`)精细,单属性回退,自动随 set/edit/delete 入栈;checkpoint 整体,回滚到某轮起点(跨多属性 + 对话 + vfs + todos)。二者叠加:小错用 per-path 精细修,大错用 checkpoint 整体回。`nested-demo` 已开启 `checkpoint: true`。

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
| `window_prop_change` | Agent 调 `set`/`edit`/`delete`/`restore_window_*` 后 | `path` / `operation` / `value`(改后值) |
| `message_update` | 每轮 Agent 结束 | `count`(消息数) |
| `tool_call` | 工具调用前(stream 模式) | `name` / `args` |
| `tool_result` | 工具返回后(stream 模式) | `name` / `result` / `status` |
| `text` / `reasoning` | 流式文本/思考增量(stream 模式) | `delta` |
| `round_start` | 每轮模型调用开始 | `round` |
| `subagent` | 子 agent 工具进度 | `taskId`/`label`/`kind`/`name`/... |
| `done` | 一轮回复完成(stream 模式) | `content` |
| `error` | 模型调用/工具抛错 | `message` |

> ⚠️ `approval_request` 不外发(UI 已处理,避免集成方误调 `resolve` 双重收口)。
> ⚠️ `tool_call`/`tool_result`/`text`/`done` 等流式事件仅在 **stream 模式**触发(UI 默认走 stream;命令式 `sdk.send` 走 invoke 无流式事件,但 `window_prop_change`/`message_update`/`error` 仍会发)。

**示例**(宿主页面响应式刷新,替代 `setInterval` 轮询):

```ts
createChatSdk({
  /* ... */
  onEvent(event) {
    if (event.type === 'window_prop_change') {
      // Agent 改了 window 属性 → 实时刷新你的 UI 镜像
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
  if (event.type === 'window_prop_change') renderUI()
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
    if (ctx.name === 'set_window_prop' && ctx.args.path === 'app.critical') {
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
createChatSdk({ ...presets.pageBuilder, container: '#root', llm, windowProps })  // 页面构建助手
createChatSdk({ ...presets.researcher, container, llm })                         // 并行调研
createChatSdk({ ...presets.minimal, container, llm, windowProps })               // 极简(关高级能力)
```
可用预设:`pageBuilder`(读写 window 驱动页面)、`researcher`(spawn_agents 并行调研)、`minimal`(关闭所有高级能力,省 token)。

### 8.5 服务端(Node.js)用法

SDK 核心是**框架无关的 JS**,可在 Node.js 服务端跑(headless 模式),用作后端 Agent(自定义工具编排、文档抓取、子 agent 并行、自检自纠)。

**服务端配置要点**:
- `ui: false` —— headless,不渲染 ChatDialog(服务端无 DOM)
- `capabilities: { windowOps: false, fetch: false }` —— 关浏览器依赖工具(windowOps 需 `window` 对象;`fetch_document` 需 `fetch`,Node 18+ 有全局 fetch,可保留)
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
  capabilities: { windowOps: false, fetch: false },
  tools: [add],
})
await sdk.mount()
const reply = await sdk.send('3 加 5 等于多少?')
console.log(reply) // AI 调 add 工具 → "3 + 5 = 8"
```

**服务端可用能力**:自定义工具 / `fetch_document`(Node 18+)/ 子 agent / verify 自检 / vfs 工作区 / context 压缩 / memory / onEvent 事件回调
**服务端不可用**:windowOps(需 `window`)/ ChatDialog UI(需 DOM)/ IndexedDB·localStorage·sessionStorage 持久化(用 `memory` 替代)

> 注:`eval_window_script` 依赖 Web Worker,属 windowOps,关掉即不装。MCP 远程工具(http/sse/websocket)在 Node 也可用(动态 import `@modelcontextprotocol/sdk`)。

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
    window.app = { count: 0 }
    createChatSdk({
      container: '#agent',
      llm: { apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      windowProps: [{ path: 'app.count', description: '计数', schema: z.number() }],
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

**Q: Agent 改不了某个 window 属性?**
A: 该属性没在 `windowProps` 里声明(范围控制),或值不符合 `schema`(校验拦截)。检查这两点。

**Q: 操作大 JSON 时 Agent 报错 / 截断?**
A: ① 用 `edit_window_prop` 增量 patch 而非 `set` 重传整体;② 调大 `maxTokens`;③ 降低 `temperature`(0.3)。

**Q: 怎么关闭某项内置能力?**
A: 用 `capabilities: { windowOps: false, fetch: false, planning: false, skills: false, vfs: false, ... }` 关掉对应内置工具/中间件(默认全开)。`windowOps:false` → 不装 10 个 window 工具(纯调研场景);`fetch:false` → 不装 `fetch_document`。⚠️ vfs 关 → 大结果外存退化为截断;summarization 关 → 长会话不压缩。

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
  systemPrompt: '你是页面助手,帮用户改 window.page。',
  // 声明 agent 能碰的 window 属性(范围 + schema 校验,读写都经工具)
  windowProps: [
    { path: 'page.title', description: '页面标题', schema: z.string() },
    { path: 'page.theme', description: '主题', schema: z.enum(['light', 'dark']) },
  ],
}).mount()
```

零配置自动获得 21 个内置工具(get/set/edit window + 快照回退 + fetch + todos + load_skill + vfs + spawn)。

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
  windowProps: [{ path: 'page.components', description: '组件树', schema: z.array(z.any()) }],
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
  windowProps: [{ path: 'page.components', description: '组件树', schema: z.array(z.any()) }],
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

  // —— 自检:返回前验证 window 写入(写后读回 + schema)——
  capabilities: { verify: true },
  verify: { maxAttempts: 2 },

  middleware: [analytics],
  debug: true,
}).mount()
```

主 LLM 会自动:多步任务先 `write_todos` → 调研调 `use_researcher({task})` → 审查调 `use_reviewer({task})` → 改 `page.components` 前自动 snapshot(误改可 `restore_window_snapshot`)→ 返回前 verify 自检。

### 12.4 headless 自建 UI(不渲染内置对话框)

```ts
import { createChatSdk } from 'page-agent-sdk'

const agent = createChatSdk({ ui: false, llm, windowProps })
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
| 1 | 低代码页面搭建 | `windowProps`=组件树;`edit_window_prop` jsonPath 增量;`onEvent`→画布刷新;`checkpoint`+`approval` |
| 2 | 表单设计器 | `windowProps`=字段定义(枚举/必填 schema);schema 校验防错 |
| 3 | CMS 批量运营 | `eval_window_script` 批量循环;`search_window_prop` 筛选;`edit_window_prop` 精确改 |
| 4 | 运维配置台 | `approval` 人工确认;`capabilities.verify:true` 写后读回;`checkpoint` |
| 5 | AI 原生助手 | `capabilities:{windowOps:false,fetch:false}` + 自定义 `tools`(产品 API) |
| 6 | 调研 agent | `capabilities:{windowOps:false}`;`subagent:{allowedTools:['fetch_document']}`;`contextPreset:'conservative'` |
| 7 | 服务端 Node.js | `ui:false`+`storage:'memory'`+`capabilities:{windowOps:false,fetch:false}`;`sdk.send` 驱动 |
| 8 | 同页多 agent | 同 `id`+`shareContext:true`→多对话框共享同一 `AgentCore` |
| 9 | MCP 集成 | `mcp:[{transport,url}]` 远程工具;`@modelcontextprotocol/sdk` 可选 peerDep |

各场景对应的可运行 demo:`examples/nested-demo`(1)、`examples/page-demo`(1/2)、`examples/subagent-demo`(6)、`examples/mcp-demo`(9)、`examples/human-confirm-demo`(4)、`examples/planner-demo`(规划)、`examples/toolsets-demo`(工具分离)。

**进阶扩展详细例子**(自定义 tool / skills / subagents / MCP)见随包 Agent Skill 的 `skills/page-agent-sdk-integrate/references/advanced.md`:含 `defineTool`(错误处理 + 与 windowOps 共存)、`defineSkill`(内联内容 + 远程 doc)、子 agent(ad-hoc `spawn_agent`/`spawn_agents` + 预声明 `subagents`→`use_<id>`)、MCP(http/sse/websocket + 鉴权 + dev 坑)的可复制代码。
