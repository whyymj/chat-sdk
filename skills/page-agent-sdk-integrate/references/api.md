# API reference — instance methods, tool/skill definition, window tools, events

## ChatSdk instance (`createChatSdk(...)` return)

| Method / field | Signature | Purpose |
|---|---|---|
| `mount()` | `() => Promise<void>` | Initialize & render. Await before `send` in headless. |
| `unmount()` | `() => void` | Tear down UI, listeners, flush storage. |
| `messages` | `AgentMessage[]` (reactive) | The conversation. Headless reads this to render. UI shares the same array (single source). |
| `send(message)` | `(msg: string) => Promise<string>` | Send a user message (invoke mode, no stream events). Returns final content. |
| `stream` | `(messages, onEvent, signal?) => Promise<string>` | Low-level stream. UI uses this internally; headless can call directly for streaming. |
| `inspect()` | `() => AgentInfo` | Inspect agent: tools/skills/windowProps/middleware/todos/mcp.servers (each tool's `source`: `builtin`/`mcp:<name>`/`user`). DebugDrawer uses this. |
| `switchSession(id?)` | `(id?: string) => Promise<string>` | Switch session context (load or create by id). Requires `storage` enabled. |
| `hook(handler)` | `(h: SdkEventHandler) => () => void` | Runtime event subscription (multi-listener, returns unsubscribe). Complements `onEvent`. |
| `addWindowProp(spec)` | `(spec: WindowPropSpec) => void` | Runtime register/override a window prop (lazy-loaded components). Takes effect immediately, no rebuild. Needs `windowOps` enabled. |
| `removeWindowProp(path)` | `(path: string) => boolean` | Remove a registered window prop (component unmount); returns whether it existed. Clears its snapshot stack. |
| `listWindowProps()` | `() => WindowPropSpec[]` | List currently-registered window props (reflects dynamic add/remove). |
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

## Built-in window tools (auto-injected when `capabilities.windowOps`)

| Tool | Purpose |
|---|---|
| `list_window_props` | List declared paths + descriptions |
| `describe_window_prop` | Show a path's schema |
| `get_window_prop` | Read a path (or ancestor/descendant sub-paths of registered props) |
| `get_window_paths` | Batch-read multiple paths |
| `set_window_prop` | Write a whole path (schema-validated, scoped to registry) |
| `edit_window_prop` | Patch by `jsonPath` (set/remove/merge/append) — avoids re-sending large JSON |
| `delete_window_prop` | Delete a path |
| `snapshot_window_prop` | Manual snapshot |
| `list_window_snapshots` | List snapshots |
| `restore_window_snapshot` | Restore (no id = most recent) |
| `query_window_prop` / `search_window_prop` | JSONPath query / full-text search |
| `eval_window_script` | Sandboxed script on data (for batch ops) |

**Key rule**: `set`/`edit`/`delete` only affect **declared** `windowProps` paths. Invalid schema → structured error, no write. `edit` writes in-place (preserves Vue reactive refs).

### jsonPath edit operations

`edit_window_prop({ path, jsonPath, op, value })`:
- `set` — set a sub-path
- `remove` — remove a sub-path / array element
- `merge` — shallow-merge an object
- `append` — append to an array

Example: `edit_window_prop({ path: 'app.items', jsonPath: '0.price', op: 'set', value: 9.9 })` — precise local edit, no full re-send.

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
| `window_prop_change` | `path, operation, value?` | A window prop was written (`operation`: `set`/`edit`/`delete`/`restore`) |
| `message_update` | `count` | The `messages` array changed |
| `error` | `message` | An error occurred (abort excluded) |

`approval_request` is **NOT** forwarded via `onEvent`/`hook` (UI handles it; headless integrators use a custom approval middleware listener).

## Exported building blocks (for custom UIs)

- `ChatDialog`, `MessageContent`, `CodePreview` — Vue components
- `useChat(opts)` — composable (streaming/retry/stop/regenerate logic)
- `createAgent(options)` — the raw harness (if you bypass `createChatSdk`)
- Middleware factories: `createApprovalMiddleware`, `createVerifyMiddleware`, `createWriteBackCheck`, `createSubagentMiddleware`, `createCheckpointMiddleware`, `createUsageHintsMiddleware`
- Storage: `createSessionStore`, `createMemoryBackend`, `createWebStorageBackend`, `isQuotaError`
- JSON helpers: `jpEval`, `searchJson`, `runSandboxedScript`, `toolError`, `zodError`
