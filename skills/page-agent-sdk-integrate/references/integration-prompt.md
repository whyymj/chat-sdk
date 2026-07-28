# Integration prompt template (generic)

Copy this prompt into the target project's Cursor / Claude Code so its AI integrates `page-agent-sdk` following the workflow. Fill in `[...]` per your scenario.

> Recommended: install the skill in the target project first (`cp -R node_modules/page-agent-sdk/skills/page-agent-sdk-integrate ~/.claude/skills/`) — the AI auto-integrates per workflow. Use this prompt only when the skill can't be installed.

---

## Your task

Integrate `page-agent-sdk` (npm package) into the current project to enable "[business scenario: e.g. low-code page builder / form designer / ops config console / CMS batch ops / AI-native assistant...]". The integrator declares ONE main data object; an AI agent edits it via schema-validated tools `read`/`write` incrementally, with [UI form: built-in dialog / drawer mode / headless custom UI].

## Background

- `page-agent-sdk` is a **framework-agnostic JS SDK** (bundles Vue 3.5 internally, no conflict with host; works with Vue2/React/vanilla/Node)
- Core model: integrator declares **one main data object** `data: { schema, bind, description? }`; the agent reads/writes `bind` via tools (schema validation + whitelist + optimistic lock + snapshot)
- `bind` is any reactive/plain object; tools read/write it directly, **no `window` dependency**
- `schema` is a zod schema; field `.describe()` text is auto-injected into the systemPrompt so the LLM knows each field's purpose — no manual field descriptions needed
- Tools: `read` (read, supports jsonPath/fields/depth projection), `write` (write, merges set/edit/delete + auto optimistic lock + auto snapshot, supports patch jsonPath increments)
- Full docs: load the `page-agent-sdk-integrate` skill (if installed), or see `node_modules/page-agent-sdk/skills/page-agent-sdk-integrate/`

## Steps

### 1. Install

```bash
npm i page-agent-sdk zod @langchain/openai @langchain/core
```

### 2. Declare the main data object + schema (key step)

```ts
// dataSchema.ts
import { z } from 'page-agent-sdk'

// [Define schema per business: field names/types/shapes; field .describe() auto-injects into systemPrompt]
export const mainSchema = z.object({
  title: z.string().describe('Page title'),
  items: z.array(z.object({
    id: z.string().describe('Item id'),
    name: z.string().describe('Name'),
    // ... other fields
  })).describe('List items array'),
})

export type MainData = z.infer<typeof mainSchema>

// [Optional] skill content: business field/component docs for Agent load_skill on demand (saves systemPrompt tokens)
export const builderSkillContent = `# [Business name] Skill

Main data = { title, items[] }.

## Fields
- title: page title
- items[]: list items, each = { id, name, ... }

## Edit rules
- Add/remove items: edit items array (append/splice)
- Prefer incremental patch for single-item edits (only changed fields), avoid re-sending the whole array
- Validation failures return structured errors; fix per hint and retry
- jsonPath locates relative to main data root (e.g. items.0.name)`
```

### 3. Integrate the SDK

```ts
import { createChatSdk, defineSkill } from 'page-agent-sdk'
import 'page-agent-sdk/style.css'
import { mainSchema, builderSkillContent } from './dataSchema'

// [bind: use a reactive object (Vue3 reactive / Vue2 data() return / React useState or ref.current)]
const mainData = { title: 'Initial title', items: [] }

const sdk = createChatSdk({
  container: '#agent-root',
  id: '[stable id, e.g. page-builder]',           // multi-agent isolation + persistence namespace
  storage: 'memory',
  llm: {
    apiKey: import.meta.env.VITE_AI_API_KEY || 'YOUR_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',    // OpenAI-compatible protocol; DeepSeek by default
    model: 'deepseek-chat',
    temperature: 0.3,                          // low temp recommended for large JSON ops
  },
  // [UI form: built-in dialog (default) / drawer mode (dialog.drawer:true) / headless (ui:false)]
  dialog: {
    drawer: true,                                // drawer mode: right slide-in + mask; close defaults to hide() preserving history
    title: '[Business] Agent',
    placeholder: 'Try: [example operation]',
  },
  // systemPrompt: describe business + data structure; reliableWriteRules auto-appended with '---' separator (default true)
  systemPrompt: 'You are a [business] assistant. Main data = { title, items[] }. To edit, change title or items (add/remove/edit items, adjust fields); [page/UI] updates live. See load_skill("[skill-name]") for fields.',
  appendReliableWriteRules: true,              // default true, auto-appends reliable write rules (read-before-write, fields per describe, retry on validation error, prefer incremental patch)
  // data single main object: schema + bind directly bound to object
  data: { schema: mainSchema, bind: mainData, description: '[main data purpose]' },
  // skill: business field docs, Agent load_skill on demand
  skills: [
    defineSkill({
      name: '[skill-name]',
      description: 'Edit [business] data. Use when user requests changes',
      getContent: () => builderSkillContent,
    }),
  ],
  debug: true,
  // onEvent: for non-reactive bind or new-property cases, use data_change to trigger re-render
  onEvent(e) {
    if (e.type === 'data_change') {
      // [non-reactive bind: tick++ to force re-render; reactive bind: not needed or use for audit/联动]
    }
  },
}).mount()

// Drawer mode: call show() to open (hide() to close, preserves history & in-flight generation)
// sdk.show() / sdk.hide()
```

### 4. [Optional] Page render + refresh

```ts
// Reactive bind (Vue3 reactive / Vue2 data()): Agent write → auto-reactive, no manual refresh
// Non-reactive bind (plain object): onEvent('data_change') triggers tick, :key="tick" forces component rebuild to read latest bind
```

## Options cheat sheet

| Option | Value | Purpose |
|---|---|---|
| `drawer` | `true` | Drawer mode: right slide-in + mask; close defaults to `hide()` |
| `ui` | `false` | headless: no dialog, use `sdk.messages` + `send`/`stream` to build your own UI |
| `data` | `{ schema, bind, description? }` | Main data declaration (key); `bind` directly bound |
| `systemPrompt` | string | Business description; `reliableWriteRules` auto-appended with `---` |
| `appendReliableWriteRules` | `true` (default) | Auto-append reliable write rules; set `false` to disable |
| `skills` | `defineSkill[]` | Business field docs, Agent `load_skill` on demand |
| `storage` | `'memory'`/`'local'`/... | Persistence (messages/vfs/todos/memory; **does NOT persist bind**) |
| `llm.temperature` | `0.3` | Low temp recommended for large JSON ops |
| `onEvent` | `(e) => {}` | Event callback; `data_change` triggers re-render |
| `checkpoint` | `true` | Session-level rollback (per-round snapshot; one-click restore if broken) |
| `approval` | `{ tools: ['write'] }` | Human-confirm before write ops (prevent AI mis-edits) |
| `capabilities` | `{ dataOps:false, fetch:false, ... }` | Turn off unused built-ins to save tokens/size |

## Common pitfalls

1. **bind not persisted**: `storage` persists messages/vfs/todos/memory but **NOT bind**; to restore across refresh, store it yourself + `sdk.setData({ bind: restoredBind })`
2. **DeepSeek 400 `missing field tool_call_id`**: handled internally; only relevant for custom tool plumbing (use snake_case)
3. **`.env` `VITE_AI_SYSTEM_PROMPT` must be single-line** (dotenv doesn't support multi-line)
4. **Large JSON incremental edit**: use `write({ value:180, patch:{ op:'set', jsonPath:'items.0.price' } })` to avoid re-sending the whole blob (truncated by max_tokens)
5. **Schema whitelist**: `z.object` auto-enables whitelist (only declared fields exposed); `discriminatedUnion`/`record`/`lazy` non-top-level don't enable (fully open)
6. **Vue2 new-property non-reactive**: `write` patch `set` on a new field — Vue2 `Object.defineProperty` won't react → `onEvent('data_change')` `tick++`, use `:key="tick"` to force rebuild
7. **MCP cold-start injects 0 tools**: `vite.config.ts` `optimizeDeps.include` pre-declares SDK sub-paths; keep those entries when forking config, else first MCP page load injects nothing (reload fixes)
8. **apiKey leakage in production**: browser-direct LLM calls expose `apiKey` in DevTools. Use `createProxyLlm({ mode:'proxy', baseUrl:'/api/llm', userToken })` — browser holds only user token, your server injects the real key. See `references/quickstart.md` Stage 8 + `doc/usage-guide*.md` §8.6.

## Verification checklist

- [ ] After `npm i`, `import { createChatSdk, z } from 'page-agent-sdk'` doesn't error
- [ ] `import 'page-agent-sdk/style.css'` styles load
- [ ] Agent `read` sees main data structure; `write` patch edits sub-path fields
- [ ] [Reactive bind] edits → UI reacts; [non-reactive] `data_change` → re-render
- [ ] [Drawer mode] close then open (`show()`) → history & in-flight generation preserved
- [ ] Schema validation failure → structured error, no write
- [ ] [Production] `createProxyLlm({ mode:'proxy' })` — real apiKey not in browser bundle / network tab
- [ ] [Production] `createProxyLlm({ mode:'proxy' })` — real apiKey not in browser bundle / network tab

## References

- `node_modules/page-agent-sdk/skills/page-agent-sdk-integrate/` (integration skill, full docs)
  - `references/quickstart.md` (progressive setup), `references/options.md` (all options), `references/api.md` (API/tools/events)
  - `references/use-cases.md` (10 end-to-end scenarios: low-code/form/CMS/ops/AI-native/research/server-side/multi-agent/MCP/dynamic schema)
  - `references/advanced.md` (custom tools/skills/subagents/MCP/dynamic schema)
- `node_modules/page-agent-sdk/dist/` (build artifacts)
- Online: `https://esm.sh/page-agent-sdk@2.9.0` (CDN verify)

## Scenario customization

Per your business scenario, fill in `systemPrompt` / `skills` / `data.schema`:

- **Low-code page builder**: `data` = component tree; `write` patch jsonPath incremental; `onEvent('data_change')` refresh canvas; `checkpoint` + `approval`
- **Form designer**: `data` = field definitions (enum/required); schema validation prevents malformed forms
- **CMS batch ops**: `eval_script` loops; `search_data` filter; `write` patch targeted edits
- **Ops config console**: `approval:{tools:['write']}` human-confirm; `capabilities.verify:true` write-back read; `checkpoint`
- **AI-native assistant**: `capabilities:{dataOps:false,fetch:false}` + custom `tools` (your product API)
- **Multi-agent on one page**: same `id` + `shareContext:true` → multiple dialogs share one `AgentCore`; or independent `id`s + `dialog.drawer:true` + `hide`/`show` for exclusive switching
- **MCP integration**: `mcp:[{transport,url}]` remote tool servers; `@modelcontextprotocol/sdk` optional peerDep
- **Dynamic/lazy-loaded schema**: `sdk.setData({ schema, bind })` on component mount to swap main data; tools pick up immediately, no rebuild
- **Production proxy (prevent apiKey leakage)**: `createProxyLlm({ mode:'proxy', baseUrl:'/api/llm', userToken, refreshToken })` — browser holds only user token, server injects real key + forwards; dev uses `mode:'direct'` with real key. See `examples/proxy-demo/` + `npm run proxy:mock`
