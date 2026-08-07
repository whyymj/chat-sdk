# page-agent-sdk Docs

> **[English](./README.en.md)** · **[中文](./README.md)**

> **For AI agents**: read the "Agent Integration Cheat Sheet" section of the root [`../README.md`](../README.md) first (exports/options/extension points/built-in tools/file structure), then consult the table below as needed; architecture & gotchas in [`../CLAUDE.md`](../CLAUDE.md).

| Doc | Contents |
|---|---|
| [**Usage Guide**](./usage-guide.en.md) | **Start here** · Install / quick start / options / capability deep-dive / custom middleware / FAQ |
| [Architecture](./architecture.md) *(Chinese)* | Layering / assembly & mount / ReAct loop (format self-correction + verify self-correction) / window-op & optimistic lock / **conflict human-in-the-loop (state machine + abort linkage)** / context compression & persistence (6 mermaid diagrams) |
| [Context & Compression](./context-management.md) / [EN](./context-management.en.md) | Context 3-part composition / offload + 3-layer compression (per-layer principle/flow/params/boundaries) / post-compression structure / 3 flow diagrams / presets / differences from Deep Agents |
| [System Prompt Composition](./system-prompt.md) *(Chinese)* | Two-layer assembly (base identity+rules / dynamic augmentPrompt segments) / data-hint injection / middleware segment order / `augmentSystem` hook |
| [Placeholder Protected Read/Write](./placeholder-protected-rw.md) *(Chinese)* | **Planned feature design**: exact-value protection (freeze / verbatim / resource-pool lifecycle / cross-compression pin) — principle + 6 flow/sequence/state diagrams + pre-implementation review conclusions (A1-A3 architecture gaps / B1-B4 semantic locks) |

## Archived (historical reference)

> One-off selftest / audit / real-LLM reports and the completed evolution roadmap, kept in [`./archive/`](./archive/) for traceability.

| Doc | Contents |
|---|---|
| [Capability Boundaries](./archive/capability-boundaries.md) *(Chinese)* | What the SDK can/can't do for complex tasks (historical reference; most boundaries B1-B5/B7 implemented in 2.18-2.20) |
| [Complex Agent Roadmap](./archive/complex-agent-roadmap.md) *(Chinese)* | Positioning-upgrade blueprint + 6-layer capability map + phased roadmap (Phase 1-4, all completed) |
| [Evolution Roadmap](./archive/roadmap.md) *(Chinese)* | Per-item design ideas for issues #3-#21 (target versions 2.11-3.0, now outdated — decision traceability only) |
| Selftest / fix / audit reports | [`refactor-selftest.md`](./archive/refactor-selftest.md) · [`testing-fix-report.md`](./archive/testing-fix-report.md) · [`tool-design-audit-report.md`](./archive/tool-design-audit-report.md) (one-off records) |

## Other info sources (in repo)
- **Specs source of truth** (Requirements): [`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- **Change records** (proposal / design / tasks): [`../openspec/changes/archive/`](../openspec/changes/archive/)
- **Project guide / gotchas**: [`../CLAUDE.md`](../CLAUDE.md)
- **Framework-agnostic integration example**: [`../demo/plain.html`](../demo/plain.html)
- **Self-tests**: `npm test` (`../src/core/__tests__/selftest.ts`, 1159 assertions) + `npm run test:e2e` (integration e2e, 303 assertions) + `npm run test:browser` (browser E2E, 28 assertions)

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
