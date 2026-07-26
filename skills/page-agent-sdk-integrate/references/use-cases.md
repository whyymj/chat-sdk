# Use cases — end-to-end scenarios

Concrete integration patterns for common scenarios. Each shows the key `data` + options that matter. Adapt the LLM config to your provider.

## 1. Low-code page builder

A visual builder where the page is a component tree; the AI edits the tree via jsonPath patches and the canvas re-renders live.

```ts
const page = {
  components: [
    { id: 'banner', type: 'banner', props: { title: 'Welcome', bg: '#1f4d3a' } },
    { id: 'card1', type: 'card', props: { title: '新品', price: 99 } },
  ],
}

createChatSdk({
  container: '#chat',
  llm: { apiKey, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.3 },
  systemPrompt: '你是页面搭建助手。用 write 的 patch 按 jsonPath 增量改 components,不要重传整树。',
  data: {
    schema: z.object({
      components: z.array(z.object({
        id: z.string(), type: z.string(),
        props: z.record(z.any()),
      })).describe('组件树'),
    }),
    bind: page,
  },
  onEvent(e) { if (e.type === 'data_change') renderCanvas() },  // canvas refresh (plain-object bind)
  checkpoint: true,                       // bad edit → one-click rollback
  approval: { tools: ['write'] },        // confirm writes
}).mount()
```

User: "顶部 Banner 改深色、主标题加粗、加一张新品卡" → AI calls `write` with `patch` per component.

## 2. Form designer

Form schema as data; AI edits field definitions, schema validation prevents malformed forms.

```ts
const form = {
  fields: [
    { name: 'phone', label: '手机号', type: 'text', required: true, validation: 'none' },
    { name: 'address', label: '地址', type: 'text', required: false, cascade: false },
  ],
}

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是表单设计助手。改 fields 的字段定义,保持 schema 合法。',
  data: {
    schema: z.object({
      fields: z.array(z.object({
        name: z.string(), label: z.string(),
        type: z.enum(['text','number','select','date']),
        required: z.boolean(),
        validation: z.enum(['none','phone','email','idcard']),
        cascade: z.boolean().optional(),
      })).describe('字段定义数组'),
    }),
    bind: form,
  },
  onEvent(e) { if (e.type === 'data_change') renderForm() },
}).mount()
```

User: "手机号加格式校验、地址改三级联动" → AI patches `fields.0.validation='phone'`, `fields.1.cascade=true`.

## 3. CMS batch operation

Bulk-edit a product list; use `eval_script` or `search_data` + `write` with `patch` for batch ops.

```ts
const products = [
  { id: 1, title: '商品A', price: 99, highlight: false },
  { id: 2, title: '商品B', price: 150, highlight: false },
  // ...hundreds
]

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是运营助手。批量改 products;标题加前缀用 eval_script,按条件筛选用 search_data。',
  data: {
    schema: z.object({
      products: z.array(z.object({
        id: z.number(), title: z.string(), price: z.number(), highlight: z.boolean(),
      })).describe('商品列表'),
    }),
    bind: { products },
  },
  onEvent(e) { if (e.type === 'data_change') renderTable() },
}).mount()
```

User: "标题加『限时』前缀、低于 100 元的标红" → AI uses `eval_script` for the prefix loop + `search_data` to find `<100` then `write` with `patch` to set `highlight`.

## 4. Ops config console

Edit experiment thresholds / feature flags with human confirmation.

```ts
const config = {
  expA: { threshold: 0.5, enabled: true },
  featureB: { enabled: false },
}

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是运维助手。改 config 前必须经用户确认。',
  data: {
    schema: z.object({
      expA: z.object({ threshold: z.number().min(0).max(1), enabled: z.boolean() }).describe('实验A'),
      featureB: z.object({ enabled: z.boolean() }).describe('B开关'),
    }),
    bind: config,
  },
  approval: { tools: ['write'] },  // human-in-the-loop
  checkpoint: true,
  capabilities: { verify: true },           // write-back read + schema check
}).mount()
```

User: "A 实验阈值调到 30%、关掉 B 开关" → AI proposes writes → user confirms → verify reads back.

## 5. AI-native assistant (no page data, custom tools)

The agent drives your product's own API via custom tools (no dataOps).

```ts
const lookupTool = defineTool({
  name: 'lookup_order',
  description: '查询订单',
  schema: z.object({ orderId: z.string() }),
  handler: async ({ orderId }) => JSON.stringify(await api.getOrder(orderId)),
})

createChatSdk({
  container: '#chat',
  llm: { ... },
  systemPrompt: '你是订单助手。用 lookup_order 查询。',
  tools: [lookupTool],
  capabilities: { dataOps: false, fetch: false },   // pure custom-tool agent
}).mount()
```

## 6. Research agent (fetch + subagents, no writes)

Pure research: fetch docs, parallel subagents for multi-source investigation.

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是调研助手。多源对比用 spawn_agents 并行委派。',
  capabilities: { dataOps: false },       // read-only, no data edits
  subagent: { allowedTools: ['fetch_document'] },
  contextPreset: 'conservative',         // long research sessions
}).mount()
```

## 7. Headless server-side (Node.js)

Run the agent in Node (no browser). dataOps body works in Node with any `bind` object; only `eval_script` needs Web Worker (disable via `capabilities:{dataOps:false}` if unused).

```ts
// node mjs
import { createChatSdk, z } from 'page-agent-sdk'

const sdk = createChatSdk({
  ui: false,
  storage: 'memory',
  llm: { apiKey, baseUrl, model },
  systemPrompt: '...',
  data: { schema: z.object({ result: z.string() }), bind: { result: '' } },
  capabilities: { fetch: false },         // dataOps body works; eval_script needs worker
  tools: [/* your tools */],
})
await sdk.mount()
const reply = await sdk.send('do something')
console.log(reply)
sdk.unmount()
```

## 8. Multi-agent on one page (shared context)

Two dialogs backed by one agent brain.

```ts
const a = createChatSdk({ id: 'shared', container: '#dlg-a', llm: {...}, shareContext: true, data }).mount()
const b = createChatSdk({ id: 'shared', container: '#dlg-b', llm: {...}, shareContext: true, data }).mount()
// a & b share messages/agent/vfs/todos/memory/bind — two views of one agent
```

## 9. MCP integration (external tool servers)

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  mcp: [
    { transport: 'http', url: 'https://my-mcp-server/mcp' },
    { transport: 'sse',  url: 'https://another/sse' },
  ],
  // MCP tools auto-injected; fault-isolated (one server down doesn't break others)
}).mount()
```

> Note: `@modelcontextprotocol/sdk` is an optional peerDep — install it only if you use `mcp`. Browser supports only remote transports (http/sse/websocket), not stdio.

## 10. Dynamic / lazy-loaded schema (swap main data at runtime)

When the page schema changes dynamically (lazy-loaded components with different structures), swap the whole main data config at runtime — tools pick up the new bind/schema immediately, no rebuild.

```ts
const sdk = createChatSdk({
  container: '#chat', llm: { ... },
  data: { schema: initialSchema, bind: initialObj, description: '初始数据' },
  systemPrompt: '用 read() 查看当前可操作字段,按 schema 操作',
}).mount()

// later: swap to a different schema + bind (lazy-loaded / dynamic)
function onComponentTypeChange(comp: { schema: z.ZodType; bind: any }) {
  sdk.setData({
    schema: comp.schema,   // new zod schema (validation + field hints auto-injected)
    bind: comp.bind,       // new reactive/plain object
    description: `${comp.type} 组件数据`,
  })
  // tools now operate on comp.bind with comp.schema — immediately, no rebuild
}

sdk.getData()  // read current config (reflects runtime swap)
```

**完整可运行示例**:`examples/dynamic-demo/`(`npm run dev` → `/examples/dynamic-demo/`)。
**何时用**:可视化编辑器/低代码平台中,组件按需加载且结构各异(图表/表单/卡片 schema 各不同),无法在初始化时确定唯一 schema。详见 `advanced.md` §0。
