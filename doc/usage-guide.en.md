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

**Import only what you need (subpath exports)**: besides the top-level `page-agent-sdk`, three subpath entries scope your import to a single capability (the bundler tree-shakes the rest):

| subpath | key exports | use case |
|---|---|---|
| `page-agent-sdk/storage` | `createSessionStore` / `createMemoryBackend` / `createWebStorageBackend` / `isQuotaError` | persistence layer only, no Agent |
| `page-agent-sdk/query` | `jpEval` / `searchJson` / `runSandboxedScript` + all jsonUtils / schemaUtils pure fns | JSON query / sandbox / path helpers |
| `page-agent-sdk/llm` | `createProxyLlm` + `ProxyLlmMode` / `ProxyLlmOptions` | proxy connection to avoid leaking apiKey |

```js
import { createSessionStore, createMemoryBackend } from 'page-agent-sdk/storage'
import { getByPath, setByPath, hashValue } from 'page-agent-sdk/query' // jsonUtils pure fns
```

> All three subpaths currently resolve to the same dist + types (no multi-entry build yet) — clear semantics and per-entry CDN fetch; when a multi-entry build lands, your import paths won't change.

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
  systemPrompt: '...',             // Agent identity + business flow (optional: built-in default — JSON operation assistant + reliableWriteRules — used if omitted; passing your own fully overrides it. appendReliableWriteRules defaults to true: auto-appends reliableWriteRules with a '---' separator; set false to disable)
  // ⚠️ Tool usage (read/write/get/set/patch/autoLock/snapshot etc.) is auto-injected by the usageHints middleware per toolMode — do NOT declare it here; systemPrompt should only carry "business knowledge": identity, field meanings, business flow, skill refs

  // page data
  data: { schema, bind, description? },  // single main object: bind directly connects reactive/plain object (tools read/write bind, not auto-mounted to window); schema field .describe() auto-injected into systemPrompt「operable data」section
  tools: [...],                    // custom tools (defineTool)
  skills: [...],                   // custom skills (defineSkill)
  memory: '...',                   // AGENTS.md-style persistent directives
  actions: { name: { description, run, params? } },  // host actions (2.18+): SDK wraps each as a named tool (save_draft/publish…); see §6
  schemaHint: { maxKeys?, maxChars? },               // large-schema tiered disclosure thresholds (2.18+; default 15/4000); see §6

  // capability toggles (default all on; verify default off)
  capabilities: { planning?, dataOps?, fetch?, skills?, vfs?, summarization?, memory?, subagent?, verify?, domInspect?, inspectEnv?, draftWrite?, workingMemory? },  // domInspect (get_dom, 2.18+) default off; inspectEnv (inspect_env, reads window/env, 2.18+) default on; draftWrite (draft_write/draft_commit chunked build, 2.19+) default off opt-in; workingMemory default on

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
  contextPreset: 'auto',           // auto / conservative / aggressive / complex (2.16.0+)
  contextOptions: { ... },         // fine params (false disables compression)
  summaryLlm: { ... },             // summary-dedicated LLM (defaults to main llm)
  maxMemoryRounds: 50,             // dialog history memory cap (0 disables trim)
  vfs: { maxBytes: 8*1024*1024, poolBytes? },  // workspace cap (default 8MB; 2.16.0+ three pools: large_results/drafts/userFiles, each its own LRU)

  // persistence
  storage: 'indexed',              // 'indexed'|'session'|'local'|'memory'|config|false (default off)
  session: { id?, autoResume?, title? },
  shareContext: false,             // same id instances share one agent

  // robustness
  maxRetries: 2,                   // model call retries (network/429/5xx)
  maxParallelTools: 1,              // per-round tool concurrency
  maxToolRounds: 10,               // max tool rounds (default 10; counts only real tool rounds — format/verify self-correction doesn't consume; maxIterations total-iteration hard cap prevents self-correction loops)

  // external tools
  mcp: [{ transport: 'http'|'sse'|'websocket', url, name? }],

  // custom middleware (appended to built-in stack)
  middleware: [...],

  // UI/debug
  streaming: true, dialog: { title: '...', placeholder: '...' }, debug: false,
}).mount()
```

> For the complete option table with every field's type/default, see the [Chinese guide §5](./usage-guide.md#5-配置项参考).

## 6. Capabilities

### 6.1 data ops (single main object — let the Agent edit your JSON)

Declare `data`; the Agent reads/writes via tools, validated by schema:

- **`read`** / **`write`** (2.2+, recommended): high-level entry points merging list/describe/get and set/edit/delete + auto optimistic lock + auto snapshot — lowest LLM cognitive load
- `describe_data` / `list_data_snapshots` / `get_data` (hidden in `simple` mode, merged into `read`)
- `set_data` / `edit_data` (jsonPath incremental patch) / `delete_data` (hidden in `simple` mode, merged into `write`)
- `snapshot_data` / `list_data_snapshots` / `restore_data`
- `query_data` (JSONPath) / `search_data` (fuzzy) / `eval_script` (sandboxed)

Key points:
- `set`/`edit`/`delete` are restricted to schema-declared fields (whitelist for ZodObject); `set`/`edit` validate against schema — invalid → structured error (no write)
- `edit_data` patches by `jsonPath` (set/remove/merge/append) — avoids re-sending the whole large JSON; writes in-place without replacing the root ref → Vue-reactive compatible
- Snapshots auto-stored before `set`/`edit`/`delete`; `restore_data` rolls back
- **No `window` dependency**: `data.bind` is any reactive/plain object tools read/write directly; only `eval_script` needs Web Worker (browser)

#### High-level `read`/`write` (2.2+, recommended)

```ts
// read: no jsonPath → list main data + description; with jsonPath → current value + hash
// Agent: read({}) → "Main data: ... (hash=a1b2)"
// Agent: read({ jsonPath: 'title' }) → 'title = "Home" (hash=a1b2)'

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

#### Schema as whitelist (only declared fields exposed) + interceptor-supplied invisible fields

When `data.schema` is a `z.object(...)` (or its optional/default/lazy wrapper), the SDK auto-enables **whitelist mode**: only schema-declared fields are exposed to the LLM; undeclared fields are invisible and non-readable/writable. This fits the "bind is a large JSON but only some fields should be agent-operable" scenario — declare operable fields in schema, the rest (internal state, sensitive data, redundant caches) are auto-hidden, no extra config needed.

- **Read**: `read` whole-object is projected by top-level schema; **sub-path reads are also recursively projected by the sub-schema at that location** (e.g. `read components.0` is projected by the element schema of `components`, hiding undeclared sub-fields). Reading an undeclared (sub)path returns `PATH_DENIED`.
- **Write**: `set`/`write(set)` whole-object uses **merge semantics** — only schema-declared fields are updated, un-passed fields are preserved (anti-accidental-delete); `edit`/`write(patch)` sub-path increments are path-segment-checked against schema declarations.
- **Interceptor-supplied invisible fields**: fields in the `interceptors.write` return payload that are **not in schema** (e.g. auto-generated `id`/`_createdAt`/internal state) are **written back to bind** after schema validation + merge (trusting integrator interceptor / explicit user value), not stripped by schema. Typical use: agent `append`s a new item, interceptor auto-supplies `id`/`createdAt` fields you don't want to expose to the LLM:

```ts
createChatSdk({
  data: {
    // schema declares only agent-operable fields (no _createdAt → invisible to agent)
    schema: z.object({ title: z.string(), items: z.array(z.object({ name: z.string() })) }),
    bind: app,
  },
  interceptors: {
    write: (payload, current) => {
      // when agent pushes a new item, auto-supply _createdAt (not in schema, invisible to agent, but persisted)
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

> Note: whitelist mode only enables for `z.object`; `z.any()`/`z.record()`/`z.discriminatedUnion()` etc. non-object schemas don't enable it (fully open, backward-compatible). A `passthrough()` object still enables whitelist (only declared fields are visible to LLM; extra fields are persisted on write but hidden on read) — if you want extra fields visible to LLM, declare them in schema explicitly.

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
- **Runtime skill swap**: `sdk.setSkills(skills)` (same-name skill overwrites; clears the skill full-text cache, the skill index section of the system prompt re-renders next round, and the next `load_skill` re-fetches the latest full text incl. vfs doc) / `sdk.invalidateSkillCache(name?)` (proactively invalidate the cache when a dynamic skill's content changes; omit `name` to clear all, pass `name` to clear one)
- **User-created skills (runtime + independent persistence)**: `sdk.addSkill(skill)` (users create/edit/delete custom skills from within the chat UI; auto-added to the agent, persisted via **independent SkillStore** — default indexedDB, separate from the `storage` option, persists even when `storage: false`, auto-restored across refreshes; same-name overwrites) / `sdk.removeSkill(name)` (only removes user-created skills, not the integrator's initialSkills passed via the `skills` option) / `sdk.listUserSkills()` (list user-created skill names, for UI panel refresh) / `sdk.getUserSkill(name)` (read a user-created skill's detail, for SkillPanel editing). The built-in `ChatDialog` has a "Skill Management" button in its header that opens the `SkillPanel` component, supporting create/edit (click a skill to load into the form)/delete; integrators can also `import { SkillPanel } from 'page-agent-sdk'` for custom UIs. Requires `capabilities.skills` (default on). **Cross-page/cross-agent reuse**: manually specify `skillStorage: { id: 'shared-skills' }`, multiple `createChatSdk` instances (different agentIds) with the same id share the same set of user skills; omit `id` for per-agent isolation (`agent::{agentId}`). `skillStorage: false` disables persistence (current session only).

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

#### Optimistic lock under concurrent tools (`maxParallelTools > 1`)

`autoLock` (default `true`) makes `write` verify the optimistic-lock hash automatically: it reuses **the whole-bind hash from the LLM's most recent `read`** (an internal shared `lastReadHash`) for whole-snapshot comparison, so integrators don't pass `expectedHash` by hand. In a serial single-tool flow this is equivalent to "write based on the value I just read".

**Under concurrent tools, `autoLock` degrades to "whole-snapshot semantics".** When `maxParallelTools > 1`, multiple `read`s in the same round **concurrently write the same shared `lastReadHash`** with nondeterministic completion order, and a subsequent `write` compares against "**the whole hash of whichever `read` finished last**" — "is this write using the hash from *my own* read?" is **not reproducible** across tools. This doesn't break the safety boundary (it's still whole-snapshot validation; conflicts are still caught), but you lose the "each write corresponds precisely to its own read" semantics.

**When you need precise optimistic locking under concurrency: have the LLM pass `expectedHash` explicitly.** Take the `hash` returned by its own `read` and pass it back in `write`:

```ts
// Agent workflow (concurrent scenario, run by the LLM automatically)
// 1. read({ jsonPath:'title' }) → "main data @ title = old (hash=a1b2)"   ← remember this hash
// 2. write({ patch:{ op:'set', jsonPath:'title', value:'new' }, expectedHash:'a1b2' })
//    precisely compares the hash from the LLM's own read, bypassing the shared-lastReadHash race
```

Explicit `expectedHash` takes precedence over the `autoLock` shared hash — reproducible and reason-able across concurrent tools.

> **Hash algorithm**: from 2.16+, `hashValue` is upgraded to **cyrb53 (53-bit)**, replacing the old djb2 (32-bit) to significantly reduce collisions. Just take the `hash` field from `read` / `get_data` return values for `expectedHash` — integrators never compute it themselves.

### Automation loop & scale: `get_dom` / `actions` / `schemaHint` / `workingMemory` (2.18+)

Four complementary capabilities that together yield a "competent automation agent": change data → see the rendered DOM → trigger host-page actions — and stay controllable under large schemas / frequent compression.

#### DOM reading `get_dom` (see the rendered page)

Let the agent read the **rendered** DOM structure (unlike `read`, which reads the data JSON). Use cases: verify rendering after a data change, locate elements, confirm styles landed, assist with UI/design questions. `capabilities.domInspect` defaults to **off** (reading DOM costs tokens; opt in as needed).

```ts
createChatSdk({
  capabilities: { domInspect: true },  // opt-in, default off
  // ...
}).mount()
```

The agent calls `get_dom({ selector?, depth?, attrs?, includeText? })`:

- `selector`: CSS selector (default `body`, whole page)
- `depth`: traversal depth (default `3`, caps DOM token blowup; `0` = root only, max 10)
- `attrs`: attribute whitelist. **Omitted** = default common (`id/class/href/src/alt/title/style/role/aria-label/name/type/value`) + all `data-*`; **provided** = strict whitelist (no `data-*`, only what you list)
- `includeText`: include direct text (default `true`)

Returns structured JSON (`{tag, attrs, text, children[], childCount?}`); truncated depth reports `childCount` without expanding. Large results auto-offload to vfs. Unlike `eval_script` (free sandbox script returning text): `get_dom` is read-only + structured + attribute-whitelisted (no script execution, no sensitive attr leak).

```jsonc
// agent calls get_dom({ selector: '.navbar', depth: 2 }) →
{
  "tag": "nav", "attrs": { "class": "navbar" },
  "children": [
    { "tag": "span", "attrs": { "class": "navbar-title" }, "text": "My Page" }
  ]
}
```

> To inject manually (bypass capabilities): `import { domTools } from 'page-agent-sdk'` and spread into tools. The pure function `domToStructure(node, opts)` is exported and unit-testable without a browser.

#### Environment probe `inspect_env` (debugging, default on)

Lets the agent read the host page's **environment info** (URL / browser / viewport / integrator debug vars) to troubleshoot "where am I / what browser / viewport size / debug var value / why didn't it take effect". `capabilities.inspectEnv` defaults to **on** (lightweight read-only, essential for debugging); `false` to disable.

```ts
createChatSdk({
  capabilities: { inspectEnv: true },  // default on; false to disable
  // ...
}).mount()
```

The agent calls `inspect_env({ key? })`:

- **Without `key`**: returns an environment summary (`location` URL/origin/path, `navigator` browser/language/online, `viewport` size/DPR/scroll, `document` title/readyState)
- **With `key`**: reads a specific `window[key]` (integrator-mounted debug var, e.g. `inspect_env({key:"appConfig"})` reads `window.appConfig`)

`safeSerialize` skips functions/DOM/circular refs + caps depth/key-count/length to avoid blowups. Large results auto-offload to vfs. Unlike `get_dom` (reads DOM structure, deep traversal, opt-in): `inspect_env` is a lightweight environment summary, **on by default**, non-mutating.

> Manual inject: `import { inspectTools } from 'page-agent-sdk'`. Pure functions `safeSerialize`/`getEnvSummary` are exported and unit-testable without a browser.

#### Chunked write `draft_write` / `draft_commit` (huge JSON, default off)

Huge JSON (e.g. 50+ component pages) approaching LLM `max_tokens` won't fit in a single `write({value})`. Build it in chunks via draft: `capabilities.draftWrite` defaults to **off** (opt-in; needs dataOps + vfs; toolMode advanced exposes it, simple/minimal hide it).

```ts
createChatSdk({
  capabilities: { draftWrite: true, vfs: true },  // opt-in, default off
  toolMode: 'advanced',  // draft exposed in advanced (hidden in simple/minimal)
  // ...
}).mount()
```

Agent flow: `draft_write({draftId, chunk, mode})` accumulates chunks → `draft_commit({draftId})` atomically commits:

- `draft_write` mode: "start" creates/overwrites / "append" appends chunk (concat JSON fragments into the vfs drafts pool, 2MB)
- `draft_commit` reads draft → `JSON.parse` (fail → JSON_INVALID) → schema validate (fail → SCHEMA_INVALID, draft kept for fix-and-retry) → write bind + snapshot (auto-clears draft on success)

```jsonc
// agent builds a 50+ component page in chunks
draft_write({draftId:"p1", chunk:'{"components":[', mode:"start"})
draft_write({draftId:"p1", chunk:'{"type":"heading","props":{...}},', mode:"append"})
// ... more components appended ...
draft_write({draftId:"p1", chunk:']}', mode:"append"})
draft_commit({draftId:"p1"})  // merge + validate + write + clear draft
```

> Small edits still use `write` patch; draft is only for generating large JSON from scratch. `draft_commit` runs through `commitSetToBind` (shared with write(set)/set_data for validation+snapshot+optimistic-lock chain).

#### Host actions `actions` (trigger save/publish/page ops)

Register page ops; the SDK wraps each action as a **named tool** (the LLM sees `save_draft`/`publish` directly — no `trigger_action` relay). With `get_dom` this closes the loop: change data → see DOM → trigger action.

```ts
createChatSdk({
  actions: {
    save_draft: {
      description: 'Save the current page as a draft (local storage). Call after editing to persist.',
      run: (args) => {
        localStorage.setItem('draft', JSON.stringify(args))
        return { saved: true, at: Date.now() }
      },
    },
    publish: {
      description: 'Publish the page live. save_draft should precede this.',
      run: async () => { await fetch('/api/publish', { method: 'POST' }); return 'published' },
    },
    // action with params (ZodObject; the LLM passes args per schema)
    set_theme: {
      description: 'Switch theme',
      params: z.object({ theme: z.enum(['light', 'dark']) }),
      run: ({ theme }) => { document.documentElement.dataset.theme = theme; return `theme set to ${theme}` },
    },
  },
  // ...
}).mount()
```

Notes:

- `run(args)` return value is serialized back to the LLM (`undefined` → "action done"; `string` as-is; object → JSON). **Error isolation**: if `run` throws, the error string goes back to the LLM for self-correction (the agent never crashes)
- Action names must be valid identifiers (`[a-zA-Z][a-zA-Z0-9_]*`, e.g. `save_draft`); invalid names are skipped with a warn
- `inspect().actions` returns `{ [name]: { description, hasParams } }`

#### Schema tiered disclosure (`schemaHint`)

`data.schema` field `.describe()`s are auto-injected into the systemPrompt "operable data" section. A **large schema** (dozens/hundreds of fields) fully injected bloats the systemPrompt. `schemaHint` triggers **tiered disclosure**: past the threshold it switches to a "top-level overview" (key + type + one-line desc, no constraints, no recursive shape) + a footer hint "query `schema_data` for deep constraints" — saving tokens without losing discoverability; small schemas (≤ threshold) stay full (imperceptible).

```ts
createChatSdk({
  data: { schema: hugeSchema, bind: page },
  schemaHint: { maxKeys: 15, maxChars: 4000 },  // defaults; past threshold → overview mode; tune up/down
  // ...
}).mount()
```

Defaults `maxKeys: 15, maxChars: 4000`. Want full disclosure (small schema, tokens no concern): raise the thresholds; want to save more: lower them. Related exports: `extractSchemaHint` / `renderSchemaShallow` / `renderSchemaHint` / `renderSchemaOverview` / `formatConstraints` / `describeSchemaNode`.

#### Working memory `workingMemory` (keep located paths & read hashes across compression)

In long tasks with frequent context compression, the **paths** the agent located via `read`/`query_data`/`search_data` and the **hashes** from `read` results get dropped as older rounds are summarized → the agent re-searches (token waste) + writes from memory, causing spurious `autoLock` optimistic-lock conflicts. The `workingMemory` middleware (`capabilities.workingMemory`, **default on**) auto-captures these structured locations and injects a "## Working memory" section each round via `augmentPrompt` (lives in state, not messages → compression never touches it → naturally preserved across compression).

```ts
createChatSdk({
  capabilities: { workingMemory: true },  // default on, no config needed; false to disable
  // ...
}).mount()
// inspect().workingMemory → { locatedPaths: string[], lastHashes: {[path]: hash} } (each ≤10 LRU)
```

Auto-capture rules (no LLM call): `read`/`query_data`/`search_data` results → `locatedPaths` (LRU ≤10, deduped); `hash=` in `read` results → `lastHashes[path]` (LRU ≤10). Complementary to `preserveLastToolResults` (which keeps tool-result summaries so field descriptions aren't lost); orthogonal to mission (mission = goal, workingMemory = intermediate state).

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

#### Dynamic skills: `exec` (run on load) + `tools` (callable tools) — skill-external-scripts

SkillSpec adds two optional fields, turning a skill from a "manual" into a "manual + executor":

```ts
defineSkill({
  name: 'orders',
  description: 'Orders overview & query',
  getContent: () => 'Use this skill for orders. Call query_orders to filter.',
  // exec: run once on load, inject result into the full text (one-shot context init, a snapshot)
  exec: {
    code: 'return await fetch("/api/orders/summary").then(r => r.json())',  // inline JS
    context: 'sandbox',  // default: Worker sandbox (no window/network, 3-layer guard); 'host' needs capabilities.skillHostScript
    inject: 'append',    // default append (end); 'prepend' (start)
    // url: 'https://host/orders.js',  // remote script (sandbox only, never host)
  },
  // tools: attach repeatedly-callable tools (injected into the tool pool after load_skill)
  tools: [() => queryOrdersTool],
})
```

**exec vs tools (orthogonal — don't mix)**: `exec` = one-shot context init (snapshot on load, e.g. "current orders summary"); `tools` = query capability (called repeatedly by the LLM, e.g. "filter orders by X").

- **exec security**: default `sandbox` (reuses eval_script's Worker sandbox: static scan + `lockSandboxGlobal` network lock + timeout). `context:'host'` runs with full host authority (`AsyncFunction`, can read window/fetch/DOM), requires `capabilities.skillHostScript:true` (opt-in, default off); **host only for integrator-supplied inline `code`** (not LLM-generated, not remote); `url`+`host` is forbidden (untrusted remote).
- **exec failure is not cached**: a failed script (e.g. network blip) doesn't block the skill (text still usable + failure noted) and is **not written to cache** — next `load_skill` re-runs exec (dynamic-skill resilience); only success is cached.
- **exec large results**: when text + exec result exceeds 6000 chars, the createAgent offload kicks in (→ vfs + preview); the LLM re-reads via `vfs_read`. "Read-all-at-once" only guarantees the static text part.
- **tools injection**: after `load_skill`, tools are evaluated → injected into the agent tool pool (via dedupeTools; namespace prefix `<skill>__<tool>` recommended); source labeled `skill:<name>`; unloaded by `sdk.setSkills`/`invalidateSkillCache`.

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

- 4-layer adaptive compression (`contextPreset`: auto/conservative/aggressive/complex)
- vfs `maxBytes` (default 8MB; 2.16.0+ three independent pools) LRU evict; dialog `maxMemoryRounds` (default 50) trim

#### complex preset + vfs JSON-aware tools (2.16.0+)

For **multi-step complex tasks / large JSON edits / long-running workflows**, 2.16.0 adds a `complex` context preset, vfs JSON-aware tools, three-pool vfs partitioning, and structured offload metadata — improving context stability and large-file partial-edit capability.

**① `complex` context preset**

`auto`/`conservative`/`aggressive` target ordinary chat. Multi-step complex tasks (low-code page building, large config orchestration, long-doc processing) have bulky tool results, high per-round context needs, and must keep field descriptions across rounds. `complex` uses **ratio-based** tuning for these scenarios:

| Field | complex | auto (compare) | Notes |
|---|---|---|---|
| `windowRatio` | 0.6 | 0.4 | Keep 60% of the context window for recent verbatim text (large JSON tool results need more original text) |
| `summaryThresholdRatio` | 0.7 | 0.5 | Compress only at 70% usage (compress later, lose less detail) |
| `recallTopK` | 5 | 3 | Recall more old rounds (complex tasks have strong cross-round context linkage) |
| `enableLLMSummary` | true | true | Use LLM summary (quality) |
| `preserveLastToolResults` | `['describe_data','read','query_data','search_data']` | `['describe_data','read']` | Also preserve query/search result snippets (large-JSON query scenarios) |

```ts
createChatSdk({
  contextPreset: 'complex',   // one-line: complex-task preset
  // any field can override (same as auto/conservative/aggressive)
  contextOptions: { recallTopK: 8 },  // e.g. very long task, recall more
  // ...
})
```

> `inspect().contextPreset` (2.16.0+) exposes the effective preset in DebugDrawer.

**② vfs JSON-aware tools** (`vfs_json_read` / `vfs_json_patch` / `vfs_write` jsonString)

The vfs workspace often stores large JSON (fetched API responses, component snapshots, config-tree drafts). Before 2.16.0 you could only `vfs_read` the whole file + `vfs_write` the whole thing back — re-sending large JSON is easily truncated by `max_tokens`. Two new tools support **jsonPath partial read/write**:

```ts
// vfs_json_read: read a JSON subtree from a vfs file via jsonPath (omit to read whole)
vfs_json_read({ path: 'drafts/config.json' })                          // whole file
vfs_json_read({ path: 'drafts/config.json', jsonPath: 'components.0' }) // only a subtree (saves tokens)

// vfs_json_patch: atomic jsonPath patch inside a vfs file (applied on a clone; any failure → nothing written back)
vfs_json_patch({
  path: 'drafts/config.json',
  patches: [
    { op: 'set',    jsonPath: 'title',         value: 'New title' },
    { op: 'append', jsonPath: 'items',         value: { id: 99 } },
    { op: 'merge',  jsonPath: 'style',         value: { color: 'red' } },
    { op: 'remove', jsonPath: 'deprecated' },
  ],
})
// any patch fails → PATCH_FAILED, original file unchanged (atomic)

// vfs_write jsonString:true → validate content is valid JSON before writing (invalid → VFS_JSON_INVALID, not written)
vfs_write({ path: 'drafts/config.json', content: '{"a":1}', jsonString: true })
```

| Tool / error | Meaning |
|---|---|
| `vfs_json_read` returns `VFS_JSON_INVALID` | File content is not valid JSON |
| `vfs_json_read` returns `VFS_PATH_NOT_FOUND` | jsonPath does not exist in the JSON |
| `vfs_json_patch` returns `PATCH_FAILED` | A patch failed to apply; original file unchanged (atomic) |
| `vfs_write(jsonString:true)` returns `VFS_JSON_INVALID` | content is not valid JSON; not written |

> Motivation: editing a large JSON via jsonPath patch sends only the delta, avoiding `max_tokens` truncation that would leave the whole JSON incomplete. Mirrors the on-data `write({patch})` semantics.

**③ vfs three-pool partitioning**

Before 2.16.0 vfs was a single LRU pool — offloaded tool results (`large_results/*`) competed for quota with user drafts (`drafts/*`) / user files (`userFiles`), and large results could evict drafts (losing user data). Now three independent LRU pools:

| Pool | Prefix | Default quota | Purpose |
|---|---|---|---|
| `large_results` | `large_results/*` | 4MB | Tool-result auto-offload (>6000 chars; >10000 attaches `suggestedReadPlan`) |
| `drafts` | `drafts/*` | 2MB | Drafts written by Agent / integrator |
| `userFiles` | `userFiles` (no fixed prefix) | 2MB | User files |

`vfs.maxBytes` (total, default 8MB), `vfs.poolBytes` (per-pool override). Reads/writes route transparently across pools.

```ts
createChatSdk({
  vfs: {
    maxBytes: 16 * 1024 * 1024,            // raise total cap (default 8MB)
    poolBytes: { drafts: 4 * 1024 * 1024 }, // per-pool: drafts pool 4MB (others default)
  },
})
```

**④ Structured offload metadata + suggestedReadPlan**

The return value for offloaded tool results (above threshold) is upgraded to `OffloadResult` with structured metadata. **Large results (>10000 chars) include `suggestedReadPlan`** — a `vfs_read` paging/segmenting plan advising the LLM how to consume the result in chunks (which section first, how many pages), guiding the Agent to consume in blocks instead of stuffing the whole thing into context. No integrator config; automatic.

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
| `usage` | After each LLM call (if provider returns usage) | `round` / `usage` (round prompt/completion/total_tokens) / `cumulative` (cumulative) |
| `session_restored` | After storage restores a session snapshot (mount auto-resume / `switchSession` to an existing session) | `sessionId` / `rounds` (restored message count) |
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

### Structured tracing — TraceSpan (performance attribution / debugging, 2.19+)

For long/complex runs where flat logs can't tell which round was slow, failed, or burned tokens. Enable structured tracing to get a **TraceSpan tree** (per-round `model`/`tool`/`compression` timing/status/usage) for performance attribution and error tracing. Opt-in (collection has overhead, default off).

```ts
createChatSdk({
  capabilities: { tracing: true },  // opt-in, default off
  onEvent: (e) => {
    if (e.type === 'trace') console.log('trace done', e.metrics)  // emits spans + metrics when agent call ends
  },
})
// After a run:
// sdk.inspect().trace → { spans, metrics } (rounds / latency / tool success rate / retries / compressions / tokens)
// DebugDrawer 4th tab 🌳 Trace → metrics card + span list (visual)
```

- **Span types**: `round` / `model` (LLM call) / `tool` / `compression`, with `startTs`/`endTs`/`durationMs`/`status`/`attributes` (round no, tool name, usage, etc).
- **`getTraceMetrics(spans)`** (exported pure fn): aggregates round count, avg/total latency, tool success rate, retries, compression freq, cumulative tokens.
- **`onEvent('trace')`**: emits `{ spans, metrics }` when the agent call ends (feed APM / custom monitoring).
- **`inspect().trace`**: runtime reflection of current spans + metrics.

> Use cases: debug long-task bottlenecks (which round is slow), error tracing (which round failed), token-budget monitoring. APM backend reporting / distributed tracing still not built (backend-framework concern; feed via `onEvent('trace')` to Datadog/Sentry yourself).

### 6.13b Context archival `context_trimmed` (rescue content about to be deleted when the conversation grows long, context-persist-resilience)

When the conversation exceeds `maxMemoryRounds` (default 50 rounds), the AI deletes the oldest rounds to free memory (originals gone forever, only a summary kept). If you need audit/compliance/backup, subscribe to `context_trimmed`: right before deletion it hands you the full originals (including referenced vfs large results) + the replacement summary — store them to your own server if you want (the SDK doesn't hoard; default deletion behavior is unchanged).

```ts
createChatSdk({
  storage: 'indexed',  // storage must be on (so vfs large results persist and the archive is complete)
  onEvent(e) {
    if (e.type === 'context_trimmed') {
      // e.dropped    = full early conversation about to be deleted (each round: user / AI / tool results)
      // e.vfsResults = referenced vfs large-result originals { path→content }
      // e.summary    = the replacement summary
      archiveService.save({ dropped: e.dropped, vfsResults: e.vfsResults, summary: e.summary })
    }
  }
})
```

- Not subscribing = same as now (AI deletes as usual, you do nothing). Fully optional.
- Same chain: vfs orphan GC (auto-reclaims unreferenced large results after trim, prevents buildup); mission/workingMemory persist across refresh (long-task goal + working memory survive reload).

### Unattended automation (resource budget / error recovery / batch / resume, 2.20+)

For unattended batch / long-task scenarios (generate pages in the background, cron jobs, long flows): budget control, automatic error recovery, batch processing, and resume after refresh/crash. Opt-in (most advanced, default off).

```ts
const sdk = createChatSdk({
  capabilities: { automation: true },  // opt-in, default off
  tokenBudget: 100000,      // cumulative token cap (exceed → stop + emit BUDGET_EXCEEDED)
  timeBudgetMs: 600000,     // time cap ms (10 min; exceed → stop)
  maxAutoRetries: 2,        // fatal-error auto-recovery count (restore_last_checkpoint + retry; default 1)
  checkpoint: true,         // pairs with resume (per-round snapshot + persist checkpoint stack/usage)
  storage: 'indexed',       // resume needs persistence
  id: 'my-automation',      // stable id (same id recovers same session after refresh)
})

// Batch: run tasks one by one, checkpoint before each, failure isolated
const results = await sdk.batch(['gen page A', 'gen page B', 'gen page C'])
// → [{ task, reply, ok:true }, { task, error, ok:false }, { task, reply, ok:true }]
```

- **Resource budget** (`tokenBudget`/`timeBudgetMs`): checked before each model call; exceed → agent stops + emits `BUDGET_EXCEEDED` (observable); unfinished part can `restoreLastCheckpoint`.
- **Error recovery** (`maxAutoRetries`): fatal invoke error → `restore_last_checkpoint` + retry (limited) + emit `AUTO_RECOVER_RETRY`; exhausted → fatal.
- **Batch** (`sdk.batch(tasks)`): per-task invoke, checkpoint before each; failed task `messages` splice truncate + `ok:false` doesn't halt the batch + emit `BATCH_TASK_FAILED`.
- **Resume**: after refresh/crash, new sdk with same `id` + `storage` → mount recovers (checkpoint stack + cumulative usage from store) → `listCheckpoints` has values + `restoreLastCheckpoint` works + budget stats stay continuous. Needs `capabilities.automation` + `checkpoint` + `storage` together.

> Use cases: batch generation, cron jobs, long flows. Combine headless (`ui:false`) + `storage` + `automation` for in-browser background automation (no Node cross-env).

### 6.10 Convenience API (export / import / usage / audit)

Beyond event subscription, the SDK instance exposes a few convenience APIs covering backup/migration, usage stats, and audit tracing:

| API | Purpose | Notes |
|---|---|---|
| `sdk.exportData()` | Returns a **deep copy** of the main data `bind` (JSON-serialized) | For backup/migration; mutating the return value does not affect the original bind; returns `null` if dataOps is off or no data |
| `sdk.importData(json, opts?)` | Replace `bind` entirely (in-place restore, preserves reactive ref) | Schema-validated by default, returns `{ok:false,error}` if invalid; `opts.validate:false` skips validation; `opts.emit:false` suppresses `data_change` |
| `sdk.setSkills(skills)` | Runtime swap the entire skill list (same-name overwrites) | Takes effect immediately: the skill index section of the system prompt re-renders next round; clears the skill full-text cache & in-round loaded set, so the next `load_skill` re-fetches the latest full text (incl. vfs doc); requires skills enabled (default on) |
| `sdk.invalidateSkillCache(name?)` | Invalidate the skill full-text cache (proactive) | Omit `name` to clear all, pass `name` to clear one; use when a dynamic skill's content changes; the next `load_skill` re-runs `getContent`/`readSkillDoc`; requires skills enabled (default on) |
| `sdk.addSkill(skill)` | User-created skill (runtime + independent persistence) | `skill: { name, description, prompt \| getContent \| doc }`; auto-added to the agent, persisted via **independent SkillStore** (default indexedDB, separate from `storage`, persists even when `storage: false`, auto-restored across refreshes); same-name overwrites; requires skills enabled (default on) + `skillStorage` not `false` for persistence |
| `sdk.removeSkill(name)` | Remove a user-created skill | Only removes user-created (added via `addSkill`), not the integrator's initialSkills passed via `skills` option; removes from SkillStore; returns `boolean` (success); requires skills enabled |
| `sdk.listUserSkills()` | List user-created skill names | Returns `string[]` (only user-created, not initialSkills); for UI panel refresh |
| `sdk.getUserSkill(name)` | Read a user-created skill's detail | Returns `{ name, description, content }` or `undefined` (when not found); for SkillPanel editing |
| `skillStorage` option | User skill independent persistence config | Default `{ backend: 'indexed' }` (separate from `storage`); `false` disables (current session only); `id` manually specifies the same id to share skills across pages/agents; omit `id` for per-agent isolation (`agent::{agentId}`) |
| `SkillPanel` component | UI panel for users to create/edit/delete skills | The built-in `ChatDialog` header "Skill Management" button already integrates it (supports create/edit/delete); integrators can also `import { SkillPanel } from 'page-agent-sdk'` for custom UIs |
| `sdk.usage` | Cumulative token usage `{prompt_tokens, completion_tokens, total_tokens}` | Accumulated per LLM call; all 0 when no calls; per-round detail emitted via `onEvent('usage')` |
| `onAudit(entry)` option | Structured audit callback for data writes (independent of `debug`) | Fires on every `set`/`edit`/`delete`/`restore` with `{op, jsonPath, opDetail, timestamp, success, error?}`; for compliance audit / operation tracing |

```ts
// Backup + restore
const backup = sdk.exportData()
localStorage.setItem('backup', JSON.stringify(backup))
// ...restore after an issue
sdk.importData(JSON.parse(localStorage.getItem('backup')))

// Usage stats
onEvent(e => { if (e.type === 'usage') costMeter.add(e.usage) })
console.log(sdk.usage)  // cumulative

// Audit
createChatSdk({
  onAudit: (entry) => auditLog.append(entry),  // no debug:true needed
  // ...
})
```

### 6.14 Context Focus (refine one component, focus-context)

When a page has many components and you want to refine just one (e.g. the navbar `components.3`), focusing converges the agent's **goal / view / scope** onto that subtree so it won't drift to other components. The focus is opt-in (only active after `setFocus`; default behavior is unchanged).

**SDK API**:

```ts
const res = sdk.setFocus({ path: 'components.3', label: 'Navbar' })
// res: { ok: true } or { ok: false, error } (rejected if path not in schema; does not throw)
sdk.getFocus()   // → { path, label? } | undefined
sdk.clearFocus() // exit focus, restore full editable range
```

After focusing, three layers converge:
- **Goal hint**: each turn injects "## Current refinement target: components.3 (Navbar)"
- **View convergence**: only the focused component's subtree schema is shown (other components hidden)
- **Scope tightening (strict)**: writing outside the subtree (e.g. `components.0`) → `PATH_DENIED` error fed back for self-correction; reads are not limited

**Three trigger methods**: ① `sdk.setFocus(path,{label?})` API (host click-pick or programmatic); ② agent tools `set_focus`/`clear_focus` (`toolMode:'advanced'` exposes them; simple/minimal use UI/host API); ③ built-in ChatDialog focus chip (✕ exit · ▾ edit path); hidden when `capabilities.focus:false`.

**Host click-pick** (bind `data-path` on component roots, delegate clicks to `setFocus`):

```ts
containerEl.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('[data-path]')
  const path = target?.getAttribute('data-path')
  if (path) sdk.setFocus({ path }) // focus chip appears; subsequent turns refine only this component
})
```

Full runnable example: `examples/complex-demo` (`PageRenderer.vue` / `CompRenderer.vue` bind `data-path` + click-pick).

> Path validation is "type-valid", not "data-exists": `setFocus` checks the schema shape via `getSchemaAtPath`. An array index like `components.5` is type-valid and focusable even if fewer than 6 exist; a sub-path under a leaf (e.g. `title.sub`) or a non-existent top-level field is rejected. `capabilities.focus` defaults on.

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
- `capabilities: { fetch: false }` — disable browser-dependent tools; dataOps body (`read`/`write`/`get`/`edit`/`delete`/`query`/`search`) works in Node (pass any `data.bind` object, no `window` needed); only `eval_script` needs Web Worker (disable via `capabilities:{dataOps:false}` if unused)
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

**Server-available**: custom tools / `fetch_document` (Node 18+) / subagents / verify / vfs / context compression / memory / onEvent / dataOps body (`read`/`write`/`get`/`edit`/`delete`/`query`/`search` — pass any `data.bind` object, no `window` needed)
**Server-unavailable**: ChatDialog UI (needs DOM) / `eval_script` (needs Web Worker) / IndexedDB·localStorage·sessionStorage (use `memory`)

> `eval_script` relies on Web Worker (part of dataOps, disable via `capabilities:{dataOps:false}`). MCP remote tools (http/sse/websocket) also work in Node (dynamic import `@modelcontextprotocol/sdk`).

### 8.6 Proxy Connection (prevent apiKey leakage)

Connecting to the LLM API directly from the browser exposes your `apiKey` in frontend code / network requests — anyone can grab it from DevTools and drain your quota. **Production must go through a server-side proxy**: the browser holds only a user token; your server injects the real `apiKey` and forwards to the LLM API.

The SDK provides a `createProxyLlm` factory to unify both access modes, so dev/prod switching needs no code restructuring:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

// ===== Production: proxy mode (safe) =====
// Browser holds only userToken; server injects real apiKey and forwards
const sdk = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'proxy',
    baseUrl: '/api/llm',        // your proxy URL (same-origin avoids CORS)
    userToken: getUserToken(),   // user session token (server validates, swaps in real key)
    model: 'deepseek-chat',
    temperature: 0.3,
    // optional: auto-refresh on 401 (called once, returns new token, retries)
    refreshToken: async () => (await fetch('/api/refresh')).json().then(r => r.token),
    // optional: extra headers (e.g. tenant id)
    headers: { 'X-Tenant': 'acme' },
  }),
  // ...other options
})

// ===== Dev: direct mode (convenient) =====
// Browser holds the real apiKey; local dev only (would leak in production)
const sdkDev = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'direct',
    apiKey: 'sk-xxx',            // real key (dev only)
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }),
  // ...other options
})
```

**Mode comparison**:

| | `proxy` (production) | `direct` (dev) |
|---|---|---|
| apiKey location | server (invisible to browser) | browser (visible in DevTools) |
| browser holds | userToken (session) | real apiKey |
| token refresh | supported (auto-retry on 401) | not needed |
| custom headers | supported | not needed |
| use case | production | local dev / intranet tools |

**Server-side proxy essentials** (your backend, not SDK):
- Receive browser request, validate userToken, inject real `apiKey`, forward to LLM API
- Handle CORS (same-origin is simplest, or set `Access-Control-Allow-*`)
- Stream SSE responses through (don't buffer streaming generation)
- Pass through tool-calling fields (`tools`/`tool_choice`/`tool_calls`)
- Optional: usage stats, rate limiting, per-user quota

> If `summaryLlm` (the dedicated summarization model) should also go through the proxy, build it with `createProxyLlm({ mode:'proxy', ... })` and pass to the `summaryLlm` option.

#### 8.6.1 Supported interface format

`createProxyLlm` uses `ChatOpenAI` internally, so **both modes require an OpenAI Chat Completions compatible endpoint**. The difference is only where the apiKey lives, not the protocol.

**Request** (browser → proxy):

```
POST {baseUrl}/chat/completions
Authorization: Bearer {userToken}      ← proxy mode: user token
Authorization: Bearer sk-xxx           ← direct mode: real key
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "..." }, ...],
  "tools": [...],          // tool-calling fields (optional)
  "tool_choice": "auto",
  "temperature": 0.3,
  "max_tokens": 16384,
  "stream": true           // SSE when streaming
}
```

> `ChatOpenAI` auto-appends `/chat/completions` to `baseUrl`, so pass `/api/llm` and the actual request hits `/api/llm/chat/completions`.

**Response** (proxy → browser), must be OpenAI-compatible:

Non-streaming:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{ "message": { "role": "assistant", "content": "...", "tool_calls": [...] }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
}
```

Streaming (SSE):
```
data: {"choices":[{"delta":{"content":"hello"}}]}
data: {"choices":[{"delta":{"tool_calls":[...]}}]}
data: [DONE]
```

**401 refresh** (proxy mode only): when the proxy returns `401`, the SDK auto-calls `refreshToken`, gets a new token, and retries the original request once.

**Non-OpenAI protocols**: Anthropic Claude (native `/v1/messages`) is supported **out of the box** — set `llm.provider = 'anthropic'` and the SDK dynamic-loads `@langchain/anthropic` (optional peer; see [Anthropic provider](#864-anthropic-claude-provider-out-of-the-box-228)). Other non-OpenAI protocols (e.g. Gemini `generateContent`) still require backend translation to OpenAI-compatible format; custom RPC / GraphQL likewise.

#### 8.6.2 Proxy server example (Node.js)

The repo ships a mock proxy server (`scripts/proxy-mock-server.ts`); run `npm run proxy:mock` to start it at `http://localhost:3002`:

- `POST /chat/completions` — validates `Authorization: Bearer {userToken}`, injects the real apiKey (read from server-side `.env` `VITE_AI_API_KEY`), forwards to the upstream LLM API (`VITE_AI_BASE_URL`), streams SSE through
- `POST /api/refresh` — token-refresh demo endpoint, returns a new token
- Demo token rules: `demo-token-xxx` works / `demo-token-expired` returns 401 to trigger refresh

Minimal viable proxy (production reference, Node.js native `http`):

```ts
import http from 'node:http'

const REAL_API_KEY = process.env.REAL_API_KEY  // server env var, browser can't see it
const UPSTREAM = 'https://api.deepseek.com/v1'

http.createServer(async (req, res) => {
  // CORS (dev cross-origin; production prefers same-origin, remove this)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url !== '/chat/completions' || req.method !== 'POST') {
    res.writeHead(404); res.end('not found'); return
  }

  // 1. validate user token
  const userToken = req.headers.authorization?.slice(7)
  if (!userToken || !await verifyUserToken(userToken)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid token' } }))
    return
  }

  // 2. read body
  const body = await new Promise<Buffer>(r => {
    const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c)))
  })

  // 3. inject real apiKey and forward (pass through tools/tool_calls/stream)
  const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REAL_API_KEY}` },
    body,
  })

  // 4. stream response through (pipe SSE chunks, don't buffer)
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
  if (upstream.body) {
    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    while (true) { const { done, value } = await reader.read(); if (done) break; res.write(dec.decode(value)) }
  }
  res.end()
}).listen(3002, () => console.log('proxy @ 3002'))

async function verifyUserToken(token: string): Promise<boolean> {
  // plug in your auth: JWT verify / session lookup / user table query …
  return token.startsWith('demo-token-')
}
```

**Production deployment notes**:
- The real apiKey lives only in server env vars (or a secret manager) — **never** ship to the browser, never commit to git
- Same-origin deployment (`/api/llm` shares the frontend domain) avoids CORS; cross-origin needs `Access-Control-Allow-*`
- Stream responses with `pipe` chunk-by-chunk; don't `await res.json()` and buffer (breaks streaming generation)
- Pass through `tools`/`tool_choice`/`tool_calls` fields (the Agent's tool calling depends on these)
- Optional: meter usage by userToken, rate-limit, per-user quota, audit logs

#### 8.6.3 Full example page

The repo's `examples/proxy-demo/` provides a complete runnable example:

```bash
# Terminal 1: start the proxy server (reads the real apiKey from .env)
npm run proxy:mock
# → http://localhost:3002, real apiKey stays server-side

# Terminal 2: start dev
npm run dev
# → open http://localhost:3000/examples/proxy-demo/
```

The example page demonstrates:
- The browser holds only a `userToken` (`demo-token-xxx`); DevTools can't see the real apiKey
- Switch to `demo-token-expired` → send a message → 401 → the SDK auto-calls `refreshToken` to refresh and retry (the UI shows the refresh count)
- An extra `X-Tenant` header demonstrates custom-header pass-through

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

#### 8.6.4 Anthropic Claude provider (out of the box, 2.28+)

Besides OpenAI-compatible protocols, the SDK supports Anthropic Claude's native protocol out of the box (`provider:'anthropic'` dynamic-loads `@langchain/anthropic`, optional peer):

```ts
createChatSdk({
  llm: {
    provider: 'anthropic',          // Claude native protocol (default 'openai' = OpenAI/DeepSeek, backward-compatible)
    apiKey: 'sk-ant-xxx',
    model: 'claude-sonnet-4-5-20250929',
    baseUrl: 'https://api.anthropic.com',  // optional, official by default; custom gateway here
  },
}).mount()
```

> - `@langchain/anthropic` is an **optional peerDep** — install only when using Anthropic (`npm i @langchain/anthropic`); projects not using Anthropic are unaffected (dynamic import loads only in the `provider:'anthropic'` branch)
> - `setLlm` to Anthropic requires a `BaseChatModel` instance (dynamic import can't be synchronous): `const { ChatAnthropic } = await import('@langchain/anthropic'); sdk.setLlm(new ChatAnthropic({ apiKey, model }))`; passing `LLMConfig + provider:'anthropic'` throws a clear hint
> - **IIFE (CDN `<script>`) does not support Anthropic** (browser has no importmap to resolve the bare specifier); use npm (ESM/UMD) for Anthropic. The CDN bundle does not bundle `@langchain/anthropic` (defaults to OpenAI/DeepSeek)
> - Proxy mode `createProxyLlm` stays OpenAI-only (Bearer is an OpenAI-protocol header); for Anthropic use the main `llm` direct connection or a pre-built `ChatAnthropic` instance

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
| 10 | Multi-agent parallel + exclusive switch | multiple `createChatSdk` (distinct `id`, each its own `data`) + `dialog.drawer:true`; switch via `hide()`/`show()` (keeps each history/in-flight generation, no unmount) |

Runnable demos per scenario: `examples/nested-demo` (1), `examples/page-demo` (1/2), `examples/subagent-demo` (6), `examples/mcp-demo` (9), `examples/human-confirm-demo` (4), `examples/planner-demo` (planning), `examples/toolsets-demo` (tool separation), `examples/animation-demo` (animations + hide/show), `examples/multi-agent-demo` (multi-agent parallel + exclusive switch).

### Multi-agent parallel + exclusive switch

A single page can host multiple independent agents (each `createChatSdk` + distinct `id` for isolation), each managing its own `data`/history/tools, running their own generation tasks in parallel; exclusive chatbox switching uses `dialog.drawer` + `hide()`/`show()` — `hide` the old one (keeps agent/history/in-flight generation), `show` the new one (history resumes), no unmount, no lost conversation:

```ts
const agents = [
  createChatSdk({ id: 'agent-a', container: boxA, dialog: { drawer: true }, data: { schema: schemaA, bind: objA }, ... }),
  createChatSdk({ id: 'agent-b', container: boxB, dialog: { drawer: true }, data: { schema: schemaB, bind: objB }, ... }),
  createChatSdk({ id: 'agent-c', container: boxC, dialog: { drawer: true }, data: { schema: schemaC, bind: objC }, ... }),
]
await Promise.all(agents.map(a => a.mount()))  // three independent agents ready in parallel
agents.slice(1).forEach(a => a.hide())         // show only the first initially

let active = 0
function switchTo(i: number) {
  agents[active].hide(); active = i; agents[i].show()  // exclusive switch, each history preserved
}
```

**Key points**:
- Distinct `id` for isolation: each independent agent instance/history/tools/storage, no cross-talk
- Each managing its own `data` object has no conflict; multiple agents operating on the same `data` need coordination (optimistic lock `expectedHash` or `jsonPath` partitioning)
- `hide()` does not unmount vueApp / does not release agent — keeps chat history and in-flight generation; `show()` resumes visibility
- If switch buttons sit under the drawer mask, raise their `z-index` (above mask `9998` + ChatDialog `9999`) to stay clickable

Full example: `examples/multi-agent-demo/`.

### Drawer mode width + hidden by default (click button to show chatbox)

In drawer mode (`dialog.drawer: true`), you can customize the chatbox width and support "hidden by default after mount, shown on button click" scenarios:

```ts
const sdk = createChatSdk({
  id: 'my-agent', container: '#box',
  dialog: {
    drawer: true,             // drawer mode
    drawerWidth: 500,          // width 500px (also accepts '500px' / '40vw' / '50%' etc.); default 420
    drawerHidden: true,        // hidden after mount; requires sdk.show() to display
  },
  llm, data: { schema, bind },
})
await sdk.mount()            // mounted but invisible (drawerHidden takes effect)

// Click button → show chatbox
document.querySelector('#open-chat-btn')!.addEventListener('click', () => sdk.show())
// Close button/mask click → defaults to hide() (keeps agent/history/in-flight generation); show() again resumes
```

**Key points**:
- `dialog.drawerWidth`: pure numbers treated as `px`; strings passed through as-is (supports `vw`/`%` etc. responsive units); only effective when `drawer: true`; inline mode width determined by `container`
- `dialog.drawerHidden`: calls `hide()` immediately after `mount` (adds `cs-hidden` class, invisible but vueApp/agent ready); first `show()` removes the hidden class; subsequent `hide()`/`show()` toggles visibility
- Close button/mask click defaults to `hide()` in drawer mode; pass `dialog.onClose` to customize close behavior

**Advanced extensibility examples** (custom tools / skills / subagents / MCP) in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/advanced.md`: copy-paste code for `defineTool` (error handling + coexisting with dataOps), `defineSkill` (inline content + remote doc), subagents (ad-hoc `spawn_agent`/`spawn_agents` + pre-declared `subagents` → `use_<id>`), MCP (http/sse/websocket + auth + dev gotcha).
