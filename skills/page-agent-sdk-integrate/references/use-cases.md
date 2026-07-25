# Use cases — end-to-end scenarios

Concrete integration patterns for common scenarios. Each shows the key `dataSlots` + options that matter. Adapt the LLM config to your provider.

## 1. Low-code page builder

A visual builder where the page is a component tree; the AI edits the tree via jsonPath patches and the canvas re-renders live.

```ts
window.page = {
  components: [
    { id: 'banner', type: 'banner', props: { title: 'Welcome', bg: '#1f4d3a' } },
    { id: 'card1', type: 'card', props: { title: '新品', price: 99 } },
  ],
}

createChatSdk({
  container: '#chat',
  llm: { apiKey, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.3 },
  systemPrompt: '你是页面搭建助手。用 edit_data_slot 按 jsonPath 增量改 components,不要重传整树。',
  dataSlots: [
    { path: 'page.components', description: '组件树',
      schema: z.array(z.object({
        id: z.string(), type: z.string(),
        props: z.record(z.any()),
      })) },
  ],
  onEvent(e) { if (e.type === 'data_slot_change') renderCanvas() },  // canvas reactive refresh
  checkpoint: true,                       // bad edit → one-click rollback
  approval: { tools: ['set_data_slot', 'edit_data_slot'] },  // confirm writes
}).mount()
```

User: "顶部 Banner 改深色、主标题加粗、加一张新品卡" → AI calls `edit_data_slot` per component.

## 2. Form designer

Form schema as data; AI edits field definitions, schema validation prevents malformed forms.

```ts
window.form = {
  fields: [
    { name: 'phone', label: '手机号', type: 'text', required: true, validation: 'none' },
    { name: 'address', label: '地址', type: 'text', required: false, cascade: false },
  ],
}

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是表单设计助手。改 form.fields 的字段定义,保持 schema 合法。',
  dataSlots: [
    { path: 'form.fields', description: '字段定义数组',
      schema: z.array(z.object({
        name: z.string(), label: z.string(),
        type: z.enum(['text','number','select','date']),
        required: z.boolean(),
        validation: z.enum(['none','phone','email','idcard']),
        cascade: z.boolean().optional(),
      })) },
  ],
  onEvent(e) { if (e.type === 'data_slot_change') renderForm() },
}).mount()
```

User: "手机号加格式校验、地址改三级联动" → AI patches `form.fields[0].validation='phone'`, `form.fields[1].cascade=true`.

## 3. CMS batch operation

Bulk-edit a product list; use `eval_script` or `search_data_slot` + `edit_data_slot` for batch ops.

```ts
window.products = [
  { id: 1, title: '商品A', price: 99, highlight: false },
  { id: 2, title: '商品B', price: 150, highlight: false },
  // ...hundreds
]

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是运营助手。批量改 products;标题加前缀用 eval_script,按条件筛选用 search_data_slot。',
  dataSlots: [
    { path: 'products', description: '商品列表',
      schema: z.array(z.object({
        id: z.number(), title: z.string(), price: z.number(), highlight: z.boolean(),
      })) },
  ],
  onEvent(e) { if (e.type === 'data_slot_change') renderTable() },
}).mount()
```

User: "标题加『限时』前缀、低于 100 元的标红" → AI uses `eval_script` for the prefix loop + `search_data_slot` to find `<100` then `edit_data_slot` to set `highlight`.

## 4. Ops config console

Edit experiment thresholds / feature flags with human confirmation.

```ts
window.config = {
  expA: { threshold: 0.5, enabled: true },
  featureB: { enabled: false },
}

createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是运维助手。改 config 前必须经用户确认。',
  dataSlots: [
    { path: 'config.expA', description: '实验A',
      schema: z.object({ threshold: z.number().min(0).max(1), enabled: z.boolean() }) },
    { path: 'config.featureB', description: 'B开关',
      schema: z.object({ enabled: z.boolean() }) },
  ],
  approval: { tools: ['set_data_slot', 'edit_data_slot'] },  // human-in-the-loop
  checkpoint: true,
  capabilities: { verify: true },           // write-back read + schema check
}).mount()
```

User: "A 实验阈值调到 30%、关掉 B 开关" → AI proposes writes → user confirms → verify reads back.

## 5. AI-native assistant (no page data, custom tools)

The agent drives your product's own API via custom tools (no dataSlotOps).

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
  capabilities: { dataSlotOps: false, fetch: false },   // pure custom-tool agent
}).mount()
```

## 6. Research agent (fetch + subagents, no writes)

Pure research: fetch docs, parallel subagents for multi-source investigation.

```ts
createChatSdk({
  container: '#chat', llm: { ... },
  systemPrompt: '你是调研助手。多源对比用 spawn_agents 并行委派。',
  capabilities: { dataSlotOps: false },       // read-only, no page edits
  subagent: { allowedTools: ['fetch_document'] },
  contextPreset: 'conservative',             // long research sessions
}).mount()
```

## 7. Headless server-side (Node.js)

Run the agent in Node (no browser). Provide `globalThis.window` only if you enable dataSlotOps.

```ts
// node mjs
import { createChatSdk, z } from 'page-agent-sdk'

const sdk = createChatSdk({
  ui: false,
  storage: 'memory',
  llm: { apiKey, baseUrl, model },
  systemPrompt: '...',
  capabilities: { dataSlotOps: false, fetch: false },
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
const a = createChatSdk({ id: 'shared', container: '#dlg-a', llm: {...}, shareContext: true, dataSlots }).mount()
const b = createChatSdk({ id: 'shared', container: '#dlg-b', llm: {...}, shareContext: true, dataSlots }).mount()
// a & b share messages/agent/vfs/todos/memory — two views of one agent
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

## 10. Lazy-loaded components with dynamic schemas (dynamic dataSlots)

Components loaded on demand with **different structures each** — register their schema at mount time, unregister at unmount. No need to pre-declare every possible component at `createChatSdk`.

```ts
const sdk = createChatSdk({
  container: '#chat', llm: { ... },
  // only the static container is pre-declared; per-component paths are dynamic
  dataSlots: [{ path: 'app.components', description: '动态组件容器', schema: z.record(z.any()) }],
  systemPrompt: '用 list_data_slots 查看当前可操作的组件 path,再按各自 schema 操作',
}).mount()

// 组件挂载(懒加载)→ 动态注册其 schema,立即对 AI 生效
function mountComp(comp: { id: string; type: CompType }) {
  window.app.components[comp.id] = reactive(comp)
  sdk.addDataSlot({
    path: `app.components.${comp.id}`,
    description: `${comp.type} 组件`,
    schema: compSchemas[comp.type],   // 结构各异:banner/card/stat/chart 各自 schema
  })
}
// 组件卸载 → 动态移除注册(快照栈一并清理)
function unmountComp(id: string) {
  delete window.app.components[id]
  sdk.removeDataSlot(`app.components.${id}`)
}
```

**完整可运行示例**:`examples/dynamic-demo/`(`npm run dev` → `/examples/dynamic-demo/`)。
**何时用**:可视化编辑器/低代码平台中,组件按需加载且结构各异(图表/表单/卡片 schema 各不同),无法在初始化时穷举所有组件 schema。详见 `advanced.md` §0。
