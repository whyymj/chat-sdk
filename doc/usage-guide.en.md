# page-agent-sdk Usage Guide

> **[English](./usage-guide.en.md)** · **[中文](./usage-guide.md)**

> Framework-agnostic in-page Agent SDK: mount in one line, give any web page an AI chat dialog that can **read/write the host page, call tools, and plan tasks**.

> This is a condensed English guide covering the essentials. For full details (complete option tables, middleware deep-dive, imperative API), see the [Chinese usage guide](./usage-guide.md).

---

## Table of Contents

- [1. What it is](#1-what-it-is)
- [2. Install](#2-install)
- [3. Quick start (3 min)](#3-quick-start-3-min)
- [4. Core concepts](#4-core-concepts)
- [5. Options reference](#5-options-reference)
- [6. Capabilities](#6-capabilities)
- [7. Custom middleware](#7-custom-middleware)
- [8. Framework-agnostic / CDN](#8-framework-agnostic--cdn)
- [9. Environment variables](#9-environment-variables)
- [10. FAQ & gotchas](#10-faq--gotchas)

---

## 1. What it is

`page-agent-sdk` is a **JS SDK** that mounts a ReAct-based Tool-Calling Agent as a **chat dialog** on any web page. The Agent can:

- **Read/write host page** `window` props you declare (with schema validation + snapshot rollback) → directly drive your page UI
- **Call tools**: fetch docs, read/write virtual workspace, plus any custom tools you add
- **Plan multi-step tasks** (todos), **load skills on demand**, **remember persistent directives** (memory)
- **Persist conversations** (IndexedDB, falls back to memory), **multi-agent isolation**, **session switch**
- Auto-**retry** failed requests, support **stop generation**, **retry on error**

Framework-agnostic: Vue is bundled into the SDK; the host page needs no Vue. OpenAI-compatible (default DeepSeek).

## 2. Install

**Option 1: npm** (recommended for modular projects)

```bash
npm install page-agent-sdk
# also install peer deps
npm install zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
```

**Option 2: CDN · ESM** (esm.sh auto-resolves peers, small)

```html
<script type="module">
  import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'
</script>
```

**Option 3: CDN · IIFE** (one-line, zero-config, all deps bundled — for no-build setups)

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
</script>
```

## 3. Quick start (3 min)

Minimal example — let the Agent read/write `window.app`:

```ts
import { createChatSdk, z } from 'page-agent-sdk'

// 1. your page state (any structure; reactive/plain object both work)
const app = { title: 'Hello', theme: 'light' }
window.app = app  // optional: mount to window for your page to read; SDK tools operate on `bind` directly

// 2. mount the Agent
createChatSdk({
  container: '#agent',                    // mount point (selector or DOM element)
  id: 'my-app',                           // stable id (resume chat after refresh)
  storage: 'indexed',                     // enable persistence
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  systemPrompt: 'You are a page assistant. You may read/write the main data title / theme.',
  data: {
    schema: z.object({
      title: z.string().describe('Page title'),
      theme: z.enum(['light', 'dark']).describe('Theme'),
    }),
    bind: app,                            // direct-bind object (tools read/write bind, reactive refresh)
    description: 'App config',           // optional: auto-generated if omitted
  },
}).mount()
```

Open the page, type "change theme to dark" in the dialog → Agent calls `write({ value:{ theme:'dark' }, patch:{ op:'merge' } })` to change `app.theme` directly. Done.

## 4. Core concepts

| Concept | Description |
|---|---|
| **Agent** | ReAct loop: think → call tool → observe → think again, until final reply |
| **data** | You declare "which main data object the Agent may read/write + value schema". Agent can only write schema-valid values (scope + validation) |
| **tool** | The Agent's hands. Built-in window/vfs/fetch tools + ones you add via `defineTool` |
| **middleware** | Hooks into the Agent lifecycle. Built-in todos/skills/vfs/summarization/memory/permissions/verify; also custom |
| **storage** | Persist dialog/workspace/todos/memory (IndexedDB etc.), resumable after refresh |

**Mental model**: you only handle ① declare `data` (what the Agent can touch) ② write `systemPrompt` (what the Agent should do) ③ optionally add `tools`/`skills`/`middleware`. The rest is up to the Agent.

## 5. Options reference

```ts
createChatSdk({
  // basics
  container: '#root',              // mount point (selector or HTMLElement); required when ui:true
  ui: true,                        // false = headless (build UI with agent.messages + send/stream)
  id: 'my-agent',                  // stable id (multi-agent isolation + persistence resume)
  llm: { apiKey, baseUrl, model, temperature?, maxTokens? },  // or a LangChain BaseChatModel instance
  systemPrompt: '...',             // Agent identity + business flow (optional: built-in default — page assistant + reliableWriteRules — used if omitted; passing your own fully overrides it, you must re-append reliableWriteRules)
  // ⚠️ Tool usage (read/write/get/set/patch/autoLock/snapshot etc.) is auto-injected by the usageHints middleware per toolMode — do NOT declare it here; systemPrompt should only carry "business knowledge": identity, field meanings, business flow, skill refs

  // page data
  data: { schema, bind, description? },  // single main object: bind directly connects reactive/plain object (tools read/write bind, not auto-mounted to window); schema field .describe() auto-injected into systemPrompt「operable data」section
  tools: [...],                    // custom tools (defineTool)
  skills: [...],                   // custom skills (defineSkill)
  memory: '...',                   // AGENTS.md-style persistent directives

  // capability toggles (default all on; verify default off)
  capabilities: { planning?, dataOps?, fetch?, skills?, vfs?, summarization?, memory?, subagent?, verify? },

  // human-in-the-loop
  humanConfirm: true,               // proactive inquiry (default on; AI asks when uncertain/multi-plan)
  approval: { tools: ['write'] },  // passive confirm whitelist (default off)
  checkpoint: true,                 // session-level rollback (default off)

  // self-verify (needs capabilities.verify:true)
  verify: { check?, maxAttempts?, adversarial? },  // check omitted → createWriteBackCheck

  // subagents
  subagent: { allowedTools?, systemPrompt?, temperature?, llm?, maxDepth?, maxParallel? },
  subagents: [{ id, description, ... }],  // pre-declared → generates use_<id> tool

  // context
  contextPreset: 'auto',           // auto / conservative / aggressive
  contextOptions: { ... },         // fine params (false disables compression)
  summaryLlm: { ... },             // summary-dedicated LLM (defaults to main llm)
  maxMemoryRounds: 50,             // dialog history memory cap (0 disables trim)
  vfs: { maxBytes: 4*1024*1024 },  // in-memory workspace cap (LRU evict)

  // persistence
  storage: 'indexed',              // 'indexed'|'session'|'local'|'memory'|config|false (default off)
  session: { id?, autoResume?, title? },
  shareContext: false,             // same id instances share one agent

  // robustness
  maxRetries: 2,                   // model call retries (network/429/5xx)
  maxParallelTools: 1,              // per-round tool concurrency
  maxToolRounds: 10,               // max tool rounds

  // external tools
  mcp: [{ transport: 'http'|'sse'|'websocket', url, name? }],

  // custom middleware (appended to built-in stack)
  middleware: [...],

  // UI/debug
  streaming: true, title: '...', placeholder: '...', debug: false,
}).mount()
```

> For the complete option table with every field's type/default, see the [Chinese guide §5](./usage-guide.md#5-配置项参考).

## 6. Capabilities

### 6.1 data slot ops (let the Agent edit your JSON)

Declare `data`; the Agent reads/writes via tools, validated by schema:

- **`read`** / **`write`** (2.2+, recommended): high-level entry points merging list/describe/get and set/edit/delete + auto optimistic lock + auto snapshot — lowest LLM cognitive load
- `describe_data` / `describe_data` / `get_data` / `get_data` (hidden in `simple` mode, merged into `read`)
- `set_data` / `edit_data` (jsonPath incremental patch) / `delete_data` (hidden in `simple` mode, merged into `write`)
- `snapshot_data` / `list_data_snapshots` / `restore_data`
- `query_data` (JSONPath) / `search_data` (fuzzy) / `eval_script` (sandboxed)

Key points:
- `set`/`edit`/`delete` are restricted to registered props (scope control); `set`/`edit` validate against schema — invalid → structured error (no write)
- `edit_data` patches by `jsonPath` (set/remove/merge/append) — avoids re-sending the whole large JSON; writes in-place without replacing the root ref → Vue-reactive compatible
- Snapshots auto-stored before `set`/`edit`/`delete`; `restore_data` rolls back
- **Zero-bridge**: tool body's `window` = host page's main window (direct)

#### High-level `read`/`write` (2.2+, recommended)

```ts
// read: no path → list all operable slots; with path → current value + hash + schema hint
// Agent: read({}) → "Operable data slots: - page.title: page title ..."
// Agent: read({ path: 'page.title' }) → 'page.title = "Home" (hash=a1b2)\nformat: page title'

// write: three intents
// ① full set (value is a JSON object, no stringify needed)
write({ path: 'page.title', value: 'New title' })
// ② incremental patch (op=set/remove/merge/append, jsonPath relative to slot root)
write({ path: 'page', value: 'c', patch: { op: 'append', jsonPath: 'items' } })
write({ path: 'page', value: { title: 'Merged title' }, patch: { op: 'merge' } })
// ③ delete
write({ path: 'page.oldField', del: true })
```

`write` auto: ① schema validation (no write on failure) ② snapshot (rollback via `restore_data`) ③ optimistic lock (autoLock, compares hash from `read`; conflict → `VERSION_CONFLICT` or human escalation).

#### `toolMode` — tool presentation

```ts
createChatSdk({
  // ...,
  toolMode: 'simple',  // default: promote read/write, hide low-level get/set/edit/delete/list/describe (6), keep query/search/eval/snapshot (9 data-slot tools total)
  // toolMode: 'advanced',  // expose all (15 = old 13 + read/write; use when depending on low-level tool names)
  // toolMode: 'minimal',   // only read/write (2, simplest)
})
```

- `simple` (default): LLM sees only `read`/`write` + advanced query/snapshot — lowest cognitive load; `usageHints` auto-injects read/write guidance
- `advanced`: expose all (backward compat / debugging / precise control)
- `minimal`: only `read`/`write` (pure read/write scenarios, most token-efficient)

#### `interceptors` — read/write interceptors

Integrators can desensitize/transform/audit/reject the LLM's reads/writes:

```ts
createChatSdk({
  // ...,
  interceptors: {
    // intercept on read: desensitize (only changes what LLM sees, not actual storage)
    read: (path, value) => path.endsWith('secret') ? '***' : value,
    // intercept on write: transform/audit/reject
    write: (path, payload, current) => {
      if (path === 'app.locked') return { error: 'this field is locked' }
      return payload  // allow (can rewrite before returning)
    },
  },
})
```

- `read(path, value)`: return value is rewritten for LLM (desensitize/derive); throw → `READ_INTERCEPT`
- `write(path, payload, current)`: return rewritten value to allow, or `{error}` to reject (`WRITE_INTERCEPT`)
- `input(input)`/`output(json)`: agent-level IO pre/post-processing
  - `input`: preprocess user message at send entry (rewrite/audit)
  - `output`: postprocess before agent returns (rewrite final reply)

#### `data` single main-object config (recommended, declarative)

`data` is the single entry for data config — combining schema declaration + object direct-bind + auto field-hint injection:

```ts
import { reactive } from 'vue'  // or any reactivity impl
const PageSchema = z.object({
  title: z.string().describe('page title'),
  count: z.number().describe('count'),
})
const page = reactive({ title: 'Home', count: 0 })

const sdk = createChatSdk({
  // ...,
  data: {
    schema: PageSchema,       // zod schema: write validation + field .describe() auto-injected into systemPrompt「operable data」section
    bind: page,               // required: reactive/plain object direct-bind (tools read/write bind directly)
    description: 'Page config', // optional: auto-generated if omitted
  },
})
// LLM write page → page reactively updates; integrator changes page → LLM read sees it
```

- `bind` is required: direct-bind a reactive/plain object (tools read/write bind, reactive refresh); SDK no longer auto-mounts to window — integrator mounts `window.app = app` themselves if the page needs to read it
- `schema` field `.describe()` is auto-extracted (via `extractSchemaHint`) into the systemPrompt「operable data」section — no manual description needed
- Preview the hint to be injected: `extractSchemaHint(schema)` (exported)
- **`bind` does NOT require reactive**: any object works. The difference is "reactive refresh after write":
  - Pass `reactive(obj)` (Vue): Agent `write` mutates props → template/watch auto-reactive (recommended for UI)
  - Pass a plain object: Agent `write` can mutate data, but the page won't react (suitable for headless / backend / integrator-managed refresh via `onEvent` or `watch`)
  - Tools `set`/`write` use `restoreInPlace` to mutate props in-place (no root-ref replacement), compatible with reactive proxies; plain objects also write fine
- **Notifying the outside world of changes** (see §onEvent for details):
  - `onEvent` / `sdk.hook` subscribe to `data_change` event (fires after write, with `operation`/`value`) — for headless / non-Vue / plain-object bind
  - Vue reactivity (bind with reactive) — template/watch auto-react, no manual notify needed
  - `onEvent` and reactivity can coexist: reactivity for UI refresh, `onEvent` for audit/analytics/cross-system sync
- **Runtime swap**: `sdk.setData(config)` / `sdk.getData()` (replaces old add/remove/listDataSlots)

#### Optimistic lock (prevent stale-overwrite) & conflict human-in-the-loop

When the main data may be modified concurrently by **external code / other agents / manual user edits**, enable optimistic locking: `get_data`/`read` returns a value with `hash=xxx` appended (hash of the entire bound object); pass `expectedHash` on write to verify against the whole object.

```ts
// Agent workflow (run by the LLM automatically; integrator writes nothing)
// 1. read({ jsonPath:'title' }) → "main data @ title = old (hash=a1b2)"
// 2. write({ value:'new', patch:{ op:'set', jsonPath:'title' } })  // auto-locks with last read hash (whole-object)
//    if any field externally modified since → whole-object hash mismatch → conflict
```

**On conflict (human-in-the-loop enabled by default):** the tool suspends, `sdk.pendingConflict` ref is set, and the built-in ChatDialog shows a conflict bar with three choices:

| Option | Behavior | Result |
|--------|----------|--------|
| **Keep external** | Don't write, keep the externally-modified value | Agent re-gets and retries |
| **Overwrite** | Execute the agent's write | Overrides external change |
| **Restore** | Roll back to snapshot stack top (historical checkpoint) | Undo external change + agent doesn't write |

```ts
const sdk = createChatSdk({ /* ... */ })
await sdk.mount()

// Built-in UI handles the conflict bar automatically; for headless custom UI:
import { watch } from 'vue'
watch(sdk.pendingConflict, (c) => {
  if (!c) return
  // c: { id, path, op, agentValue, currentValue, currentHash, expectedHash, snapshotId }
  showConflictDialog(c, (action) => sdk.resolveConflict(action)) // 'keep_external'|'overwrite'|'restore'
})

// or via event subscription
sdk.hook((e) => {
  if (e.type === 'conflict') showConflictDialog(e.conflict, (a) => sdk.resolveConflict(a))
})
```

**Auto-resolution (prevent permanent hang):** on user stop (abort) / `unmount()` / `switchSession()`, a pending conflict is auto-resolved as "keep external".

> Omitting `expectedHash` → backward-compatible direct write (no check). Using `createDataOps(props, { onConflict })` standalone (without ChatDialog), handle conflicts yourself (return `Promise<{action}>`).

### 6.2 Custom tools

```ts
import { defineTool, z } from 'page-agent-sdk'
const weather = defineTool({
  name: 'get_weather',
  description: 'Get weather for a city',
  schema: z.object({ city: z.string() }),
  handler: (args) => `Weather in ${args.city}: sunny`,
})
createChatSdk({ tools: [weather], /*...*/ })
```

### 6.3 Skills (progressive disclosure)

```ts
import { defineSkill } from 'page-agent-sdk'
const styleGuide = defineSkill({
  name: 'style_guide',
  description: 'Brand color spec',
  body: 'Primary #1f4d3a, accent #2d6a4f…',
})
createChatSdk({ skills: [styleGuide], /*...*/ })
```
The Agent sees only name+description upfront; `load_skill` fetches the full body on demand (saves context).

### 6.4 Memory (persistent directives)

`memory: '...'` — AGENTS.md-style persistent instructions injected into every conversation (style guides, conventions, do/don'ts).

### 6.5 Planning (auto)

`write_todos` tool (enabled via `capabilities.planning`, default on) — the Agent plans multi-step tasks as a todo list.

### 6.6 Persistence & sessions

`storage: 'indexed'` (or `'session'`/`'local'`/`'memory'`) — persists dialog/workspace/todos/memory; `id` isolates multiple agents; `switchSession(id?)` switches; `shareContext:true` lets same-id instances share one agent.

### 6.7 Robustness

- Auto-retry model calls (network/429/5xx, exponential backoff, `maxRetries` default 2)
- Stop generation (abort) — preserves partial content
- Retry on error (UI)

### 6.8 Context & memory caps

- 4-layer adaptive compression (`contextPreset`: auto/conservative/aggressive)
- vfs `maxBytes` (default 4MB) LRU evict; dialog `maxMemoryRounds` (default 50) trim

### 6.9 onEvent callback (subscribe to common moments)

`createChatSdk({ onEvent })` provides a lightweight event callback to subscribe to common moments during Agent runs, for **external integration** (host page reactive refresh, analytics, logging, custom UI sync) — replacing polling. Works in both UI and headless modes.

**Event types** (`SdkEvent`):

| Event | When | Fields |
|---|---|---|
| `data_change` | After Agent calls a write tool (high-level `write`, or low-level `set`/`edit`/`delete`/`restore_data`) | `operation` (`set`/`edit`/`delete`/`restore`; `write` infers from args) / `value` (post-change value, i.e. the entire bind) |
| `message_update` | After each Agent round | `count` (message count) |
| `tool_call` | Before tool call (stream mode) | `name` / `args` |
| `tool_result` | After tool returns (stream mode) | `name` / `result` / `status` |
| `text` / `reasoning` | Streaming text/reasoning delta (stream mode) | `delta` |
| `round_start` | Each model call round start | `round` |
| `subagent` | Subagent tool progress | `taskId`/`label`/`kind`/`name`/... |
| `done` | Round reply complete (stream mode) | `content` |
| `error` | Model call / tool throws | `message` |

> ⚠️ `approval_request` is NOT forwarded (UI already handles it, to avoid double `resolve`).
> ⚠️ `tool_call`/`tool_result`/`text`/`done` etc. fire only in **stream mode** (UI defaults to stream; imperative `sdk.send` uses invoke — no stream events, but `data_change`/`message_update`/`error` still fire).

**Example** (host page reactive refresh, replacing `setInterval` polling):

```ts
createChatSdk({
  /* ... */
  onEvent(event) {
    if (event.type === 'data_change') {
      // Agent changed the main data → refresh your UI mirror in real time
      renderState()
    } else if (event.type === 'tool_call') {
      analytics.track('agent_tool_call', { name: event.name })
    } else if (event.type === 'error') {
      console.error('agent error', event.message)
    }
  },
}).mount()
```

> For deeper interception/enhancement (mutating messages, wrapping model calls, contributing tools) use **custom middleware** (next section); `onEvent` is for read-only observation.

**`sdk.hook(handler)` — runtime subscription (multiple listeners, cancellable)**

Besides the constructor-time `onEvent`, the instance exposes a `hook` method for runtime subscription — register multiple listeners, each returning an unsubscribe function:

```ts
const sdk = createChatSdk({ /* onEvent not required */ }).mount()

// listener 1: host page reactive refresh
const off1 = sdk.hook((event) => {
  if (event.type === 'data_change') renderUI()
})

// listener 2: analytics (coexists with listener 1, independent)
const off2 = sdk.hook((event) => {
  if (event.type === 'tool_call') analytics.track('tool', { name: event.name })
})

// unsubscribe
off1()
off2()
```

`onEvent` and `hook` are complementary: the former is a single constructor-time callback, the latter runtime multi-listener; both can coexist. Event types and filtering rules as above (`approval_request` not forwarded; stream events only in stream mode).

## 7. Custom middleware

```ts
import { type Middleware } from 'page-agent-sdk'
const mw: Middleware = {
  name: 'telemetry',
  // 8 hooks: beforeAgent / wrapModelCall / beforeModel / afterModel / wrapToolCall / afterAgent / beforeReturn
  //         + augmentPrompt / compressInput / tools
  afterModel: async (ctx, next) => {
    await next(ctx)
    console.log('round done')
  },
}
createChatSdk({ middleware: [mw], /*...*/ })
```
- before-hooks run in order; after-hooks in reverse; wrap-hooks onion-style (reduceRight)
- Custom middleware is appended after the built-in stack

> For the full middleware contract & extension patterns, see the [Chinese guide §7](./usage-guide.md#7-高级自定义中间件).

### 7.5 Server-side (Node.js) usage

The SDK core is **framework-agnostic JS** and runs in Node.js (headless mode) as a backend Agent (custom tool orchestration, doc fetching, subagent parallelism, self-verify).

**Server config essentials**:
- `ui: false` — headless, no ChatDialog (server has no DOM)
- `capabilities: { dataOps: false, fetch: false }` — disable browser-dependent tools (dataOps needs `window`; `fetch_document` needs `fetch` — Node 18+ has global fetch, can keep)
- `storage: 'memory'` — memory backend (server has no IndexedDB/localStorage); omit for non-persistent
- Inject business tools via `tools` (`defineTool`); drive via `send`/`stream`

**Example** (Node.js backend Agent + custom tool):

```ts
import { createChatSdk, defineTool, z } from 'page-agent-sdk'

const add = defineTool({
  name: 'add', description: 'Add two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: (args) => `${args.a + args.b}`,
})

const sdk = createChatSdk({
  container: null, ui: false, id: 'server-agent',
  storage: 'memory',
  llm: { apiKey: process.env.AI_API_KEY, baseUrl: '...', model: '...' },
  systemPrompt: 'You are a calc assistant; use add tool.',
  capabilities: { dataOps: false, fetch: false },
  tools: [add],
})
await sdk.mount()
const reply = await sdk.send('What is 3 plus 5?')
console.log(reply) // AI calls add → "3 + 5 = 8"
```

**Server-available**: custom tools / `fetch_document` (Node 18+) / subagents / verify / vfs / context compression / memory / onEvent
**Server-unavailable**: dataOps (needs `window`) / ChatDialog UI (needs DOM) / IndexedDB·localStorage·sessionStorage (use `memory`)

> `eval_script` relies on Web Worker (part of dataOps, disabled). MCP remote tools (http/sse/websocket) also work in Node (dynamic import `@modelcontextprotocol/sdk`).

## 8. Framework-agnostic / CDN

See `demo/plain.html` (importmap + esm.sh providing peer deps). IIFE one-liner:

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
  createChatSdk({ /*...*/ }).mount()
</script>
```

Headless (`ui:false`): no built-in dialog; use `agent.messages` (reactive array) + `send`/`stream` to build your own UI — fully framework-agnostic (no Vue forced).

## 9. Environment variables

`.env` (VITE_ prefix):

```bash
VITE_AI_API_KEY=sk-...
VITE_AI_BASE_URL=https://api.deepseek.com
VITE_AI_MODEL=deepseek-chat
VITE_AI_TEMPERATURE=0.3        # low temp for structured ops
# VITE_AI_MAX_TOKENS=           # omit → model default
VITE_AI_SYSTEM_PROMPT=...       # must be single-line
```

## 10. FAQ & gotchas

**Q: Model returns `400 missing field tool_call_id`?**
A: LangChain `ToolMessage` uses snake_case `tool_call_id` (not camelCase). The SDK handles this internally; if you build messages manually, use `tool_call_id`.

**Q: `ChatOpenAI` param errors?**
A: Use `apiKey` (not `openAIApiKey`), `model` (not `modelName`); `baseUrl` goes via `configuration.baseURL`.

**Q: DeepSeek `baseUrl` — with or without `/v1`?**
A: Both work for DeepSeek (OpenAI-compatible). `https://api.deepseek.com` or `https://api.deepseek.com/v1` are both fine.

**Q: Multi-agent on one page?**
A: Give each `createChatSdk` a distinct `id`; they isolate by id. Same `id` + `shareContext:true` → share one agent (multiple dialog views).

**Q: Persistence not resuming after refresh?**
A: `id` must be a stable value (not omitted — random id can't resume). `storage` must be enabled (default off).

**Q: Large JSON blows context?**
A: Tool results > 6000 chars auto-offload to vfs (only preview + `vfs_read`/`vfs_grep` refs stay). `write` with `patch` to avoid re-sending whole JSON.

**Q: `verify` not taking effect?**
A: `verify` needs `capabilities.verify:true` (default off). `inspect().verify` shows load status.

> More FAQs in the [Chinese guide §11](./usage-guide.md#11-常见问题与坑).

## 11. Use-case index (end-to-end scenarios)

Nine end-to-end scenarios with copy-paste code live in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/use-cases.md` (also shipped in the npm package; install the skill per README "Skills for AI tools"):

| # | Scenario | Key setup |
|---|---|---|
| 1 | Low-code page builder | `data` = component tree; `write` with `patch` jsonPath; `onEvent` → canvas refresh; `checkpoint` + `approval` |
| 2 | Form designer | `data` = field defs (enum/required schemas); schema validation prevents malformed forms |
| 3 | CMS batch ops | `eval_script` bulk loops; `search_data` filter; `write` with `patch` targeted edits |
| 4 | Ops config console | `approval` human-confirm; `capabilities.verify:true` write-back read; `checkpoint` |
| 5 | AI-native assistant | `capabilities:{dataOps:false,fetch:false}` + custom `tools` (product API) |
| 6 | Research agent | `capabilities:{dataOps:false}`; `subagent:{allowedTools:['fetch_document']}`; `contextPreset:'conservative'` |
| 7 | Server-side Node.js | `ui:false` + `storage:'memory'` + `capabilities:{dataOps:false,fetch:false}`; drive via `sdk.send` |
| 8 | Multi-agent on one page | same `id` + `shareContext:true` → multiple dialogs share one `AgentCore` |
| 9 | MCP integration | `mcp:[{transport,url}]` remote tools; `@modelcontextprotocol/sdk` optional peerDep |

Runnable demos per scenario: `examples/nested-demo` (1), `examples/page-demo` (1/2), `examples/subagent-demo` (6), `examples/mcp-demo` (9), `examples/human-confirm-demo` (4), `examples/planner-demo` (planning), `examples/toolsets-demo` (tool separation).

**Advanced extensibility examples** (custom tools / skills / subagents / MCP) in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/advanced.md`: copy-paste code for `defineTool` (error handling + coexisting with dataOps), `defineSkill` (inline content + remote doc), subagents (ad-hoc `spawn_agent`/`spawn_agents` + pre-declared `subagents` → `use_<id>`), MCP (http/sse/websocket + auth + dev gotcha).
