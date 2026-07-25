# Advanced examples — custom tools, skills, subagents, MCP, dynamic windowProps

Detailed, copy-paste examples for the extensibility surfaces. Read the section matching the user's need.

## 0. Dynamic windowProps (lazy-loaded components) — `sdk.addWindowProp` / `removeWindowProp`

When components are lazy-loaded with **different schemas each**, don't declare all `windowProps` upfront. Register them at runtime as components mount/unmount. The agent's window tools pick up new registrations immediately (no agent rebuild).

```ts
const sdk = createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是页面助手,按组件类型操作 window.app.components.<id>。',
  windowProps: [
    // statically-declared ones (always present)
    { path: 'app.config', description: '全局配置', schema: z.record(z.any()) },
  ],
}).mount()

// 组件懒加载时动态注册其 schema(结构各异)
function onComponentMount(comp: { id: string; type: string; schema: z.ZodType }) {
  sdk.addWindowProp({ path: `app.components.${comp.id}`, description: `${comp.type} 组件`, schema: comp.schema })
  // 立即生效:AI 现在能 set/edit_window_prop 这个 path,按其 schema 校验
}

// 组件卸载时移除(快照栈一并清理)
function onComponentUnmount(id: string) {
  sdk.removeWindowProp(`app.components.${id}`)
}

// 查看当前所有注册项(反映动态增删)
const current: WindowPropSpec[] = sdk.listWindowProps()
```

Notes:
- `addWindowProp` 覆盖同名 path 时保留旧快照栈;按新 schema 校验。
- 动态注册的属性**不自动纳入 checkpoint 快照**(checkpoint 的 windowPaths 在构造时固定);如需回滚动态组件,自行管理或重建。
- `inspect().windowProps` 与 `verify`(默认 `createWriteBackCheck`)均反映动态注册的最新 schemas(verify 每次 check 实时取 `listWindowProps()`)。
- `capabilities.windowOps:false` 时 `addWindowProp`/`removeWindowProp` 为 no-op(并 warn)。

## 1. Custom tools (`defineTool`)

Custom tools extend the agent beyond built-in `windowOps`/`fetch`. Use them to expose your product's API to the AI.

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

### Coexisting with windowOps

Mix custom tools with built-in window tools:

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  windowProps: [{ path: 'app.config', description: '配置', schema: z.record(z.any()) }],
  tools: [lookupOrder, updatePrice],   // custom + built-in windowOps together
}).mount()
```

### Pure custom-tool agent (no windowOps)

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  tools: [lookupOrder, updatePrice],
  capabilities: { windowOps: false, fetch: false },   // drop built-ins
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
    allowedTools: ['fetch_document', 'get_window_prop'],  // read-only subset (no spawn → no recursion)
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
      tools: ['fetch_document', 'get_window_prop'],   // read-only
      temperature: 0.2,
    },
    {
      id: 'reviewer',
      description: '审查专家:检查代码/配置的安全与性能问题',
      tools: ['get_window_prop', 'search_window_prop'],
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
  windowProps: [{ path: 'app.data', description: '...', schema: z.record(z.any()) }],
  tools: [lookupOrder, updatePrice],          // custom tools
  skills: [apiDesignSkill, brandSkill],         // progressive skills
  subagents: [{ id: 'researcher', description: '...', tools: ['fetch_document'] }],  // pre-declared
  mcp: [{ transport: 'http', url: '...' }],     // external tools
  capabilities: { verify: true },               // self-check
  approval: { tools: ['set_window_prop'] },     // human confirm writes
  checkpoint: true,                             // rollback
}).mount()
```
