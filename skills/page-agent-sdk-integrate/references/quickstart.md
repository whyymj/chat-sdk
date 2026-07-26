# Quickstart (progressive)

From the smallest working setup to a full-featured integration. Read top-down; stop wherever your needs are met.

## Stage 0 — Prerequisites

- An OpenAI-compatible LLM endpoint (DeepSeek works out of the box). Get an API key.
- A main data object you want the AI to edit (any plain or reactive object).

## Stage 1 — Minimal (5 lines, CDN, no build)

Drop into any HTML page. The built-in dialog mounts itself. (`systemPrompt` is optional — a built-in default is used if omitted: a generic JSON-operation assistant + `systemPromptHelpers.reliableWriteRules`. Shown here explicitly for clarity.)

```html
<div id="root"></div>
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const app = { title: 'Hello', theme: 'light' }   // plain object (no window needed)
  ChatSdk.createChatSdk({
    container: '#root',
    llm: { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    systemPrompt: 'You are a JSON operation assistant. Read/write the main data via tools.',
    data: {
      schema: ChatSdk.z.object({
        title: ChatSdk.z.string().describe('标题'),
        theme: ChatSdk.z.enum(['light', 'dark']).describe('主题'),
      }),
      bind: app,
    },
  }).mount()
</script>
```

Talk to it: "change theme to dark" → AI calls `write({ value: 'dark', patch: { op: 'set', jsonPath: 'theme' } })` → `app.theme === 'dark'`.

## Stage 2 — npm + module project

```bash
npm i page-agent-sdk zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'

const app = { title: 'Hello', theme: 'light', items: [] }

const sdk = createChatSdk({
  container: '#root',
  llm: { apiKey: import.meta.env.VITE_AI_API_KEY, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  systemPrompt: 'You are a JSON operation assistant. Read/write the main data via tools.',
  data: {
    schema: z.object({
      title: z.string().describe('标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
      items: z.array(z.object({ name: z.string(), price: z.number() })).describe('列表项'),
    }),
    bind: app,
  },
}).mount()
```

## Stage 3 — React to changes (replace polling)

Subscribe via `onEvent` (constructor) or `sdk.hook` (runtime, multi-listener, cancellable):

```ts
const sdk = createChatSdk({
  onEvent(e) {
    if (e.type === 'data_change') renderUI()       // host page refresh (plain-object bind needs this; reactive bind auto-refreshes)
    if (e.type === 'error') console.error(e.message)
  },
  // ...llm, data...
}).mount()

// runtime listener (e.g. analytics), cancellable
const off = sdk.hook((e) => { if (e.type === 'tool_call') track(e.name) })
// off()
```

> For Vue + `reactive()` bind, template/watch auto-refresh on write — no manual notify needed. For plain-object bind (React/vanilla/Node), subscribe `data_change` to re-render. Both can coexist (reactive for UI, `onEvent` for audit).

## Stage 4 — Headless (custom UI, framework-agnostic)

No built-in dialog; drive the reactive `messages` array yourself.

```ts
const sdk = createChatSdk({
  ui: false,                                  // headless
  llm: { ... }, systemPrompt: '...', data: { schema, bind: appObj },
}).mount()

// your own UI reads sdk.messages (reactive) and calls sdk.send
await sdk.send('add a new item: name=Pen, price=3')
```

Reusable `ChatDialog` / `MessageContent` / `CodePreview` components + `useChat` composable are also exported if you want to assemble a custom UI from existing parts.

## Stage 5 — Tune capabilities & safety

```ts
createChatSdk({
  // ...llm, data...
  capabilities: { verify: true },             // write-back self-check before agent returns
  verify: { maxAttempts: 2 },                 // auto-correct on failure (default check = write-back read + schema)
  approval: { tools: ['write'] },             // human-confirm before writes
  checkpoint: true,                           // session-level rollback on bad edits
  maxParallelTools: 1,                        // serial tool calls (safe for stateful middleware)
  contextPreset: 'conservative',              // save cost on long sessions
}).mount()
```

## Stage 6 — Persist across refresh / multi-session

```ts
createChatSdk({
  id: 'my-page-agent',          // STABLE id (multi-agent isolation); omit = random + warn
  storage: 'indexed',           // persist messages/vfs/todos/memory to IndexedDB (NOT bind — store & re-inject via sdk.setData)
  // ...llm, data...
}).mount()

// later, switch session:
await sdk.switchSession('session-abc')   // load or create
```

## Stage 7 — Swap data at runtime (dynamic / lazy-loaded schema)

When the page schema changes dynamically (e.g. lazy-loaded components with different structures), swap the whole main data config at runtime — tools pick up the new bind/schema immediately, no rebuild.

```ts
const sdk = createChatSdk({
  container: '#root', llm: { ... },
  data: { schema: initialSchema, bind: initialObj, description: '初始数据' },
}).mount()

// later: swap to a different schema + bind (lazy-loaded / dynamic)
sdk.setData({
  schema: newSchema,        // new zod schema (validation + field hints auto-injected)
  bind: newObj,             // new reactive/plain object
  description: '新数据',
})
// tools now operate on newObj with newSchema — immediately, no rebuild
sdk.getData()  // read current config
```

> `summarization` auto-embeds the current data description in compressed summaries, so the agent won't act on stale memory after a swap. Snapshots & optimistic-lock hash reset on swap (old snapshots cleared).

**Full runnable demo**: `examples/dynamic-demo/` (`npm run dev` → `/examples/dynamic-demo/`).

## Next

- All options: see [options.md](options.md)
- Instance API + tool/skill definition: see [api.md](api.md)
- End-to-end scenarios: see [use-cases.md](use-cases.md)
