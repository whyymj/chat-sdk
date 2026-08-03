# page-agent-sdk Docs

> **[English](./README.en.md)** · **[中文](./README.md)**

> **For AI agents**: read the "Agent Integration Cheat Sheet" section of the root [`../README.md`](../README.md) first (exports/options/extension points/built-in tools/file structure), then consult the table below as needed; architecture & gotchas in [`../CLAUDE.md`](../CLAUDE.md).

| Doc | Contents |
|---|---|
| [**Usage Guide**](./usage-guide.en.md) | **Start here** · Install / quick start / options / capability deep-dive / custom middleware / FAQ |
| [Architecture](./architecture.md) *(Chinese)* | Layering / assembly & mount / ReAct loop (format self-correction + verify self-correction) / window-op & optimistic lock / **conflict human-in-the-loop (state machine + abort linkage)** / context compression & persistence (6 mermaid diagrams) |
| [Context & Compression](./context-management.md) / [EN](./context-management.en.md) | Context 3-part composition / offload + 3-layer compression (per-layer principle/flow/params/boundaries) / post-compression structure / 3 flow diagrams / presets / differences from Deep Agents |
| [Capability Boundaries](./capability-boundaries.md) *(Chinese)* | What the SDK can/can't do for complex tasks (B1-B7 boundaries + upgrade path + decision framework; note: most B1-B5/B7 now implemented in 2.18-2.20) |
| [Complex Agent Roadmap](./complex-agent-roadmap.md) *(Chinese)* | Positioning upgrade (complex multi-component + browser-internal automation) + 6-layer capability map + phased roadmap (Phase 1-4, all completed 2.18-2.20) + tiered-default mapping |

## Other info sources (in repo)
- **Specs source of truth** (Requirements): [`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **Change records** (proposal / design / tasks): [`../openspec/changes/archive/`](../openspec/changes/archive/)
- **Project guide / gotchas**: [`../CLAUDE.md`](../CLAUDE.md)
- **Framework-agnostic integration example**: [`../demo/plain.html`](../demo/plain.html)
- **Self-tests**: `npm test` (`../src/core/__tests__/selftest.ts`, 1097 assertions) + `npm run test:e2e` (integration e2e, 286 assertions) + `npm run test:browser` (browser E2E, 25 assertions)

## Quick start
```bash
npm run dev    # two-pane demo: left JSON reactive page + right chat (@3000, 3001 if occupied)
npm run build  # library-mode build
npm test       # core-logic self-tests
```

```ts
import { createChatSdk } from 'page-agent-sdk'
import { z } from 'zod'

createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl, model },
  systemPrompt: 'You are a JSON-ops assistant…',
  data: {
    schema: z.object({ theme: z.enum(['light','dark']).describe('Theme') }),
    bind: app,
  },
  tools: [], skills: [], memory: '',
}).mount()
```
