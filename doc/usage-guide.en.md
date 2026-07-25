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

// 1. your page state (any structure)
window.app = { title: 'Hello', theme: 'light' }

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
  systemPrompt: 'You are a page assistant. You may read/write window.app title / theme.',
  windowProps: [
    { path: 'app.title', description: 'Page title', schema: z.string() },
    { path: 'app.theme', description: 'Theme', schema: z.enum(['light', 'dark']) },
  ],
}).mount()
```

Open the page, type "change theme to dark" in the dialog → Agent calls `set_window_prop` to change `window.app.theme` directly. Done.

## 4. Core concepts

| Concept | Description |
|---|---|
| **Agent** | ReAct loop: think → call tool → observe → think again, until final reply |
| **windowProps** | You declare "which window props the Agent may read/write + value schema". Agent can only touch these (scope control) |
| **tool** | The Agent's hands. Built-in window/vfs/fetch tools + ones you add via `defineTool` |
| **middleware** | Hooks into the Agent lifecycle. Built-in todos/skills/vfs/summarization/memory/permissions/verify; also custom |
| **storage** | Persist dialog/workspace/todos/memory (IndexedDB etc.), resumable after refresh |

**Mental model**: you only handle ① declare `windowProps` (what the Agent can touch) ② write `systemPrompt` (what the Agent should do) ③ optionally add `tools`/`skills`/`middleware`. The rest is up to the Agent.

## 5. Options reference

```ts
createChatSdk({
  // basics
  container: '#root',              // mount point (selector or HTMLElement); required when ui:true
  ui: true,                        // false = headless (build UI with agent.messages + send/stream)
  id: 'my-agent',                  // stable id (multi-agent isolation + persistence resume)
  llm: { apiKey, baseUrl, model, temperature?, maxTokens? },  // or a LangChain BaseChatModel instance
  systemPrompt: '...',             // Agent identity (no hardcoded business; inject via this)

  // page data
  windowProps: [{ path, description, schema }],  // register window props + zod schema
  tools: [...],                    // custom tools (defineTool)
  skills: [...],                   // custom skills (defineSkill)
  memory: '...',                   // AGENTS.md-style persistent directives

  // capability toggles (default all on; verify default off)
  capabilities: { planning?, windowOps?, fetch?, skills?, vfs?, summarization?, memory?, subagent?, verify? },

  // human-in-the-loop
  humanConfirm: true,               // proactive inquiry (default on; AI asks when uncertain/multi-plan)
  approval: { tools: ['set_window_prop','edit_window_prop'] },  // passive confirm whitelist (default off)
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

### 6.1 window ops (let the Agent edit your page)

Declare `windowProps`; the Agent reads/writes via tools, validated by schema:

- `list_window_props` / `describe_window_prop` / `get_window_prop` / `get_window_paths`
- `set_window_prop` / `edit_window_prop` (jsonPath incremental patch) / `delete_window_prop`
- `snapshot_window_prop` / `list_window_snapshots` / `restore_window_snapshot`
- `query_window_prop` (JSONPath) / `search_window_prop` (fuzzy) / `eval_window_script` (sandboxed)

Key points:
- `set`/`edit`/`delete` are restricted to registered props (scope control); `set`/`edit` validate against schema — invalid → structured error (no write)
- `edit_window_prop` patches by `jsonPath` (set/remove/merge/append) — avoids re-sending the whole large JSON; writes in-place without replacing the root ref → Vue-reactive compatible
- Snapshots auto-stored before `set`/`edit`/`delete`; `restore_window_snapshot` rolls back
- **Zero-bridge**: tool body's `window` = host page's main window (direct)

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
A: Tool results > 6000 chars auto-offload to vfs (only preview + `vfs_read`/`vfs_grep` refs stay). `edit_window_prop` patches by jsonPath to avoid re-sending whole JSON.

**Q: `verify` not taking effect?**
A: `verify` needs `capabilities.verify:true` (default off). `inspect().verify` shows load status.

> More FAQs in the [Chinese guide §11](./usage-guide.md#11-常见问题与坑).
