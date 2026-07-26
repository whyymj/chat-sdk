# Quickstart (progressive)

From the smallest working setup to a full-featured integration. Read top-down; stop wherever your needs are met.

## Stage 0 — Prerequisites

- An OpenAI-compatible LLM endpoint (DeepSeek works out of the box). Get an API key.
- Page data you want the AI to edit, placed on `window` (e.g. `window.app = { ... }`).

## Stage 1 — Minimal (5 lines, CDN, no build)

Drop into any HTML page. The built-in dialog mounts itself. (`systemPrompt` is optional — a built-in default is used if omitted: a generic page-operation assistant + `systemPromptHelpers.reliableWriteRules`. Shown here explicitly for clarity.)

```html
<div id="root"></div>
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  window.app = { title: 'Hello', theme: 'light' }
  ChatSdk.createChatSdk({
    container: '#root',
    llm: { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    systemPrompt: 'You are a page assistant. Read/write window.app via tools.',
    dataSlots: [
      { path: 'app.title', description: '标题', schema: ChatSdk.z.string() },
      { path: 'app.theme', description: '主题', schema: ChatSdk.z.enum(['light','dark']) },
    ],
  }).mount()
</script>
```

Talk to it: "change theme to dark" → AI calls `write({ path:'app.theme', value:'dark' })` → `window.app.theme === 'dark'`.

## Stage 2 — npm + module project

```bash
npm i page-agent-sdk zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'

window.app = { title: 'Hello', theme: 'light', items: [] }

const sdk = createChatSdk({
  container: '#root',
  llm: { apiKey: import.meta.env.VITE_AI_API_KEY, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  systemPrompt: 'You are a page assistant. Read/write window.app via tools.',
  dataSlots: [
    { path: 'app.title',  description: '标题',   schema: z.string() },
    { path: 'app.theme',  description: '主题',   schema: z.enum(['light','dark']) },
    { path: 'app.items',  description: '列表项', schema: z.array(z.object({ name: z.string(), price: z.number() })) },
  ],
}).mount()
```

## Stage 3 — React to changes (replace polling)

Subscribe via `onEvent` (constructor) or `sdk.hook` (runtime, multi-listener, cancellable):

```ts
const sdk = createChatSdk({
  onEvent(e) {
    if (e.type === 'data_slot_change') renderUI()       // host page reactive refresh
    if (e.type === 'error') console.error(e.message)
  },
  // ...llm, dataSlots...
}).mount()

// runtime listener (e.g. analytics), cancellable
const off = sdk.hook((e) => { if (e.type === 'tool_call') track(e.name) })
// off()
```

## Stage 4 — Headless (custom UI, framework-agnostic)

No built-in dialog; drive the reactive `messages` array yourself.

```ts
const sdk = createChatSdk({
  ui: false,                                  // headless
  llm: { ... }, systemPrompt: '...', dataSlots: [...],
}).mount()

// your own UI reads sdk.messages (reactive) and calls sdk.send
await sdk.send('add a new item: name=Pen, price=3')
```

Reusable `ChatDialog` / `MessageContent` / `CodePreview` components + `useChat` composable are also exported if you want to assemble a custom UI from existing parts.

## Stage 5 — Tune capabilities & safety

```ts
createChatSdk({
  // ...llm, dataSlots...
  capabilities: { verify: true },             // write-back self-check before agent returns
  verify: { maxAttempts: 2 },                 // auto-correct on failure (default check = write-back read + schema)
  approval: { tools: ['write'] },                // human-confirm before writes
  checkpoint: true,                           // session-level rollback on bad edits
  maxParallelTools: 1,                        // serial tool calls (safe for stateful middleware)
  contextPreset: 'conservative',              // save cost on long sessions
}).mount()
```

## Stage 6 — Persist across refresh / multi-session

```ts
createChatSdk({
  id: 'my-page-agent',          // STABLE id (multi-agent isolation); omit = random + warn
  storage: 'indexed',           // persist messages/vfs/todos/memory to IndexedDB
  // ...llm, dataSlots...
}).mount()

// later, switch session:
await sdk.switchSession('session-abc')   // load or create
```

## Stage 7 — Dynamic dataSlots (lazy-loaded components)

Components loaded on demand with **different schemas each** — register at mount, unregister at unmount. No need to pre-declare every possible component at `createChatSdk`. The agent picks up new registrations immediately (no rebuild); `summarization` also embeds a live registry snapshot in compressed summaries so the agent won't act on stale memory.

```ts
const sdk = createChatSdk({
  container: '#root', llm: { ... },
  // only the static container is pre-declared; per-component paths are dynamic
  dataSlots: [{ path: 'app.components', description: '动态组件容器(按 id 存)', schema: z.record(z.string(), z.any()) }],
}).mount()

// component mounts (lazy) → register its schema, immediately operative
function mountComp(comp: { id: string; type: 'banner' | 'card' | 'stat' | 'chart' }) {
  window.app.components[comp.id] = reactive(comp)
  sdk.addDataSlot({
    path: `app.components.${comp.id}`,
    description: `${typeDescriptions[comp.type]}`,  // ← give the LLM field-level detail (it can't see the zod schema)
    schema: compSchemas[comp.type],                 // ← validation guardrail
  })
}
// component unmounts → unregister (snapshot stack cleaned too)
function unmountComp(id: string) {
  delete window.app.components[id]
  sdk.removeDataSlot(`app.components.${id}`)
}
sdk.listDataSlots()  // live registry (reflects dynamic add/remove)
```

> Key points: `description` is the LLM's only source of field structure (write it in detail); `schema` is the validation guardrail (the LLM never sees it). Write operations return the current operable path list; long-session compression keeps a live registry snapshot + preserved `describe`/`list` results so the agent never loses track of dynamic components.

**Full runnable demo**: `examples/dynamic-demo/` (`npm run dev` → `/examples/dynamic-demo/`).

## Next

- All options: see [options.md](options.md)
- Instance API + tool/skill definition: see [api.md](api.md)
- End-to-end scenarios: see [use-cases.md](use-cases.md)
