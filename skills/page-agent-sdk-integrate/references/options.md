# createChatSdk options — what each does & when to use

Full reference for `createChatSdk(options)`. Grouped by purpose. Required: `llm`. Everything else is optional with sane defaults.

## LLM & identity

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `llm` | `LLMConfig \| BaseChatModel` | — (required) | The model. `LLMConfig = { apiKey, baseUrl, model, temperature?, maxTokens? }` (OpenAI-compatible; DeepSeek default). Or pass any LangChain `BaseChatModel` (e.g. `ChatAnthropic`, install its peerDep). |
| `systemPrompt` | `string` | built-in default (generic page assistant + reliable write rules) | Agent identity/instructions. Inject here, not hardcoded. Keep single-line in `.env` (`VITE_AI_SYSTEM_PROMPT`). If omitted, a built-in default is used (page-operation assistant + `systemPromptHelpers.reliableWriteRules`); passing your own fully overrides it (append `systemPromptHelpers.reliableWriteRules` yourself if needed). |
| `id` | `string` | random + warn | Stable agent id for multi-agent isolation & persistence. **Must pass a stable value** if you use `storage` or run multiple agents on one page. |
| `title` / `placeholder` | `string` | — | Dialog title / input placeholder (cosmetic). |

## UI & mounting

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `container` | `string \| HTMLElement` | — | Where the built-in dialog mounts. Required when `ui !== false`. |
| `ui` | `boolean \| 'default'` | `true` | `false` = headless (no built-in dialog; you build UI from `sdk.messages` + `sdk.send`). `'default'` = built-in `ChatDialog`. |
| `streaming` | `boolean` | `true` | Stream tokens live. `false` = wait for full reply. Headless `sdk.send` always uses invoke (no stream events, but window/message/error still fire). |

## window operation (the core)

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `windowProps` | `WindowPropSpec[]` | `[]` | Declare writable `window` paths + zod schemas. The agent can ONLY touch declared paths; `set`/`edit` are schema-validated. **This is the key integration step.** |
| `maxSnapshots` | `number` | 20 | Per-path snapshot stack depth for `restore_window_snapshot`. |
| `permissions` | `PermissionRule[]` | off | Scope whitelist (first-match-wins) for fine-grained per-path/tool rules. Default off (all declared paths writable). |

`WindowPropSpec = { path: string; description: string; schema?: z.ZodType }`. `description` is shown to the AI — write it clearly so the agent knows what each path means.

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
| `windowOps` | Pure research agent, no page edits (also drops window tools from subagents). |
| `fetch` | No web fetching needed. ⚠️ turning off `windowOps` also strips subagent window tools. |
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
| `contextOptions` | `object` | — | Detailed compression params (overrides preset). `false` disables compression. Key fields: `windowRounds`, `summaryThresholdRounds`, `contextWindow`, `summaryThresholdRatio`, `windowRatio`, `enableRecall`, `recallTopK`, `enableLLMSummary`, `preserveLastToolResults` (default `['describe_window_prop','list_window_props']` — keep these tools' result summaries in the compressed summary so field descriptions survive compression; set `[]` to disable). `getRegisteredProps` is injected internally by the SDK (from `sdk.listWindowProps`) to embed a live registry snapshot in the summary — no need to set it manually. |
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
- `check` omitted → default `createWriteBackCheck()` (scans all writes, reads back + schema-validates; skips legitimately-rejected writes).
- custom `check: async ({ messages, state }) => ({ ok, feedback? })` — return **actionable** feedback.
- `adversarial: true` → after check passes, spawn a read-only "refuter" subagent (costs extra rounds; for semantically complex cases).
- `maxAttempts` (default 2) caps self-correction loops.

## Approval (human-in-the-loop)

`approval: { tools?, confirm?, ... }` — human confirms before tool execution. Default off; passing `approval` enables. Headless integrators listen for `approval_request` (NOT forwarded via `onEvent`/`hook`) to build their own confirm UI.

## Checkpoint (session rollback)

`checkpoint: true \| { maxCheckpoints?, auto? }` — per-round snapshot of (messages + window props + vfs + todos). `restoreLastCheckpoint()` / LLM tool `restore_last_checkpoint` / UI button. Distinct from windowOps per-path snapshots (checkpoint = whole-session rollback).

## Persistence (storage)

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `storage` | `'indexed'\|'session'\|'local'\|'memory'\| StorageConfig \| false` | `false` (off) | Off by default; assign to enable. Persists messages/vfs/todos/memory (NOT window snapshots). Auto-degrades to memory if backend unavailable (private mode / quota). |
| `session` | `SessionOptions` | — | Session control (resume by id, etc.). |
| `shareContext` | `boolean` | `false` | `true` → multiple `createChatSdk` with same `id` share one `AgentCore` (same agent, multiple dialog views on a page). |

## MCP (external tools)

`mcp: [{ transport: 'http'\|'sse'\|'websocket', url, name?, requestInit? }]` — connect remote MCP servers, dynamically inject their tools (`Promise.allSettled` fault-isolated). Browser only supports remote transports (no stdio). `@modelcontextprotocol/sdk` is an optional peerDep, dynamically imported only when used.

## Events

| Option | Type | Default | Purpose / when |
|---|---|---|---|
| `onEvent` | `(e: SdkEvent) => void` | — | Constructor-time event subscription (single). Replaces polling for host-page reactivity. See [api.md](api.md) for event types. |

Runtime subscription via `sdk.hook(handler) => () => void` (multi-listener, cancellable) — see [api.md](api.md).

## vfs (in-memory workspace)

`vfs: { initialFiles?, maxBytes? }` — `maxBytes` default 4MB; LRU-evicts oldest files on overflow. Tool results > 6000 chars auto-offload to vfs (only preview + `vfs_read`/`vfs_grep` reference kept). Disabling `capabilities.vfs` degrades to truncation.
