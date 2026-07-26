# API reference — instance methods, tool/skill definition, data slot tools, events

## ChatSdk instance (`createChatSdk(...)` return)

| Method / field | Signature | Purpose |
|---|---|---|
| `mount()` | `() => Promise<void>` | Initialize & render. Await before `send` in headless. |
| `unmount()` | `() => void` | Tear down UI, listeners, flush storage. |
| `messages` | `AgentMessage[]` (reactive) | The conversation. Headless reads this to render. UI shares the same array (single source). |
| `send(message)` | `(msg: string) => Promise<string>` | Send a user message (invoke mode, no stream events). Returns final content. |
| `stream` | `(messages, onEvent, signal?) => Promise<string>` | Low-level stream. UI uses this internally; headless can call directly for streaming. |
| `inspect()` | `() => AgentInfo` | Inspect agent: tools/skills/dataSlots/middleware/todos/mcp.servers (each tool's `source`: `builtin`/`mcp:<name>`/`user`). DebugDrawer uses this. |
| `switchSession(id?)` | `(id?: string) => Promise<string>` | Switch session context (load or create by id). Requires `storage` enabled. |
| `hook(handler)` | `(h: SdkEventHandler) => () => void` | Runtime event subscription (multi-listener, returns unsubscribe). Complements `onEvent`. |
| `addDataSlot(spec)` | `(spec: DataSlotSpec) => void` | Runtime register/override a data slot (lazy-loaded components). Takes effect immediately, no rebuild. Needs `dataSlotOps` enabled. |
| `removeDataSlot(path)` | `(path: string) => boolean` | Remove a registered data slot (component unmount); returns whether it existed. Clears its snapshot stack. |
| `listDataSlots()` | `() => DataSlotSpec[]` | List currently-registered data slots (reflects dynamic add/remove). |
| `restoreLastCheckpoint()` | `() => boolean` | Restore last good checkpoint (needs `checkpoint` enabled). |
| `listCheckpoints()` | `() => CheckpointMeta[]` | List available checkpoints. |

## defineTool (custom tools)

```ts
import { defineTool, z } from 'page-agent-sdk'

const addTool = defineTool({
  name: 'add',
  description: 'Add two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ a, b }) => `sum: ${a + b}`,
})

createChatSdk({ tools: [addTool], /* llm, ... */ }).mount()
```

`handler` receives validated args; return a string (or structured result stringified). Errors via `toolError({ path, code, message })`.

## defineSkill (progressive disclosure)

```ts
import { defineSkill } from 'page-agent-sdk'

const apiSkill = defineSkill({
  name: 'api-design',
  description: 'REST API design conventions for this project (load when designing/reviewing APIs)',
  getContent: () => 'Use kebab-case URLs; version under /v1; ...',   // or `doc: 'https://...'` for remote
})

createChatSdk({ skills: [apiSkill], /* ... */ }).mount()
```

Skills are loaded on demand by the agent (not always in context) — saves tokens.

## presets (scenario bundles)

```ts
import { createChatSdk, presets } from 'page-agent-sdk'

createChatSdk({ ...presets.pageBuilder, llm, container }).mount()
// or presets.researcher / presets.minimal
```

Spread into options for common scenarios.

## systemPromptHelpers (best-practice prompt snippets)

```ts
import { createChatSdk, systemPromptHelpers } from 'page-agent-sdk'

createChatSdk({
  systemPrompt: `你是页面助手。\n${systemPromptHelpers.reliableWriteRules}`,
  llm, container,
}).mount()
```

`reliableWriteRules` — standardized "reliable write rules": read before write (`read`), list in dynamic scenarios (`read()` no path), fields per `read({path})` (returns format hint), retry on schema-validation errors, prefer `write` with `patch` incremental edits. Recommended for any scenario involving data-slot writes.

## Built-in data slot tools (auto-injected when `capabilities.dataSlotOps`)

Default `toolMode:'simple'` exposes high-level `read`/`write` + advanced query/snapshot tools (low-level `get`/`set`/`edit`/`delete`/`list`/`describe` are hidden, merged into `read`/`write`). `toolMode:'advanced'` exposes all; `toolMode:'minimal'` only `read`/`write`.

| Tool | Purpose | Mode |
|---|---|---|
| **`read`** / **`write`** (2.2+, recommended) | High-level entry: `read({path?})` lists/reads; `write({path, value?, patch?, del?})` merges set/edit/delete + auto optimistic lock + auto snapshot | simple/minimal |
| `list_data_slots` | List declared paths + descriptions | advanced |
| `describe_data_slot` | Show a path's schema | advanced |
| `get_data_slot` | Read a path (or ancestor/descendant sub-paths of registered props) | advanced |
| `get_slot_paths` | Batch-read multiple paths | simple/advanced |
| `set_data_slot` | Write a whole path (schema-validated, scoped to registry) | advanced |
| `edit_data_slot` | Patch by `jsonPath` (set/remove/merge/append) — avoids re-sending large JSON | advanced |
| `delete_data_slot` | Delete a path | advanced |
| `snapshot_data_slot` | Manual snapshot | simple/advanced |
| `list_data_snapshots` | List snapshots | simple/advanced |
| `restore_data_snapshot` | Restore (no id = most recent) | simple/advanced |
| `query_data_slot` / `search_data_slot` | JSONPath query / full-text search | simple/advanced |
| `eval_script` | Sandboxed script on data (for batch ops) | simple/advanced |

**Key rule**: `write`/`set`/`edit`/`delete` only affect **declared** `dataSlots` paths. Invalid schema → structured error, no write. `write`/`edit` writes in-place (preserves Vue reactive refs). `write` auto-tracks hash from `read` for optimistic lock (no manual `expectedHash` needed).

### write / jsonPath edit operations

`write({ path, value, patch: { op, jsonPath } })` (or `write({ path, del: true })` to delete):
- `set` — set a sub-path (or whole value when no `patch`)
- `remove` — remove a sub-path / array element
- `merge` — shallow-merge an object
- `append` — append to an array

Example: `write({ path: 'app.items', value: 9.9, patch: { op: 'set', jsonPath: '0.price' } })` — precise local edit, no full re-send. `value` is a JSON object (recommended) or JSON string.

## Built-in fetch tools (`capabilities.fetch`)

`fetch_document` — GET a URL, return cleaned text (HTML→markdown, truncated, offloaded to vfs if large).

## SdkEvent types (for `onEvent` / `sdk.hook`)

| `type` | Payload | When |
|---|---|---|
| `round_start` | `round` | Each agent round begins |
| `reasoning` | `delta` | Reasoning token (models that emit it) |
| `text` | `delta` | Streamed text delta (stream mode only) |
| `tool_call` | `name, args` | A tool is invoked |
| `tool_result` | `name, result, status` | Tool returns (`status`: `done`/`error`) |
| `subagent` | `taskId, label, kind, name, args?, result?, status?` | Subagent tool progress (forwarded to UI, NOT into main LLM context) |
| `done` | `content` | Agent round completes |
| `data_slot_change` | `path, operation, value?` | A data slot was written via `write` (high-level, infers `set`/`edit`/`delete` from args) or low-level `set`/`edit`/`delete`/`restore_data_snapshot` |
| `message_update` | `count` | The `messages` array changed |
| `error` | `message` | An error occurred (abort excluded) |

`approval_request` is **NOT** forwarded via `onEvent`/`hook` (UI handles it; headless integrators use a custom approval middleware listener).

## `dataSlots` unified config (3.0+, declarative — schema + bind + auto field-hints)

`dataSlots` is the single entry for data-slot config — combining schema declaration + optional object direct-bind + auto field-hint injection:

```ts
import { reactive } from 'vue'  // or any reactivity impl
const PageSchema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
const page = reactive({ title: '首页', count: 0 })  // reactive recommended for UI auto-refresh

createChatSdk({
  dataSlots: [
    {
      path: 'page',            // path on window (dot-nested supported)
      schema: PageSchema,       // write validation + field .describe() auto-injected into systemPrompt「可操作属性」section
      bind: page,               // optional: reactive/plain object auto-mounted to window[path] + registered as dataSlot
    },
  ],
})
// LLM write page → page reactively updates; integrator changes page → LLM read sees it
```

- **`bind` is an optional `dataSlots` field** (any object): reactive → auto-refresh on write (recommended for UI); plain object → write works but no auto-refresh (suitable for headless / backend; integrator uses `onEvent`/`hook` `data_slot_change` to be notified). Omit `bind` when the integrator mounts `window[path]` themselves (object already exists / dynamic registration via `addDataSlot`/`removeDataSlot` / field-whitelist read).
- Tools `set`/`write` mutate in-place (`restoreInPlace`), compatible with reactive proxies; plain objects also write fine.
- **Notifying the outside world of changes**: subscribe `data_slot_change` via `onEvent` (constructor) or `sdk.hook` (runtime, multi-listener, cancellable) — fires after `write`/`set`/`edit`/`delete`/`restore`, with `path`/`operation`/`value`. For Vue + reactive bind, template/watch auto-react (no manual notify needed); `onEvent` can coexist for audit/analytics.

## Exported building blocks (for custom UIs)

- `ChatDialog`, `MessageContent`, `CodePreview` — Vue components
- `useChat(opts)` — composable (streaming/retry/stop/regenerate logic)
- `createAgent(options)` — the raw harness (if you bypass `createChatSdk`)
- Middleware factories: `createApprovalMiddleware`, `createVerifyMiddleware`, `createWriteBackCheck`, `createSubagentMiddleware`, `createCheckpointMiddleware`, `createUsageHintsMiddleware`
- Storage: `createSessionStore`, `createMemoryBackend`, `createWebStorageBackend`, `isQuotaError`
- JSON helpers: `jpEval`, `searchJson`, `runSandboxedScript`, `toolError`, `zodError`
