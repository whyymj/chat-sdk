---
name: page-agent-sdk-integrate
description: Integrate the page-agent-sdk npm package into a web app so an AI agent can read/write structured page data (window props) via schema-validated tools. Use when the user wants to add/embed the SDK, declare windowProps + zod schemas, configure the LLM, mount the chat dialog, subscribe to events (onEvent / sdk.hook), run headless (ui:false) with a custom UI, or troubleshoot common integration issues (DeepSeek 400 tool_call_id, MCP injecting 0 tools, etc).
---

# Integrate page-agent-sdk

Help the user embed `page-agent-sdk` so an AI agent safely edits their page's structured JSON via tools.

## Core concept

The SDK is a **standardized JSON-operation agent**: the integrator declares writable `window` paths + zod schemas; the agent edits them via `set_window_prop` / `edit_window_prop` (jsonPath patches), validated by schema, scoped to the registry, with snapshot rollback. "Editing JSON" becomes structured + validatable + rollbackable, NOT free-form LLM text.

## Workflow

### 1. Choose install method

| Method | When | How |
|---|---|---|
| **npm** | module project, tree-shake ok | `npm i page-agent-sdk zod @langchain/openai @langchain/core` → `import { createChatSdk, z } from 'page-agent-sdk'` |
| **CDN · ESM** (esm.sh) | modular, small, peer auto-resolved | `import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'` |
| **CDN · IIFE** (unpkg) | one-line, no build, ~1.4MB all-in | `<script src="https://unpkg.com/page-agent-sdk"></script>` → `ChatSdk.createChatSdk`, `ChatSdk.z` |

See `demo/plain.html` for a framework-agnostic importmap + esm.sh example.

### 2. Declare windowProps + schemas (the key step)

Put the page data on `window` (e.g. `window.app = { title, theme }`), then declare each writable path with a zod schema. The agent can ONLY touch declared paths; `set`/`edit` are schema-validated (invalid → structured error, no write).

```ts
import { createChatSdk, z } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'

window.app = { title: 'Demo', theme: 'light', items: [] }

createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  systemPrompt: 'You are a page assistant; read/write window.app via tools.',
  windowProps: [
    { path: 'app.title',  description: '页面标题',  schema: z.string() },
    { path: 'app.theme',  description: '主题',      schema: z.enum(['light','dark']) },
    { path: 'app.items', description: '列表项数组', schema: z.array(z.object({ name: z.string(), price: z.number() })) },
  ],
}).mount()
```

For large JSON, prefer `edit_window_prop` (jsonPath patch: set/remove/merge/append) over `set_window_prop` (whole value) — avoids re-sending the entire blob.

### 3. Configure the LLM

`llm` accepts an `LLMConfig` object (`{ apiKey, baseUrl, model, temperature?, maxTokens? }`) or any LangChain `BaseChatModel` instance. Default protocol is OpenAI-compatible (DeepSeek works out of the box). For large JSON edits use low temperature (~0.3).

### 4. Subscribe to events (replace polling)

Two complementary ways to react to SDK changes from the host page:

```ts
const sdk = createChatSdk({
  onEvent(e) { if (e.type === 'window_prop_change') renderUI() },  // constructor-time, single
  // ...
}).mount()

// runtime, multiple listeners, cancellable
const off = sdk.hook((e) => { if (e.type === 'tool_call') analytics.track(e.name) })
// off() to unsubscribe
```

Event types: `window_prop_change` / `message_update` / `tool_call` / `tool_result` / `text` / `round_start` / `done` / `error` (+ stream events in stream mode). `approval_request` is NOT forwarded (UI handles it).

### 5. Headless mode (custom UI, framework-agnostic)

`ui: false` → no built-in dialog; use the reactive `sdk.messages` array + `sdk.send`/`sdk.stream` to build your own UI. Reusable `ChatDialog` / `MessageContent` / `CodePreview` components and `useChat` composable are exported from the entry for custom UIs.

### 6. Capabilities & presets

- `capabilities: { windowOps:false, fetch:false, planning:false, skills:false, vfs:false, summarization:false, memory:false, subagent:false }` — turn off unused built-ins to save tokens/size. `verify` is the reverse (off by default; `capabilities.verify:true` enables write-back self-check).
- `presets.pageBuilder` / `researcher` / `minimal` — spread into `createChatSdk` for common scenarios.

## References (read as needed)

Detailed docs live in this skill's `references/` folder — load the one matching the user's question:

- **[references/quickstart.md](references/quickstart.md)** — progressive setup from 5-line CDN to full-featured (Stages 0→6). Read when the user wants a step-by-step "from simple to complete" walkthrough.
- **[references/options.md](references/options.md)** — every `createChatSdk` option: type, default, purpose & when to use. Read when the user asks "what does option X do" or needs to tune behavior.
- **[references/api.md](references/api.md)** — instance methods (`mount`/`send`/`stream`/`inspect`/`switchSession`/`hook`/checkpoints), `defineTool`/`defineSkill`/`presets`, built-in window tools, and the full `SdkEvent` type table. Read when the user asks about APIs, tools, or events.
- **[references/use-cases.md](references/use-cases.md)** — 9 end-to-end scenarios (low-code builder / form designer / CMS batch / ops console / AI-native / research / server-side / multi-agent / MCP). Read when the user wants a concrete pattern for their use case.

Project-level docs (in the repo, not bundled in this skill):
- `doc/usage-guide.md` (zh) / `doc/usage-guide.en.md` — full options reference
- `examples/<demo>/` — runnable demos (page-demo, nested-demo, subagent-demo, mcp-demo, planner-demo, toolsets-demo, human-confirm-demo)
- `demo/plain.html` — framework-agnostic CDN integration
- `CLAUDE.md` — internal dev guide (architecture, conventions)

## Common pitfalls

- **DeepSeek/OpenAI 400 `missing field tool_call_id`**: `ToolMessage` must use snake_case `tool_call_id` (not camelCase). Already handled internally; only relevant if writing custom tool plumbing.
- **ChatOpenAI params**: use `apiKey` (not `openAIApiKey`), `model` (not `modelName`); `baseUrl` goes via `configuration.baseURL`.
- **MCP injects 0 tools on first cold visit**: `vite.config.ts` `optimizeDeps.include` pre-declares the SDK sub-paths; if you fork the config, keep those entries or the first MCP page load injects nothing (reload fixes it).
- **`.env` `VITE_AI_SYSTEM_PROMPT` must be single-line** (dotenv doesn't support multi-line values).
- **Server-side (Node.js)**: works with `ui:false` + `storage:'memory'` + `capabilities:{windowOps:false,fetch:false}`; `mount()`/`unmount()` guard `window`/`document` access. Provide `globalThis.window` if you enable windowOps in Node.
