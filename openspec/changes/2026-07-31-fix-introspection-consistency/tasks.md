# Tasks: fix-introspection-consistency

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。
> 单期 patch,改动极小(1 新增 + 1 改代理)。e2e 必跑(改了 inspect 顶层出口)。

## 期一 — 收敛 system prompt 展示出口

### 1.1 createAgent 暴露 getEffectiveSystemPrompt

- [ ] `src/core/harness/createAgent.ts:559-568` return 块新增 `getEffectiveSystemPrompt: () => buildSystemPrompt()`
- [ ] 确认 `buildSystemPrompt` 已拼 base + Σ augmentPrompt(无需改)

### 1.2 getInfo 复用单一来源

- [ ] `src/core/sdk/createChatSdk.ts:1289` systemPrompt 字段改为 `core.agent?.getEffectiveSystemPrompt?.() ?? (baseSystemPrompt + buildDataPrompt(liveData()))`
- [ ] 删除原手工拼 `+ augmentSystemMw.augmentPrompt(...)` 逻辑(已含在 `getEffectiveSystemPrompt` 内)

## 期二 — 测试同步 + 门禁

### 2.1 e2e

- [ ] `tests/e2e/inspect.mjs`(或 `systemprompt.mjs`)补:配 skills / memory / capabilities 后 `inspect().systemPrompt` 含相应段(skills 索引 / memory 持久指令 / usageHints 工具用法)
- [ ] 确认 base + data 段不丢
- [ ] 更新断言计数

### 2.2 门禁

- [ ] `npm run test:types` 全过
- [ ] `npm run build && npm run test:e2e` 全过(inspect 顶层出口,e2e 必跑)
- [ ] `npm run test:exports` 全过
- [ ] `npm run test:size` 全过

## 期三 — 收口(文档 / 归档)

- [ ] `README.md` / `README.zh-CN.md`:断言计数同步
- [ ] `CLAUDE.md`:测试矩阵 + 断言计数同步
- [ ] `CHANGELOG.md`:新增 patch 版本条目(inspect systemPrompt 完整性修复)
- [ ] `openspec/specs/page-agent-core.md`:合入 1 条 Requirement
- [ ] change 目录移入 `openspec/changes/archive/`
- [ ] `openspec/project.md`:更新「最近完成的 change」

> 发布触发约定:按 CLAUDE.md,commit 后停下询问用户是否发布,不自动 publish。
