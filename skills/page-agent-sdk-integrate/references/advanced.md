# Advanced examples — custom tools, skills, subagents, MCP, dynamic dataSlots

Detailed, copy-paste examples for the extensibility surfaces. Read the section matching the user's need.

## 0. Dynamic dataSlots (lazy-loaded components) — `sdk.addDataSlot` / `removeDataSlot`

When components are lazy-loaded with **different schemas each**, don't declare all `dataSlots` upfront. Register them at runtime as components mount/unmount. The agent's data slot tools pick up new registrations immediately (no agent rebuild).

```ts
const sdk = createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是页面助手,按组件类型操作数据槽.app.components.<id>。',
  dataSlots: [
    // statically-declared ones (always present)
    { path: 'app.config', description: '全局配置', schema: z.record(z.any()) },
  ],
}).mount()

// 组件懒加载时动态注册其 schema(结构各异)
function onComponentMount(comp: { id: string; type: string; schema: z.ZodType }) {
  sdk.addDataSlot({ path: `app.components.${comp.id}`, description: `${comp.type} 组件`, schema: comp.schema })
  // 立即生效:AI 现在能 write 这个 path,按其 schema 校验
}

// 组件卸载时移除(快照栈一并清理)
function onComponentUnmount(id: string) {
  sdk.removeDataSlot(`app.components.${id}`)
}

// 查看当前所有注册项(反映动态增删)
const current: DataSlotSpec[] = sdk.listDataSlots()
```

Notes:
- `addDataSlot` 覆盖同名 path 时保留旧快照栈;按新 schema 校验。
- 动态注册的属性**不自动纳入 checkpoint 快照**(checkpoint 的 slotPaths 在构造时固定);如需回滚动态组件,自行管理或重建。
- `inspect().dataSlots` 与 `verify`(默认 `createWriteBackCheck`)均反映动态注册的最新 schemas(verify 每次 check 实时取 `listDataSlots()`)。
- `capabilities.dataSlotOps:false` 时 `addDataSlot`/`removeDataSlot` 为 no-op(并 warn)。

**完整可运行示例**:`examples/dynamic-demo/`(dev 启动后访问 `/examples/dynamic-demo/`)—— 演示加载/卸载结构各异的组件(banner/card/stat/chart),挂载即 `addDataSlot` 注册其 schema,AI 立即可按各自 schema 操作,卸载即 `removeDataSlot`;右侧实时显示 `sdk.listDataSlots()` 反映动态增删。

### 动态场景下「压缩后不丢信息」的保障(内置,无需额外配置)

动态组件随时增删,长会话压缩后 LLM 可能基于过时记忆操作已卸载的组件、或不知道新组件已注册。SDK 内置两道保障:

- **A. 压缩时注入注册表快照**:`summarization` 中间件压缩 older 轮次时,自动把当前 `listDataSlots()` 的 `path + description` 作为一段附进摘要 system 消息(不进压缩)。LLM 即便忘了历史 `describe`,每轮仍看得到「当前有哪些可操作 path」,不会再去操作已卸载的组件。`dataSlotOps` 关闭时返回空,无影响。
- **C. preserveLastToolResults**:`contextOptions.preserveLastToolResults`(默认 `['describe_data_slot','list_data_slots']`)指定这些工具的步骤 `result` 在跨轮摘要时额外保留摘要片段进 summaryMsg。即便 older 轮被摘要,关键字段说明仍在摘要里,LLM 不必反复 `describe`。设为 `[]` 关闭。

```ts
// 默认即开启 A + C;如需关闭或自定义:
createChatSdk({
  contextOptions: {
    preserveLastToolResults: [],  // 关闭 C(不保留工具结果摘要)
    // getRegisteredSlots 由 SDK 内部注入(来自 sdk.listDataSlots),无需手动传
  },
  // ...
})
```

- **B. 写操作返回附当前可操作 path 列表**:`set`/`edit`/`delete` 成功返回末尾自动附 `(当前可操作 path: a, b, c)`,LLM 写完即知全貌,多组件批量场景减少 `list` 调用。超过 8 项或过长时只报数量,避免提示过长。
- **D. `systemPromptHelpers.reliableWriteRules`**:导出的标准化「可靠写入规则」片段,建议拼进 `systemPrompt`:

```ts
import { systemPromptHelpers } from 'page-agent-sdk'
createChatSdk({
  systemPrompt: `你是页面助手。\n${systemPromptHelpers.reliableWriteRules}`,
  // ...
})
```
内容:改前先 `get` 读真实值、动态场景先 `list`、字段以 `describe` 为准、写错看校验错误重试、优先 `edit` 增量 patch。避免集成方忘了写这些元规则导致 LLM 凭记忆瞎改。

## 1. Custom tools (`defineTool`)

Custom tools extend the agent beyond built-in `dataSlotOps`/`fetch`. Use them to expose your product's API to the AI.

### Minimal

```ts
import { createChatSdk, defineTool, z } from 'page-agent-sdk'

const lookupOrder = defineTool({
  name: 'lookup_order',
  description: '查询订单 by id',
  schema: z.object({ orderId: z.string() }),
  handler: async ({ orderId }) => JSON.stringify(await api.getOrder(orderId)),
})
```

### With error handling

Return structured errors via `toolError` so the AI can react:

```ts
import { defineTool, toolError, z } from 'page-agent-sdk'

const updatePrice = defineTool({
  name: 'update_price',
  description: '更新商品价格',
  schema: z.object({ sku: z.string(), price: z.number().positive() }),
  handler: async ({ sku, price }) => {
    const ok = await api.setPrice(sku, price)
    if (!ok) return toolError({ path: sku, code: 'NOT_FOUND', message: `SKU ${sku} 不存在` })
    return `已更新 ${sku} 价格为 ${price}`
  },
})
```

### Coexisting with dataSlotOps

Mix custom tools with built-in data slot tools:

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  dataSlots: [{ path: 'app.config', description: '配置', schema: z.record(z.any()) }],
  tools: [lookupOrder, updatePrice],   // custom + built-in dataSlotOps together
}).mount()
```

### Pure custom-tool agent (no dataSlotOps)

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  tools: [lookupOrder, updatePrice],
  capabilities: { dataSlotOps: false, fetch: false },   // drop built-ins
}).mount()
```

## 2. Skills (`defineSkill`) — progressive disclosure

Skills are **loaded on demand** by the agent (not always in context) → saves tokens. The agent sees an index of `name`+`description`, calls `load_skill` to pull the full content when needed.

### Inline content skill

```ts
import { createChatSdk, defineSkill } from 'page-agent-sdk'

const apiDesignSkill = defineSkill({
  name: 'api-design',
  description: '本项目 REST API 设计规范(何时用:设计/评审新接口)',
  getContent: () => `
- URL 用 kebab-case,统一 /v1 前缀
- 列表接口必须分页(page+pageSize)
- 错误返回 { code, message, data: null }
- 写操作记审计日志
`,
})

createChatSdk({ container: '#chat', llm: { ... }, skills: [apiDesignSkill] }).mount()
```

### Remote doc skill (auto-fetched + cached to vfs)

```ts
const brandSkill = defineSkill({
  name: 'brand-guide',
  description: '品牌视觉规范(何时用:涉及 UI/文案/配色)',
  doc: 'https://my-wiki/brand.md',   // SDK fetches + caches to vfs; large docs stay out of context
})

createChatSdk({ container: '#chat', llm: { ... }, skills: [brandSkill] }).mount()
```

> `SkillSpec = { name, description, doc?, getContent? }`. `doc` (http(s):// or `vfs://path`) takes precedence over `getContent`. Write `description` as "what it is + when to use" so the agent knows when to load it.

## 3. Subagents — ad-hoc spawn vs pre-declared

Subagents run isolated sub-tasks; **only their final conclusion** returns to the main context (saves tokens). Two flavors coexist.

### 3a. Ad-hoc `spawn_agent` / `spawn_agents` (default enabled)

The main agent decides when to delegate via `spawn_agent` (one) / `spawn_agents` (parallel). Configure the subagent tool subset:

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '多源对比时用 spawn_agents 并行委派。',
  subagent: {
    allowedTools: ['fetch_document', 'read'],  // read-only subset (no spawn → no recursion)
    maxDepth: 1,           // physical recursion cut (default 1)
    maxParallel: 3,        // max parallel subagents in spawn_agents
    temperature: 0.2,      // subagent temperature (default inherits main)
  },
}).mount()
```

User: "对比 A/B/C 三个方案" → main agent calls `spawn_agents` with 3 tasks → 3 subagents research in parallel → only conclusions return.

### 3b. Pre-declared named subagents (`subagents`) — Claude-Code style

Declare fixed roles; each auto-generates a `use_<id>({ task })` delegation tool. The main agent sees the tool description and knows who to delegate to:

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '复杂任务委派给专家子 agent。',
  subagents: [
    {
      id: 'researcher',
      description: '调研专家:搜集资料、对比方案(只读)',
      tools: ['fetch_document', 'read'],   // read-only
      temperature: 0.2,
    },
    {
      id: 'reviewer',
      description: '审查专家:检查代码/配置的安全与性能问题',
      tools: ['read', 'search_data_slot'],
      systemPrompt: '你是审查专家,只报告问题不改数据。',
      temperature: 0.1,
    },
  ],
}).mount()
```

Now the main agent has `use_researcher({ task })` and `use_reviewer({ task })` tools. Each subagent inherits main config where omitted (`llm`, `maxTokens`, `skills`...).

> Pre-declared = fixed roles (research/review); ad-hoc `spawn` = temporary free delegation. Both can coexist. `maxDepth` (default 1) physically cuts recursion: at depth+1 ≥ maxDepth, subagents get no spawn tools.

## 4. MCP (external tool servers)

Connect remote MCP servers; their tools auto-inject into the agent. `Promise.allSettled` → one server down doesn't break others.

### HTTP (StreamableHTTP) — recommended

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  mcp: [
    { transport: 'http', url: 'https://my-mcp-server/mcp', name: 'my-tools' },
  ],
}).mount()
```

### SSE / WebSocket

```ts
mcp: [
  { transport: 'sse',       url: 'https://another/sse' },
  { transport: 'websocket', url: 'wss://ws-server/mcp' },
]
```

### With request init (auth headers)

```ts
mcp: [
  {
    transport: 'http', url: 'https://my-mcp/mcp',
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  },
]
```

### Notes

- `@modelcontextprotocol/sdk` is an **optional peerDep** — install it only if you use `mcp`. It's dynamically imported (zero cost when unused).
- Browser supports **only remote transports** (http/sse/websocket), not stdio.
- MCP `inputSchema` (JSON Schema) is passed directly to LangChain `tool()` — no conversion.
- `inspect().mcp.servers` lists connected servers; each tool's `source` shows `mcp:<name>`.

### Dev gotcha

If you fork `vite.config.ts`, keep `optimizeDeps.include` pre-declaring the SDK sub-paths (`/client`, `/client/streamableHttp.js`, `/client/sse.js`, `/client/websocket.js`). Otherwise the **first cold visit** to an MCP page injects 0 tools (reload fixes it). The default config already has these.

## 5. Combining everything

```ts
createChatSdk({
  container: '#chat',
  llm: { apiKey, baseUrl, model },
  systemPrompt: '...',
  dataSlots: [{ path: 'app.data', description: '...', schema: z.record(z.any()) }],
  tools: [lookupOrder, updatePrice],          // custom tools
  skills: [apiDesignSkill, brandSkill],         // progressive skills
  subagents: [{ id: 'researcher', description: '...', tools: ['fetch_document'] }],  // pre-declared
  mcp: [{ transport: 'http', url: '...' }],     // external tools
  capabilities: { verify: true },               // self-check
  approval: { tools: ['write'] },     // human confirm writes
  checkpoint: true,                             // rollback
}).mount()
```
