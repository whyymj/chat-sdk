# createChatSdk options — what each does & when to use

Full reference for `createChatSdk(options)`. Grouped by purpose. Required: `llm`. Everything else is optional with sane defaults.

## LLM & identity

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `llm` | `LLMConfig \| BaseChatModel` | — (required) | The model. `LLMConfig = { apiKey, baseUrl, model, temperature?, maxTokens? }` (OpenAI-compatible; DeepSeek default). Or pass any LangChain `BaseChatModel` (e.g. `ChatAnthropic`, install its peerDep). |
| `systemPrompt` | `string` | built-in default (JSON-operation assistant + reliable write rules) | Agent identity/instructions. Inject here, not hardcoded. Keep single-line in `.env` (`VITE_AI_SYSTEM_PROMPT`). If omitted, a built-in default is used (JSON-operation assistant + `systemPromptHelpers.reliableWriteRules`); passing your own fully overrides it (append `systemPromptHelpers.reliableWriteRules` yourself if needed). |
| `id` | `string` | random + warn | Stable agent id for multi-agent isolation & persistence. **Must pass a stable value** if you use `storage` or run multiple agents on one page. |
| `title` / `placeholder` | `string` | — | Dialog title / input placeholder (cosmetic). |

## UI & mounting

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `container` | `string \| HTMLElement` | — | Where the built-in dialog mounts. Required when `ui !== false`. |
| `ui` | `boolean \| 'default'` | `true` | `false` = headless (no built-in dialog; you build UI from `sdk.messages` + `sdk.send`). `'default'` = built-in `ChatDialog`. |
| `streaming` | `boolean` | `true` | Stream tokens live. `false` = wait for full reply. Headless `sdk.send` always uses invoke (no stream events, but data/message/error still fire). |

## Data operation (the core)

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `data` | `DataConfig` | — | Declare the single main data object: `{ schema, bind, description? }`. `schema` = zod (write validation + field `.describe()` auto-injected into prompt + ZodObject top-level keys auto-whitelist); `bind` = reactive/plain object (tools read/write directly, no `window`); `description` = optional data purpose. **This is the key integration step.** |
| `maxSnapshots` | `number` | 20 | Snapshot stack depth for `restore_data` (per-path snapshots auto-stored before set/edit/delete). |
| `permissions` | `PermissionRule[]` | off | Scope whitelist (first-match-wins) for fine-grained per-jsonPath/tool rules. Default off (all schema-declared fields writable). |
| `toolMode` | `'simple' \| 'advanced' \| 'minimal'` | `simple` | `simple` = high-level `read`/`write` + query/search/eval/snapshot (hides low-level get/set/edit/delete); `advanced` = all tools; `minimal` = only `read`/`write`. |
| `interceptors` | `{ read?, write?, input?, output? }` | — | `read(value)` desensitize/derive (changes only what LLM sees); `write(payload, current)` transform/audit/reject (return `{error}`); `input`/`output` for message-level interception. |
| `autoLock` | `boolean` | `true` | Auto optimistic lock: `write` compares LLM's last `read` hash with current; mismatch → `VERSION_CONFLICT` (or human resolution via `onConflict`). |

`DataConfig = { schema: z.ZodType; bind: any; description?: string }`. `bind` is any object — reactive (Vue auto-refresh) or plain (use `onEvent('data_change')` to re-render). Field `.describe()` text on `schema` is auto-extracted and injected into the system prompt so the LLM knows each field's purpose.

## Tools, skills, memory

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `tools` | `Tool[]` | `[]` | Custom tools beyond built-ins. Use `defineTool({ name, description, schema, handler })`. |
| `skills` | `SkillSpec[]` | `[]` | Progressive-disclosure skills (`defineSkill({ name, description, prompt }`) loaded on demand by the agent. |
| `memory` | `string` | — | AGENTS.md-style persistent instructions injected into every prompt (project conventions, hard rules). |
| `middleware` | `Middleware[]` | `[]` | Custom middleware appended after built-ins. 8 hooks: `beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent`/`beforeReturn` + `augmentPrompt`/`compressInput`/`tools`. For interception, instrumentation, prompt enhancement. |

## Capabilities (turn built-ins on/off)

`capabilities: { ... }` — default all `true` except `verify`. Set `false` to drop unused built-ins (saves tokens/size).

| Flag | Off when... |
|---|---|
| `dataOps` | Pure research agent, no data edits (also drops data tools from subagents). |
| `fetch` | No web fetching needed. ⚠️ turning off `dataOps` also strips subagent data tools. |
| `planning` | Don't want `write_todos` planning. |
| `skills` | Don't want progressive skill loading. |
| `vfs` | No in-memory workspace; ⚠️ large tool results then truncate instead of offloading. |
| `summarization` | No context compression; ⚠️ long sessions grow unbounded. |
| `memory` | No persistent instructions. |
| `subagent` | No `spawn_agent`/`spawn_agents` delegation. |
| `verify` (reverse) | **Off by default**; `true` enables write-back self-check before the agent returns (costs tokens). |

## Robustness & limits

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `maxRetries` | `number` | 2 | Model call retries on network/429/5xx (exponential backoff). 4xx & abort don't retry. |
| `maxParallelTools` | `number` | 1 | Same-round tool concurrency. `>1` is faster but watch stateful middleware (todos counts). |
| `maxToolRounds` | `number` | — | Cap agent tool rounds (safety against loops). |
| `maxMemoryRounds` | `number` | 50 | In-memory dialog rounds cap; oldest compressed to a summary system message (OOM guard). `0` disables. |
| `contextWindow` / `maxOutputTokens` | `number` | by model name | Override model context/output token limits (affects offload threshold & compression trigger). |
| `debug` | `boolean` | `false` | Verbose logging / DebugDrawer. |

## Context compression

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `contextPreset` | `'auto'\|'conservative'\|'aggressive'` | `auto` | `conservative` = save cost; `aggressive` = save context. `contextOptions` fine-tunes further. |
| `contextOptions` | `object` | — | Detailed compression params (overrides preset). `false` disables compression. Key fields: `windowRounds`, `summaryThresholdRounds`, `contextWindow`, `summaryThresholdRatio`, `windowRatio`, `enableRecall`, `recallTopK`, `enableLLMSummary`, `preserveLastToolResults` (default `['describe_data','read']` — keep these tools' result summaries in the compressed summary so field descriptions survive compression; set `[]` to disable). `getRegisteredData` is injected internally by the SDK (from `sdk.getData`) to embed a live data description in the summary — no need to set it manually. |
| `summaryLlm` | `BaseChatModel \| LLMConfig` | main `llm` | Use a cheaper/faster model for summarization. |
| `summaryTemperature` | `number` | 0.3 | Summary model temperature. |
| `summaryMaxTokens` | `number` | 1024 | Summary output cap. |
| `summaryTimeoutMs` | `number` | 15000 | On timeout, fall back to index-based summary (no failure). |

## Subagent (delegation)

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `subagent` | `object` | enabled | `{ enabled?, allowedTools?, systemPrompt?, temperature?, maxTokens?, skills?, llm?, maxDepth?, maxParallel? }`. `maxDepth` (1) physically cuts recursion. Subagents get a read-only tool subset (no spawn). |
| `subagents` | `SubagentConfig[]` | `[]` | Pre-declared named subagents → each auto-generates a `use_<id>({ task })` delegation tool (Claude-Code style). Fixed roles (research/review) vs ad-hoc `spawn_agent`. |

## Verify (self-check before return)

`capabilities.verify: true` enables. `verify: { check?, maxAttempts?, adversarial? }`:
- `check` omitted → default `createWriteBackCheck()` (scans all writes, reads back from `data.bind` + schema-validates; skips legitimately-rejected writes). Read-back root auto-bound to `data.bind` (adapts to `sdk.setData` runtime swap).
- custom `check: async ({ messages, state }) => ({ ok, feedback? })` — return **actionable** feedback.
- `adversarial: true` → after check passes, spawn a read-only "refuter" subagent (costs extra rounds; for semantically complex cases).
- `maxAttempts` (default 2) caps self-correction loops.

## Approval (human-in-the-loop)

`approval: { tools?, confirm?, ... }` — human confirms before tool execution. Default off; passing `approval` enables. Headless integrators listen for `approval_request` (NOT forwarded via `onEvent`/`hook`) to build their own confirm UI.

## Checkpoint (session rollback)

`checkpoint: true \| { maxCheckpoints?, auto? }` — per-round snapshot of (messages + main data bind + vfs + todos). Read-back/restore auto-bound to `data.bind` via `getData` (adapts to `sdk.setData` runtime swap; in-place restore preserves reactive refs). `restoreLastCheckpoint()` / LLM tool `restore_last_checkpoint` / UI button. Distinct from dataOps per-path snapshots (checkpoint = whole-session rollback).

## Persistence (storage)

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `storage` | `'indexed'\|'session'\|'local'\|'memory'\| StorageConfig \| false` | `false` (off) | Off by default; assign to enable. Persists messages/vfs/todos/memory (NOT `bind` — it may contain non-serializable content; store & re-inject via `sdk.setData`). Auto-degrades to memory if backend unavailable (private mode / quota). |
| `session` | `SessionOptions` | — | Session control (resume by id, etc.). |
| `shareContext` | `boolean` | `false` | `true` → multiple `createChatSdk` with same `id` share one `AgentCore` (same agent, multiple dialog views on a page; shares `data.bind` too). |

## MCP (external tools)

`mcp: [{ transport: 'http'\|'sse'\|'websocket', url, name?, requestInit? }]` — connect remote MCP servers, dynamically inject their tools (`Promise.allSettled` fault-isolated). Browser only supports remote transports (no stdio). `@modelcontextprotocol/sdk` is an optional peerDep, dynamically imported only when used.

## Events

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `onEvent` | `(e: SdkEvent) => void` | — | Constructor-time event subscription (single). Replaces polling for host-page reactivity. See [api.md](api.md) for event types. |

Runtime subscription via `sdk.hook(handler) => () => void` (multi-listener, cancellable) — see [api.md](api.md).

## vfs (in-memory workspace)

`vfs: { initialFiles?, maxBytes? }` — `maxBytes` default 4MB; LRU-evicts oldest files on overflow. Tool results > 6000 chars auto-offload to vfs (only preview + `vfs_read`/`vfs_grep` reference kept). Disabling `capabilities.vfs` degrades to truncation.
