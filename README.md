# page-agent-sdk

> **[English](./README.md)** · **[中文](./README.zh-CN.md)**

> Give your web page an **AI assistant that edits the page itself**. Mount a chat dialog in one line; the AI reads/writes page data safely via schema-validated tools — "conversational" building/editing/ops.

> **AI agent integration**: see [Agent Integration Cheat Sheet](#agent-integration-cheat-sheet-for-ai-agents) below (exports / options / extension points / built-in tools / file structure). Architecture & gotchas in [`CLAUDE.md`](./CLAUDE.md).

[![npm](https://img.shields.io/npm/v/page-agent-sdk.svg)](https://www.npmjs.com/package/page-agent-sdk)
[![license](https://img.shields.io/badge/license-ISC-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/self%20tests-364%20asserts-brightgreen.svg)](#self-tests)

---

## Who is it for

**Low-code / visual builders, form & page designers, CMS, ops consoles** — anywhere "page data is structured, and you want natural language to drive it".

One-line gist: **declare the page data structure (schema) to the Agent; it reads/writes via tools, validated by schema** — "editing the page" goes from drag/fill to a single sentence.

### What it is: a standardized JSON-operation Agent

At its core, it gives the AI a **standardized, safe JSON-operation channel**. AI editing JSON is no longer "generate a blob of text and stuff it back" (uncontrolled), but a structured operation under four constraints:

| Constraint | Mechanism | Effect |
|---|---|---|
| **Scope control** | Property registry (`dataSlots`) — only declared paths are writable | AI touching undeclared fields → rejected |
| **Validity check** | zod schema — `set`/`edit` validated against schema | Invalid type/enum/structure → structured error, no write |
| **Incremental op** | `edit_data_slot` patches by `jsonPath` (set/remove/merge/append) | Avoid re-sending the whole large JSON; precise local edits |
| **Rollbackable** | per-path snapshots (auto-stacked) + session checkpoint | Bad edit → one-click restore to the last good state |
| **Optimistic lock** | `expectedHash` on `set`/`edit`/`delete` + conflict human-in-the-loop | Concurrent external edits detected → suspend, user picks keep/overwrite/restore |

"Editing JSON" moves from free-form LLM text generation to **structured, validatable, auditable, rollbackable** tool operations. This is the fundamental difference from "let the AI output a JSON string directly".

## Use cases

| Scenario | User says | AI does |
|---|---|---|
| 🏗 **Low-code builder** | "Top banner → dark, bold the title, add a new-product card" | Incremental patch the component tree via jsonPath; canvas refreshes live |
| 📝 **Form designer** | "Add phone format validation, address → 3-level cascade" | Incremental field-definition edits, schema-validated |
| 📰 **CMS ops** | "Prefix these products with 'Limited', mark under ¥100 red" | JSONPath filter + sandbox script batch edit |
| 🖥 **Ops console** | "Raise A's threshold to 30%, turn off switch B" | Whitelist + human-confirm to edit config, read-back verify |
| 🤖 **AI-native assistant** | "Change this chart's legend to bars" | Conversational ops on product data, no UI needed |
| 🔬 **Research agent** | "Compare 3 solutions and recommend one" | Parallel subagents investigate each, return only conclusions |
| 🧩 **Headless / server-side** | "Run the agent in Node.js" | `ui:false` + `storage:'memory'`, drive via `sdk.send` |

> `examples/nested-demo` is a full low-code example: nested block tree + human confirm + one-click rollback.

**Full end-to-end scenarios with copy-paste code** (9 cases: low-code builder / form designer / CMS batch / ops console / AI-native / research / server-side / multi-agent / MCP) live in the bundled Agent Skill at `skills/page-agent-sdk-integrate/references/use-cases.md` (also shipped in the npm package). See [Skills for AI tools](#skills-for-ai-tools-for-integrators) below to install the skill.

## 30-second quickstart

```bash
npm install page-agent-sdk zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk } from 'page-agent-sdk'
import { z } from 'zod'

window.page = { title: 'New Products', theme: 'light' }

createChatSdk({
  container: '#chat',
  llm: { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  systemPrompt: 'You are a page-builder assistant; read/write window.page via tools.',
  dataSlots: [
    { path: 'page.title', description: 'Page title', schema: z.string() },
    { path: 'page.theme', description: 'Theme', schema: z.enum(['light', 'dark']) },
  ],
  approval: { tools: ['set_data_slot', 'edit_data_slot'] }, // confirm writes
  checkpoint: true, // one-click rollback on mistake
}).mount()
```

User says "title → 'Summer New', theme → dark" → AI calls `edit_data_slot` (incremental) → schema validation → pre-write confirm → reactive refresh. Said wrong? Click "↩ Undo".

CDN zero-config: `<script src="https://unpkg.com/page-agent-sdk"></script>` → `ChatSdk.createChatSdk({...})`.

## Capabilities

| Capability | Description | Option |
|---|---|---|
| 🛠 window ops | Read/write registered props, schema validation + incremental patch + snapshot rollback | `dataSlots` |
| 🧠 ReAct harness | Pluggable middleware (8 hooks), in-house (no LangGraph) | `middleware` |
| 📋 planning/skills/memory | `write_todos` / `define_skill` / AGENTS.md directives | `capabilities.*` |
| 🗄 virtual workspace | In-memory file system; large results offloaded (won't blow context) | `capabilities.vfs` |
| ↩️ rollback | per-path snapshots (small fixes) + session checkpoint (big fixes) | `checkpoint` |
| ✋ human confirm | Pre-write dialog + AI proactive inquiry (uncertain/multi-plan/high-risk) | `approval` |
| ✅ self-verify | Run `check` before return; on fail, feedback re-injects to self-correct | `capabilities.verify` |
| 🤖 subagents | Delegate subtasks; process stays out of main context | `subagent` |
| 🔌 MCP | Connect remote MCP servers, inject tools dynamically | `mcp` |
| 📦 context compression | 4-layer adaptive compression, presets + LLM summary | `contextPreset` |
| 🛡️ compression-safe | Live dataSlots snapshot + preserved tool results in summary; write returns hint available paths; `systemPromptHelpers.reliableWriteRules` | built-in |
| 💾 persistence | IndexedDB multi-session + quota eviction + switch | `storage` |

Capabilities default on (`verify`/`approval`/`checkpoint` default off; **proactive `humanConfirm` default on** — AI asks when uncertain/multi-plan instead of guessing). Turn off unneeded ones via `capabilities` to save tokens.

## Agent Integration Cheat Sheet (for AI agents)

> Dense integration reference for AI agents: exports / options / extension points / built-in tools / file structure. Deep dive in `doc/` and `CLAUDE.md`.

### Exports (`import { ... } from 'page-agent-sdk'`)

```ts
// entry & tool construction
createChatSdk, defineTool, defineSkill, presets, z
// harness & middleware (custom orchestration)
createAgent, createSubagentMiddleware, createSubagentsMiddleware,
createVerifyMiddleware, createWriteBackCheck, createApprovalMiddleware,
createHumanConfirmMiddleware, createHumanConfirmTool, createCheckpointMiddleware, createCheckpointManager,
createUsageHintsMiddleware, createDataSlotOps, createVfs, connectMcp
// context & model
resolveContextOptions, CONTEXT_PRESETS, resolveModelCaps, estimateTokens
// storage
createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError
// UI (reuse when headless)
ChatDialog, MessageContent, CodePreview, useChat
// types (omitted): ChatSdkOptions, Middleware, SubagentConfig, SkillSpec, DataSlotSpec, AgentMessage, StreamEvent …
```

### `createChatSdk` options cheat sheet

| Group | Option | Type / Default | Description |
|---|---|---|---|
| **Basics** | `container` | `string \| HTMLElement` | Mount point (`ui:true` required) |
| | `ui` | `boolean \| 'default'` · default `true` | `false` = headless (build UI with `agent.messages`) |
| | `llm` | `LLMConfig \| BaseChatModel` · **required** | `LLMConfig={apiKey,baseUrl?,model?,temperature?,maxTokens?}`; OpenAI-compatible (default DeepSeek) |
| | `id` | `string` | Stable id (multi-agent isolation + persistence resume; random+warn if omitted) |
| | `systemPrompt` | `string` | Agent identity (no hardcoded business; inject via this). Optional — built-in default (page assistant + `reliableWriteRules`) used if omitted; passing your own fully overrides it |
| **Page data** | `dataSlots` | `{path,description,schema}[]` | Register data slots readable/writable by tools + zod schema |
| | `tools` / `skills` / `memory` | `Tool[]` / `SkillSpec[]` / `string` | Custom tools / skills / AGENTS.md-style directives |
| **Capability toggles** | `capabilities` | `{planning?,dataSlotOps?,fetch?,skills?,vfs?,summarization?,memory?,subagent?,verify?}` | Default all on (`verify` default off); `false` to turn off |
| | `permissions` | `PermissionRule[]` | Scope whitelist (first-match-wins, default off) |
| | `humanConfirm` | `boolean` · default `true` | Proactive inquiry (AI asks when uncertain/multi-plan) |
| | `approval` | `{tools?,confirm?,timeoutMs?,humanConfirmTool?}` · default off | Passive confirm whitelist (pre-write allow/deny) |
| | `checkpoint` | `boolean \| {maxCheckpoints?,auto?}` · default off | Session-level rollback (`auto` default `true`) |
| | `verify` | `{check?,maxAttempts?,adversarial?}` | Needs `capabilities.verify:true`; `check` omitted → `createWriteBackCheck` |
| **Subagents** | `subagent` | `{allowedTools?,systemPrompt?,temperature?,llm?,maxDepth?·1,maxParallel?·4}` | Runtime ad-hoc delegation (`spawn_agent`/`spawn_agents`) |
| | `subagents` | `SubagentConfig[]` | Pre-declared named subagents → each generates `use_<id>` tool |
| **Context** | `contextPreset` | `'auto' \| 'conservative' \| 'aggressive'` · default `auto` | Compression preset |
| | `contextOptions` | `Partial<ContextManagerOptions> \| false` | Fine params (`false` disables compression). Includes `preserveLastToolResults` (default `['describe_data_slot','list_data_slots']` — keep field descriptions in compressed summary) |
| | `summaryLlm` | `BaseChatModel \| LLMConfig` | Summary-dedicated LLM (defaults to main `llm`) |
| | `maxMemoryRounds` | `number` · default `50` | Dialog history memory round cap (`0` disables trim) |
| | `vfs` | `{initialFiles?,maxBytes?}` · default 4MB | In-memory workspace cap (LRU evict on overflow) |
| **Persistence** | `storage` | `'indexed' \| 'session' \| 'local' \| 'memory' \| config \| false` · default off | Assign to enable; multi-agent isolated by `id` |
| | `session` | `{id?,autoResume?,title?}` | Session control |
| | `shareContext` | `boolean` · default `false` | Same `id` instances share one agent |
| **Robustness/other** | `maxRetries` / `maxParallelTools` / `maxToolRounds` | `number` · 2 / 1 / 10 | Model retries / per-round tool concurrency / max rounds |
| | `mcp` | `McpServerConfig[]` | Remote MCP servers (http/sse/websocket) |
| | `middleware` | `Middleware[]` | Custom middleware (appended to built-in stack) |
| | `streaming` / `title` / `placeholder` / `debug` | — | UI/debug |

### Extension points

```ts
// ① Custom tool
const myTool = defineTool({ name: 'do_x', description: '...', schema: z.object({...}), handler: (args) => 'result' })
createChatSdk({ tools: [myTool], /*...*/ })

// ② Custom skill (progressive disclosure: load_skill fetches details on demand)
const mySkill = defineSkill({ name: 'style_guide', description: 'Brand color spec', body: 'Primary #1f4d3a…' })
createChatSdk({ skills: [mySkill], /*...*/ })

// ③ Custom middleware (8 hooks: beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent/beforeReturn + augmentPrompt/compressInput/tools)
const mw: Middleware = { name: 'telemetry', afterModel: async (ctx, next) => { await next(ctx); console.log('round done') } }
createChatSdk({ middleware: [mw], /*...*/ })

// ④ Pre-declared subagents (planner-reflector-executor fixed roles)
createChatSdk({ subagents: [
  { id: 'planner', description: 'Creative planner', temperature: 0.9, systemPrompt: '…' },
  { id: 'reflector', description: 'Reflective reviewer', temperature: 0.3, systemPrompt: '…' },
], /*...*/ })
```

### Built-in tools (Agent-callable)

- **window ops** (after `dataSlots` registered): `list_data_slots` / `describe_data_slot` / `get_data_slot` / `get_slot_paths` / `set_data_slot` / `edit_data_slot` (jsonPath incremental patch) / `delete_data_slot` / `snapshot_data_slot` / `list_data_snapshots` / `restore_data_snapshot`
- **window query**: `query_data_slot` (JSONPath) / `search_data_slot` (fuzzy) / `eval_script` (sandboxed)
- **fetch**: `fetch_document`
- **vfs**: `vfs_read` / `vfs_write` / `vfs_edit` / `vfs_ls` / `vfs_glob` / `vfs_grep`
- **planning/skills**: `write_todos` / `define_skill` / `load_skill`
- **human confirm**: `request_human_confirmation` (proactive inquiry, default on)
- **subagents**: `spawn_agent` / `spawn_agents` / `use_<id>` (pre-declared)
- **checkpoint**: `restore_last_checkpoint` / `list_checkpoints`

### File structure

```
src/core/
├── sdk/createChatSdk.ts        # imperative entry (assembles harness + tools + middleware)
│   sdk/defineTool.ts  presets.ts  contextPreset.ts
├── harness/                    # in-house ReAct harness (middleware-driven)
│   createAgent.ts  middleware.ts  state.ts
│   todos.ts  skills.ts  memory.ts  summarization.ts  retry.ts
│   subagent.ts  verify.ts  approval.ts  humanConfirm.ts  checkpoint.ts
│   permissions.ts  usageHints.ts
├── tools/                      # dataSlotOps (registry + incremental edit + snapshot) / dataSlotQuery / fetchDoc
├── backends/                   # vfs (memory) / storage (IndexedDB + multi-backend + quota eviction)
├── mcp/client.ts              # remote MCP tool integration
├── composables/               # useChat / useContextManager / useMarkdown
├── components/                 # ChatDialog / MessageContent / CodePreview / DebugDrawer
└── types/index.ts  index.ts    # types / sole library entry
examples/                       # page-demo / nested-demo / dynamic-demo / human-confirm-demo / planner-demo / subagent-demo / mcp-demo / toolsets-demo
doc/                            # usage-guide / architecture / context-management / architecture-files
CLAUDE.md                       # architecture + gotchas + coding conventions (agent must-read)
```

### Extension points

```ts
// ① Custom tool
const myTool = defineTool({ name: 'do_x', description: '...', schema: z.object({...}), handler: (args) => 'result' })
createChatSdk({ tools: [myTool], /*...*/ })

// ② Custom skill (progressive disclosure: load_skill fetches details on demand)
const mySkill = defineSkill({ name: 'style_guide', description: 'Brand color spec', body: 'Primary #1f4d3a…' })
createChatSdk({ skills: [mySkill], /*...*/ })

// ③ Custom middleware (8 hooks: beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent/beforeReturn + augmentPrompt/compressInput/tools)
const mw: Middleware = { name: 'telemetry', afterModel: async (ctx, next) => { await next(ctx); console.log('round done') } }
createChatSdk({ middleware: [mw], /*...*/ })

// ④ Pre-declared subagents (planner-reflector-executor fixed roles)
createChatSdk({ subagents: [
  { id: 'planner', description: 'Creative planner', temperature: 0.9, systemPrompt: '…' },
  { id: 'reflector', description: 'Reflective reviewer', temperature: 0.3, systemPrompt: '…' },
], /*...*/ })
```

### Built-in tools (Agent-callable)

- **window ops** (after `dataSlots` registered): `list_data_slots` / `describe_data_slot` / `get_data_slot` / `get_slot_paths` / `set_data_slot` / `edit_data_slot` (jsonPath incremental patch) / `delete_data_slot` / `snapshot_data_slot` / `list_data_snapshots` / `restore_data_snapshot`
- **window query**: `query_data_slot` (JSONPath) / `search_data_slot` (fuzzy) / `eval_script` (sandboxed)
- **fetch**: `fetch_document`
- **vfs**: `vfs_read` / `vfs_write` / `vfs_edit` / `vfs_ls` / `vfs_glob` / `vfs_grep`
- **planning/skills**: `write_todos` / `define_skill` / `load_skill`
- **human confirm**: `request_human_confirmation` (proactive inquiry, default on)
- **subagents**: `spawn_agent` / `spawn_agents` / `use_<id>` (pre-declared)
- **checkpoint**: `restore_last_checkpoint` / `list_checkpoints`

### File structure

```
src/core/
├── sdk/createChatSdk.ts        # imperative entry (assembles harness + tools + middleware)
│   sdk/defineTool.ts  presets.ts  contextPreset.ts
├── harness/                    # in-house ReAct harness (middleware-driven)
│   createAgent.ts  middleware.ts  state.ts
│   todos.ts  skills.ts  memory.ts  summarization.ts  retry.ts
│   subagent.ts  verify.ts  approval.ts  humanConfirm.ts  checkpoint.ts
│   permissions.ts  usageHints.ts
├── tools/                      # dataSlotOps (registry + incremental edit + snapshot) / dataSlotQuery / fetchDoc
├── backends/                   # vfs (memory) / storage (IndexedDB + multi-backend + quota eviction)
├── mcp/client.ts              # remote MCP tool integration
├── composables/               # useChat / useContextManager / useMarkdown
├── components/                 # ChatDialog / MessageContent / CodePreview / DebugDrawer
└── types/index.ts  index.ts    # types / sole library entry
examples/                       # page-demo / nested-demo / dynamic-demo / human-confirm-demo / planner-demo / subagent-demo / mcp-demo / toolsets-demo
doc/                            # usage-guide / architecture / context-management / architecture-files
CLAUDE.md                       # architecture + gotchas + coding conventions (agent must-read)
```

## Skills for AI tools (for integrators)

A ready-to-use Agent Skill is bundled for integrators using Claude Code / Cursor (or any agent harness that loads `.claude/skills/` / `~/.claude/skills/`). It teaches the AI how to use **this SDK** in your project:

| Skill | When it triggers |
|---|---|
| `page-agent-sdk-integrate` | Embedding the SDK — choose install method, declare `dataSlots` + zod schemas, configure the LLM, mount, subscribe to events (`onEvent` / `sdk.hook`), run headless, troubleshoot common pitfalls |

**Install** (pick one):

```bash
# Option A — copy from the installed npm package
npm i page-agent-sdk
cp -R node_modules/page-agent-sdk/skills/page-agent-sdk-integrate ~/.claude/skills/

# Option B — download from the repo (no install needed)
curl -L https://github.com/whyymj/chat-sdk/tarball/master | tar xz --strip-components=1 --wildcards '*/skills/page-agent-sdk-integrate'
mv skills/page-agent-sdk-integrate ~/.claude/skills/
```

After install, restart your AI tool; the skill auto-triggers when you ask things like "add page-agent-sdk to my page".

> A second skill `page-agent-sdk-release` (release workflow for maintainers) is kept in the repo's `.claude/skills/` for project maintainers only and is **not** distributed via the npm package.

## Architecture

```mermaid
flowchart TD
    APP[Host page] -->|createChatSdk| SDK[createChatSdk<br/>assembles harness + tools + middleware]
    SDK --> CORE[AgentCore<br/>messages / vfs / store / checkpoint]
    CORE --> AGENT[createAgent<br/>ReAct loop + middleware stack]
    AGENT --> MW[Middleware stack<br/>usageHints→todos→skills→vfs→summarization<br/>→memory→permissions→checkpoint→approval<br/>→humanConfirm→verify→subagent→user]
    AGENT --> TOOLS[Tools<br/>dataSlotOps / fetchDoc / vfs / MCP / user]
    TOOLS -->|zero-bridge| WIN[Host page window<br/>read/write registered props directly]
    AGENT --> LLM[LLM<br/>OpenAI-compatible / any ChatModel]
    SDK --> UI[ChatDialog UI<br/>Vue bundled in / or headless]
```

- **Framework-agnostic**: Vue bundled in the lib (not a peer); host can be React/vanilla. Also supports `ui:false` headless — and runs in **Node.js** as a backend Agent (custom tools / subagents / verify; disable `dataSlotOps`+`fetch`, use `storage:'memory'`)
- **Provider-agnostic**: `llm` accepts any LangChain `BaseChatModel`, or `LLMConfig` (builds `ChatOpenAI` internally, OpenAI-compatible, default DeepSeek)
- **In-house harness**: no LangGraph/langchain full bundle; avoids browser bundling blockers

## Configuration

```bash
# .env (VITE_ prefix)
VITE_AI_API_KEY=sk-...
VITE_AI_BASE_URL=https://api.deepseek.com
VITE_AI_MODEL=deepseek-chat
VITE_AI_TEMPERATURE=0.3        # low temp recommended for structured ops
# VITE_AI_MAX_TOKENS=           # omit → model default
```

```ts
createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl, model },
  id: 'my-agent',              // stable id (multi-agent isolation + persistence resume)
  systemPrompt: '...',
  dataSlots: [{ path, description, schema }],
  storage: 'indexed',          // persistence (default off)
  streaming: true, ui: 'default',
  capabilities: { verify: true },        // capability toggles
  humanConfirm: true,           // proactive inquiry (default on)
  approval: { tools: ['set_data_slot','edit_data_slot'] }, // passive confirm whitelist (default off)
  checkpoint: true,
  contextPreset: 'auto',       // auto/conservative/aggressive
  summaryLlm: { ... },         // summary-dedicated LLM (defaults to main llm)
  maxRetries: 2, maxParallelTools: 1,
  subagent: { allowedTools: [...] },
  middleware: [/* custom middleware */],
  onEvent(e) {                 // SDK event callback: subscribe to common moments (data slot change / message update / tool call / error), replaces polling
    if (e.type === 'data_slot_change') refreshUI()
  },
}).mount()
```

## Examples

After `npm run dev`, visit the corresponding page:

| Example | Entry | Demonstrates |
|---|---|---|
| page-demo | `/` | Self-bootstrapping demo: left JSON reactive page + right chat |
| nested-demo | `/examples/nested-demo/` | Nested block tree + human confirm + checkpoint |
| dynamic-demo | `/examples/dynamic-demo/` | Lazy-loaded components with dynamic schemas (`sdk.addDataSlot`/`removeDataSlot`) |
| human-confirm-demo | `/examples/human-confirm-demo/` | AI proactive inquiry (multi-plan pick) + pre-write confirm |
| planner-demo | `/examples/planner-demo/` | Plan-reflect-execute (high-temp creative planner + low-temp reflector) |
| subagent-demo | `/examples/subagent-demo/` | Subagent parallel orchestration |
| mcp-demo | `/examples/mcp-demo/` | MCP remote tools (needs `npm run mcp:mock`) |

Framework-agnostic integration: `demo/plain.html` (importmap + esm.sh).

## Documentation

| Doc | Contents |
|---|---|
| [Doc Index](./doc/README.en.md) | Navigation + other info sources (specs/changes/tests) |
| [Usage Guide](./doc/usage-guide.en.md) | Install / options / capability deep-dive / custom middleware / FAQ |
| [Architecture](./doc/architecture.md) *(Chinese)* | Layering / control flow / window-op safety flow |
| [Context & Compression](./doc/context-management.md) *(Chinese)* | Context composition / 4-layer compression / flow diagrams |
| [File Overview](./doc/architecture-files.md) *(Chinese)* | Per-file responsibilities / deps / data flow |
| [CLAUDE.md](./CLAUDE.md) | **agent must-read** · architecture / gotchas / coding conventions |

## Self-tests

```bash
npm test            # 364 assertions (tsx, source-level; no LLM dependency)
npm run test:e2e    # 120 integration assertions (node, built dist; covers APIs/options/modules/simple&complex scenes: default systemPrompt(capability overview) / dynamic register + inspect sync / inspect(tools/middleware/subagent/verify/mcp/todos/lastCompression/checkpoints reflect config) / custom tools/middleware/skills/memory injection / switchSession(on/off) / shareContext on/off sharing/independent / storage backends + object config / presets(3) / checkpoint / exports complete(39+ fns/components) / util fns usable(isQuotaError/estimateTokens/jpEval/searchJson) / source=builtin / mount boundary / hook multi-listener / llm config / error scenes)
```

## Local npm package test

Verify the **published npm package** actually works (distinct from `src/` local code and `dist/*.iife.js` local build): set up a standalone vite app in an isolated directory, install `page-agent-sdk` from the npm registry, and run it.

**Scenario**: after publishing a new version, confirm the package from `npm install page-agent-sdk` imports + mounts + calls tools correctly; or reproduce an integrator's issue in a clean environment (ruling out local `node_modules` cache / stale `dist` artifacts).

**Minimal steps**:

```bash
mkdir npm-pkg-test && cd npm-pkg-test
npm init -y
npm install page-agent-sdk zod @langchain/openai @langchain/core
npm install -D vite typescript
```

`index.html` (mount point) + `main.ts`:

```ts
import { createChatSdk, z } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'

window.app = { title: 'Demo', theme: 'light' }

createChatSdk({
  container: '#root',
  llm: { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  systemPrompt: 'You are a page assistant; read/write window.app via tools.',
  dataSlots: [
    { path: 'app.title', description: 'Title', schema: z.string() },
    { path: 'app.theme', description: 'Theme', schema: z.enum(['light', 'dark']) },
  ],
}).mount()
```

`npx vite` → type "change app.theme to dark" in the dialog → AI calls `set_data_slot` → `window.app.theme` becomes `dark` → verified.

> Add this test dir to `.gitignore` (local only, not in repo) to avoid committing `.env` with real keys to remotes.

## Bundle size & tree-shaking

The package ships three builds — pick by integration scenario:

| Build | File | When to use | Approx. size |
|---|---|---|---|
| ESM (bundled, peer external) | `dist/page-agent-sdk.js` | `import` via npm or esm.sh — recommended for module hosts | ~620 KB |
| UMD | `dist/page-agent-sdk.umd.cjs` | `require()` in Node/legacy bundlers | ~560 KB |
| IIFE (all-inlined, single file) | `dist/page-agent-sdk.iife.js` | `<script src>` CDN direct include, zero config | ~1.4 MB |

`sideEffects` is set to `["**/*.css"]` only, so bundlers can tree-shake the JS when you import named symbols. Tips to keep your bundle lean:

- **Headless (`ui:false`)**: skip the built-in dialog and render `agent.messages` yourself — you can avoid importing `ChatDialog`/`CodePreview` and drop the CSS (`import 'page-agent-sdk'` without `'page-agent-sdk/style.css'`).
- **Disable unused capabilities**: `capabilities:{ dataSlotOps:false, fetch:false, planning:false, skills:false, vfs:false, summarization:false, memory:false, subagent:false }` — removes the corresponding tool schemas and middleware from the agent prompt (saves tokens, not bytes).
- **CDN via esm.sh**: `import { createChatSdk } from 'https://esm.sh/page-agent-sdk'` — peer deps (`zod`, `@langchain/*`) are resolved and deduped by esm.sh automatically; smallest for module scenarios.
- **IIFE only for zero-config**: the all-inlined single file is convenient but heaviest; prefer ESM when the host supports modules.
- **MCP is an optional peer**: `@modelcontextprotocol/sdk` is dynamically imported only when `options.mcp` is passed — omit it to avoid loading the MCP runtime entirely.

## Development

```bash
npm install
npm run dev      # port 3000 (3001 if occupied)
npm run build    # ESM + UMD + IIFE + CSS
npm test
```

## Relationship to Deep Agents

Borrows the harness idea from [Deep Agents](https://github.com/langchain-ai/deepagents) (ReAct + middleware + planning + skills + memory + context management), but implemented in-house: no LangGraph/langchain full bundle; browser-oriented (persistence via IndexedDB, not server-side DB); context via input compression + memory trim + large-result offload, rather than per-step checkpointer archival. See [Context & Compression - Differences from Deep Agents](./doc/context-management.md#七与-deep-agents-的差异).

## License

[ISC](./LICENSE)
