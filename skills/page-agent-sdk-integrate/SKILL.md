---
name: page-agent-sdk-integrate
description: Integrate the page-agent-sdk npm package into a web app so an AI agent can read/write a structured main data object via schema-validated tools. Use when the user wants to add/embed the SDK, declare `data` (single main object + zod schema + bind), configure the LLM, mount the chat dialog, subscribe to events (onEvent / sdk.hook), run headless (ui:false) with a custom UI, swap data at runtime (sdk.setData), or troubleshoot common integration issues (DeepSeek 400 tool_call_id, MCP injecting 0 tools, etc).
---

# Integrate page-agent-sdk

Help the user embed `page-agent-sdk` so an AI agent safely edits a structured main JSON object via tools.

## Core concept

The SDK is a **standardized JSON-operation agent**: the integrator declares ONE main data object (`data: { schema, bind, description? }`); the agent edits it via `read` / `write` (high-level entry; `write` merges set/edit/delete + auto optimistic lock + auto snapshot), validated by schema, scoped to schema-declared fields (ZodObject top-level keys auto-whitelist), with snapshot rollback. "Editing JSON" becomes structured + validatable + rollbackable, NOT free-form LLM text. `bind` is any reactive/plain object — tools read/write it directly, **no `window` dependency**. Advanced mode (`toolMode:'advanced'`) also exposes low-level `get_data`/`set_data`/`edit_data`/`delete_data` for precise control.

## Workflow

### 1. Choose install method

| Method | When | How |
|---|---|---|
| **npm** | module project, tree-shake ok | `npm i page-agent-sdk zod @langchain/openai @langchain/core` → `import { createChatSdk, z } from 'page-agent-sdk'` |
| **CDN · ESM** (esm.sh) | modular, small, peer auto-resolved | `import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'` |
| **CDN · IIFE** (unpkg) | one-line, no build, ~1.4MB all-in | `<script src="https://unpkg.com/page-agent-sdk"></script>` → `ChatSdk.createChatSdk`, `ChatSdk.z` |

See `demo/plain.html` for a framework-agnostic importmap + esm.sh example.

### 2. Declare `data` (the key step)

Create a plain/reactive object as the main data, then declare it with a zod schema. The agent can ONLY touch schema-declared top-level fields (ZodObject auto-whitelist); `set`/`edit` are schema-validated (invalid → structured error, no write). Field `.describe()` text is auto-injected into the system prompt so the LLM knows each field's purpose.

> `systemPrompt` is optional — a built-in default is used if omitted (generic JSON-operation assistant + `systemPromptHelpers.reliableWriteRules`: read-before-write, fields per `describe`, retry on validation error, prefer incremental `edit`). Passing your own fully overrides it. By default (`appendReliableWriteRules: true`, the default), the SDK auto-appends `reliableWriteRules` to your custom `systemPrompt` with a `---` separator (clearly distinguishing your content from the SDK-appended write rules); set `appendReliableWriteRules: false` to disable.

```ts
import { createChatSdk, z } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'

const app = { title: 'Demo', theme: 'light', items: [] }  // plain object (or reactive for Vue auto-refresh)

createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  systemPrompt: 'You are a JSON operation assistant; read/write the main data via tools.',
  data: {
    schema: z.object({
      title: z.string().describe('页面标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
      items: z.array(z.object({ name: z.string(), price: z.number() })).describe('列表项数组'),
    }),
    bind: app,            // tools read/write `app` directly (no window)
    description: '应用配置',  // optional; auto-generated if omitted
  },
}).mount()
```

For large JSON, prefer `write` with `patch` (jsonPath patch: set/remove/merge/append) over `write` with whole `value` — avoids re-sending the entire blob. `read({ jsonPath, fields, depth })` supports field projection + depth truncation to slim large returns.

### 3. Configure the LLM

`llm` accepts an `LLMConfig` object (`{ apiKey, baseUrl, model, temperature?, maxTokens? }`) or any LangChain `BaseChatModel` instance. Default protocol is OpenAI-compatible (DeepSeek works out of the box). For large JSON edits use low temperature (~0.3).

### 4. Subscribe to events (replace polling)

Two complementary ways to react to SDK changes from the host page:

```ts
const sdk = createChatSdk({
  onEvent(e) { if (e.type === 'data_change') renderUI() },  // constructor-time, single
  // ...
}).mount()

// runtime, multiple listeners, cancellable
const off = sdk.hook((e) => { if (e.type === 'tool_call') analytics.track(e.name) })
// off() to unsubscribe
```

Event types: `data_change` / `message_update` / `tool_call` / `tool_result` / `text` / `round_start` / `done` / `error` (+ stream events in stream mode). `approval_request` is NOT forwarded (UI handles it).

### 5. Headless mode (custom UI, framework-agnostic)

`ui: false` → no built-in dialog; use the reactive `sdk.messages` array + `sdk.send`/`sdk.stream` to build your own UI. Reusable `ChatDialog` / `MessageContent` / `CodePreview` components and `useChat` composable are exported from the entry for custom UIs.

### 6. Capabilities & presets

- `capabilities: { dataOps:false, fetch:false, planning:false, skills:false, vfs:false, summarization:false, memory:false, subagent:false }` — turn off unused built-ins to save tokens/size. `verify` is the reverse (off by default; `capabilities.verify:true` enables write-back self-check).
- `presets.pageBuilder` / `researcher` / `minimal` — spread into `createChatSdk` for common scenarios.

### 7. Swap data at runtime (lazy-loaded / dynamic schema)

`sdk.setData({ schema, bind, description? })` replaces the whole main data config at runtime — tools pick up the new bind/schema immediately (no rebuild). `sdk.getData()` reads the current config. Useful for lazy-loaded components or when the page schema changes dynamically.

## Common use cases (match the user's scenario, then read [references/use-cases.md](references/use-cases.md) for full code)

| Scenario | Key setup |
|---|---|
| **Low-code page builder** | `data` = component tree; `write` patch jsonPath; `onEvent('data_change')` → canvas refresh; `checkpoint` + `approval` |
| **Form designer** | `data` = field definitions with enum/required schemas; schema validation prevents malformed forms |
| **CMS batch ops** | `eval_script` for bulk loops; `search_data` to filter; `write` patch for targeted edits |
| **Ops config console** | `approval:{tools:['write']}` human-confirm; `capabilities.verify:true` write-back read; `checkpoint` |
| **AI-native assistant** | `capabilities:{dataOps:false,fetch:false}` + custom `tools` (your product API) |
| **Research agent** | `capabilities:{dataOps:false}`; `subagent:{allowedTools:['fetch_document']}`; `contextPreset:'conservative'` |
| **Headless / server-side** | `ui:false` + `storage:'memory'` + `capabilities:{fetch:false}` (dataOps body works in Node with any `bind`); drive via `sdk.send` |
| **Multi-agent on one page** | same `id` + `shareContext:true` → multiple dialogs share one `AgentCore` |
| **MCP integration** | `mcp:[{transport,url}]` remote tool servers; `@modelcontextprotocol/sdk` optional peerDep |
| **Dynamic / lazy-loaded schema** | `sdk.setData({ schema, bind })` on component mount to swap the main data; tools pick up immediately, no rebuild. See [references/advanced.md §0](references/advanced.md) |

When the user describes a scenario, map it to the row above and load `references/use-cases.md` for the matching numbered case (1→10) with copy-paste code. For dynamic schema / custom tools/skills/subagents/MCP, load [references/advanced.md](references/advanced.md).

## References (read as needed)

Detailed docs live in this skill's `references/` folder — load the one matching the user's question:

- **[references/quickstart.md](references/quickstart.md)** — progressive setup from 5-line CDN to full-featured (Stages 0→6). Read when the user wants a step-by-step "from simple to complete" walkthrough.
- **[references/options.md](references/options.md)** — every `createChatSdk` option: type, default, purpose & when to use. Read when the user asks "what does option X do" or needs to tune behavior.
- **[references/api.md](references/api.md)** — instance methods (`mount`/`send`/`stream`/`inspect`/`switchSession`/`hook`/`setData`/`getData`/checkpoints), `defineTool`/`defineSkill`/`presets`, built-in data tools, and the full `SdkEvent` type table. Read when the user asks about APIs, tools, or events.
- **[references/use-cases.md](references/use-cases.md)** — 10 end-to-end scenarios (low-code builder / form designer / CMS batch / ops console / AI-native / research / server-side / multi-agent / MCP / dynamic schema via setData). Read when the user wants a concrete pattern for their use case.
- **[references/advanced.md](references/advanced.md)** — detailed examples for the extensibility surfaces: **dynamic schema (`sdk.setData` to swap main data at runtime)**, custom `defineTool` (with error handling + coexisting with dataOps), `defineSkill` (inline content + remote doc), subagents (ad-hoc `spawn_agent`/`spawn_agents` + pre-declared `subagents` → `use_<id>`), MCP (http/sse/websocket + auth + dev gotcha). Read when the user asks "how to add custom tools / skills / subagents / MCP" or "swap data/schema at runtime".
- **[references/integration-prompt.md](references/integration-prompt.md)** — a generic integration prompt template to copy into the target project's AI (Cursor / Claude Code) when the skill is NOT installed there. Fill in `[...]` per scenario. Read when the user asks "give me a prompt to integrate the SDK in another project" or wants a copy-paste prompt for a teammate's AI tool.

Project-level docs (in the repo, not bundled in this skill):
- `doc/usage-guide.md` (zh) / `doc/usage-guide.en.md` — full options reference
- `examples/<demo>/` — runnable demos (page-demo, nested-demo, complex-demo, dynamic-demo, subagent-demo, mcp-demo, planner-demo, toolsets-demo, human-confirm-demo)
- `demo/plain.html` — framework-agnostic CDN integration
- `CLAUDE.md` — internal dev guide (architecture, conventions)

## Common pitfalls

- **DeepSeek/OpenAI 400 `missing field tool_call_id`**: `ToolMessage` must use snake_case `tool_call_id` (not camelCase). Already handled internally; only relevant if writing custom tool plumbing.
- **ChatOpenAI params**: use `apiKey` (not `openAIApiKey`), `model` (not `modelName`); `baseUrl` goes via `configuration.baseURL`.
- **MCP injects 0 tools on first cold visit**: `vite.config.ts` `optimizeDeps.include` pre-declares the SDK sub-paths; if you fork the config, keep those entries or the first MCP page load injects nothing (reload fixes it).
- **`.env` `VITE_AI_SYSTEM_PROMPT` must be single-line** (dotenv doesn't support multi-line values).
- **Server-side (Node.js)**: works with `ui:false` + `storage:'memory'` + `capabilities:{fetch:false}`; dataOps body (`read`/`write`/`get`/`edit`/`delete`/`query`/`search`) works in Node with any `bind` object — only `eval_script` needs Web Worker (disable via `capabilities:{dataOps:false}` if unused). `mount()`/`unmount()` guard `window`/`document` access.
- **`bind` not persisted**: `storage` persists messages/vfs/todos/memory but NOT the main data `bind` (it may contain non-serializable content). To restore `bind` across refresh/sessions, store it yourself and re-inject via `sdk.setData({ bind: restoredBind })`.
