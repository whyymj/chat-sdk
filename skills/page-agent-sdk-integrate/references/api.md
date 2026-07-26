# API reference — instance methods, tool/skill definition, data tools, events

## ChatSdk instance (`createChatSdk(...)` return)

| Method / field | Signature | Purpose |
|---|---|---|
| `mount()` | `() => Promise<void>` | Initialize & render. Await before `send` in headless. |
| `unmount()` | `() => void` | Tear down UI, listeners, flush storage. |
| `messages` | `AgentMessage[]` (reactive) | The conversation. Headless reads this to render. UI shares the same array (single source). |
| `send(message)` | `(msg: string) => Promise<string>` | Send a user message (invoke mode, no stream events). Returns final content. |
| `stream` | `(messages, onEvent, signal?) => Promise<string>` | Low-level stream. UI uses this internally; headless can call directly for streaming. |
| `inspect()` | `() => AgentInfo` | Inspect agent: tools/skills/data/middleware/todos/mcp.servers (each tool's `source`: `builtin`/`mcp:<name>`/`user`). DebugDrawer uses this. |
| `switchSession(id?)` | `(id?: string) => Promise<string>` | Switch session context (load or create by id). Requires `storage` enabled. |
| `hook(handler)` | `(h: SdkEventHandler) => () => void` | Runtime event subscription (multi-listener, returns unsubscribe). Complements `onEvent`. |
| `setData(config)` | `(config: DataConfig) => void` | Runtime swap the main data config (`{ schema, bind, description? }`). Tools pick up new bind/schema immediately, no rebuild. Clears snapshots & resets optimistic-lock hash. |
| `getData()` | `() => DataConfig \| undefined` | Read current main data config (reflects runtime `setData`). `undefined` if `dataOps` disabled. |
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

`handler` receives validated args; return a string (or structured result stringified). Errors via `toolError({ code, message })`.

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
  systemPrompt: `你是 JSON 操作助手。\n${systemPromptHelpers.reliableWriteRules}`,
  llm, container,
}).mount()
```

`reliableWriteRules` — standardized "reliable write rules": read before write (`read`), fields per `read({jsonPath})` (returns format hint), retry on schema-validation errors, prefer `write` with `patch` incremental edits. Recommended for any scenario involving data writes.

By default (`appendReliableWriteRules: true`), the SDK auto-appends `reliableWriteRules` to your custom `systemPrompt` with a `---` separator (clearly distinguishing your content from the SDK-appended write rules); set `appendReliableWriteRules: false` to disable. The default prompt (when `systemPrompt` omitted) already includes them.

## Built-in data tools (auto-injected when `capabilities.dataOps`)

Default `toolMode:'simple'` exposes high-level `read`/`write` + advanced query/snapshot tools (low-level `get`/`set`/`edit`/`delete`/`describe` are hidden, merged into `read`/`write`). `toolMode:'advanced'` exposes all; `toolMode:'minimal'` only `read`/`write`.

| Tool | Purpose | Mode |
|---|---|---|
| **`read`** / **`write`** (2.2+, recommended) | High-level entry: `read({jsonPath?, fields?, depth?})` lists/reads (supports field projection + depth truncation); `write({value?, patch?, patches?, del?})` merges set/edit/delete + auto optimistic lock + auto snapshot | simple/minimal |
| `describe_data` | Show main data description + schema field descriptions | advanced |
| `get_data` | Read main data (supports `jsonPath` precise sub-path read) | advanced |
| `set_data` | Write whole main data (schema-validated, scoped to declared fields) | advanced |
| `edit_data` | Patch by `jsonPath` (set/remove/merge/append) — avoids re-sending large JSON | advanced |
| `delete_data` | Delete a sub-path (jsonPath) | advanced |
| `snapshot_data` | Manual snapshot | simple/advanced |
| `list_data_snapshots` | List snapshots | simple/advanced |
| `restore_data` | Restore (no id = most recent) | simple/advanced |
| `query_data` / `search_data` | JSONPath query / full-text search | simple/advanced |
| `eval_script` | Sandboxed script on data (query/transform; transform supports `{patches:[...]}` incremental mode) | simple/advanced |

**Key rule**: `write`/`set`/`edit`/`delete` only affect **schema-declared** top-level fields (ZodObject auto-whitelist; undeclared fields hidden/denied). Invalid schema → structured error, no write. `write`/`edit` writes in-place (preserves Vue reactive refs). `write` auto-tracks hash from `read` for optimistic lock (no manual `expectedHash` needed). Whole-set / `set_data` / `eval` transform become **merge** semantics in whitelist mode (only updates declared fields, undeclared fields preserved — prevents accidental deletion).

### write / jsonPath edit operations

`write({ value, patch: { op, jsonPath } })` (or `write({ patch: { jsonPath }, del: true })` to delete; or `write({ patches: [...] })` for batch atomic):
- `set` — set a sub-path (or whole value when no `patch`)
- `remove` — remove a sub-path / array element
- `merge` — shallow-merge an object
- `append` — append to an array

Example: `write({ value: 9.9, patch: { op: 'set', jsonPath: 'items.0.price' } })` — precise local edit, no full re-send. `value` is a JSON object (recommended) or JSON string. `patches: [{op:'set', jsonPath:'a', value:1}, {op:'append', jsonPath:'items', value:newItem}]` — batch atomic (any failure → whole batch rolled back).

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
| `data_change` | `operation, value?` | Main data was written via `write` (infers `set`/`edit`/`delete` from args) or low-level `set`/`edit`/`delete`/`restore_data` |
| `message_update` | `count` | The `messages` array changed |
| `error` | `message` | An error occurred (abort excluded) |

`approval_request` is **NOT** forwarded via `onEvent`/`hook` (UI handles it; headless integrators use a custom approval middleware listener).

## `data` config (single main object — schema + bind + auto field-hints)

`data` is the single entry for main-data config — combining schema declaration + object direct-bind + auto field-hint injection:

```ts
import { reactive } from 'vue'  // or any reactivity impl; plain object also works
const PageSchema = z.object({
  title: z.string().describe('页面标题'),
  count: z.number().describe('计数器'),
})
const page = reactive({ title: '首页', count: 0 })  // reactive recommended for UI auto-refresh

createChatSdk({
  data: {
    schema: PageSchema,   // write validation + field .describe() auto-injected into systemPrompt「可操作数据」section + ZodObject top-level keys auto-whitelist
    bind: page,           // reactive/plain object; tools read/write directly (no window)
    description: '页面配置',  // optional; auto-generated if omitted
  },
})
// LLM write page → page reactively updates; integrator changes page → LLM read sees it
```

- **`bind` is required** (any object): reactive → auto-refresh on write (recommended for UI); plain object → write works but no auto-refresh (suitable for headless / backend; integrator uses `onEvent`/`hook` `data_change` to be notified). Tools mutate in-place (`restoreInPlace`), compatible with reactive proxies; plain objects also write fine.
- **Notifying the outside world of changes**: subscribe `data_change` via `onEvent` (constructor) or `sdk.hook` (runtime, multi-listener, cancellable) — fires after `write`/`set`/`edit`/`delete`/`restore`, with `operation`/`value`. For Vue + reactive bind, template/watch auto-react (no manual notify needed); `onEvent` can coexist for audit/analytics.
- **Runtime swap**: `sdk.setData({ schema, bind, description? })` replaces the whole config; tools pick up immediately (no rebuild). Snapshots & lock hash reset.

## Exported building blocks (for custom UIs)

- `ChatDialog`, `MessageContent`, `CodePreview` — Vue components
- `useChat(opts)` — composable (streaming/retry/stop/regenerate logic)
- `createAgent(options)` — the raw harness (if you bypass `createChatSdk`)
- Middleware factories: `createApprovalMiddleware`, `createVerifyMiddleware`, `createWriteBackCheck`, `createSubagentMiddleware`, `createCheckpointMiddleware`, `createUsageHintsMiddleware`
- Storage: `createSessionStore`, `createMemoryBackend`, `createWebStorageBackend`, `isQuotaError`
- JSON helpers: `jpEval`, `searchJson`, `runSandboxedScript`, `toolError`, `zodError`
