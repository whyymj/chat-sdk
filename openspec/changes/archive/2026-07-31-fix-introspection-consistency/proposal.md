# Change: fix-introspection-consistency

> 配套:本变更修复 `inspect().systemPrompt` 与实际发给 LLM 的 system prompt 不一致(漏掉 usageHints / todos / skills / memory / subagents 等中间件 `augmentPrompt` 段),并把 prompt 拼装收敛为单一来源(`createAgent` 暴露 `getEffectiveSystemPrompt()`,`getInfo` 复用)。与 `refactor-module-extraction` 的 `promptBuilder` 协同:promptBuilder 管 base 段(用户 systemPrompt + reliableWriteRules),本变更管"运行时完整 system(base + Σ 中间件 augmentPrompt)的统一出口"。正交不冲突。

## Why

1. **inspect 看到的 prompt 与真实请求不符,误导调试**。`getInfo`(`createChatSdk.ts:1289`)拼 systemPrompt 用:`baseSystemPrompt + buildDataPrompt(liveData()) + augmentSystemMw.augmentPrompt(...)`。但实际运行时 system 由 `createAgent.buildSystemPrompt()`(:213)拼接 = base + **所有中间件的 `augmentPrompt`**(dataHint / usageHints / todos / skills / vfs / memory / subagents / augmentSystem / …)。getInfo **只拼了 base + data + augmentSystem,漏掉 usageHints / todos / skills / memory / subagents 等段**。集成方 / DebugDrawer 看到的"系统提示词"残缺,排查 prompt 问题(如"LLM 为何不知道有这些 skill / 工具用法提示")时被误导。

2. **prompt 拼装逻辑分散三处,易不同步**。当前:
   - `createAgent.buildSystemPrompt()`(:213):运行时真实拼装(权威);
   - `createChatSdk` `baseSystemPrompt`(:744-749):拼用户 systemPrompt + reliableWriteRules;
   - `getInfo`(:1289):再拼一遍(且漏段)。
   三处各搞各的,任何中间件新增 `augmentPrompt` 段,getInfo 都要记得同步,漏同步 = inspect 又不一致。这是"展示口径"与"真相源"未收敛的结构性问题。

3. **CLAUDE.md 已明确该职责分工**:usageHints 按 toolMode 注入、dataHint 每轮重算、各中间件 `augmentPrompt`。这些段都是 system 的组成部分,inspect 理应完整反映,而非选择性展示。

## What Changes

### 1. createAgent 暴露 `getEffectiveSystemPrompt()`

- `createAgent.ts` 返回对象(:559-568)新增 `getEffectiveSystemPrompt(): string`,实现 = 内部 `buildSystemPrompt()`(已拼 base + Σ augmentPrompt,即实际发给 LLM 的内容)。
- 该方法读当前 `state`(非运行时为 `createInitialState`,展示"将注入哪些段"足够)。

### 2. getInfo 复用单一来源

- `createChatSdk.ts:1289` systemPrompt 字段改为 `core.agent?.getEffectiveSystemPrompt?.() ?? baseSystemPrompt`(agent 未构造时回退旧拼接,headless 早期 / inspect 早调场景兜底)。
- 删除 getInfo 里手工拼 `baseSystemPrompt + buildDataPrompt + augmentSystemMw.augmentPrompt` 的逻辑(收敛到 createAgent 出口)。

### 3. 测试同步(e2e)

- `tests/e2e/inspect.mjs`(或 `systemprompt.mjs`)补:配 skills / memory / 各 capabilities 后,`inspect().systemPrompt` 含相应段(skills 索引段 / 持久指令段 / 工具用法提示段)——修复前这些段缺失,修复后存在。
- 断言 inspect 与实际等价。

## Impact

- **改造**:
  - `src/core/harness/createAgent.ts`:return 块加 `getEffectiveSystemPrompt`(1 行,复用内部 `buildSystemPrompt`)。
  - `src/core/sdk/createChatSdk.ts:1289`:systemPrompt 改为代理到 createAgent 出口。
  - `types/index.d.ts`:`AgentInfo.systemPrompt` 类型不变(string),无需改。
- **行为变化**:`inspect().systemPrompt` 内容变完整(多出 usageHints / todos / skills / memory / subagents 段)。这是**展示一致性修复**,不影响 LLM 实际收到的 prompt(那个本来就对)。向后完全兼容。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(inspect 反映完整运行时 system prompt)。
- **测试**:e2e 补 inspect systemPrompt 完整性断言;selftest 无需新增(`buildSystemPrompt` 是 createAgent 内部,经 e2e 覆盖)。断言计数同步。

## Non-goals

- **不改** `buildSystemPrompt()` 的拼装顺序与各段内容 —— 本变更只把"已正确拼装的结果"导出,不改拼装逻辑本身。
- **不拆** promptBuilder 的职责(留给 `refactor-module-extraction`)—— 本变更只收敛"运行时完整 system 的展示出口"。
- **不改** base systemPrompt 的拼装(createChatSdk 的 `baseSystemPrompt` 仍是 promptBuilder 的职责)—— `getEffectiveSystemPrompt` 内部用的就是 createAgent 的 systemPrompt(base)。
- **不缓存** system prompt(每轮随 state 变)—— `getEffectiveSystemPrompt` 每次调都重新拼,反映当前态。
- **不改** DebugDrawer 的渲染逻辑 —— 它经 getInfo 读 systemPrompt,自动受益。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | createAgent 暴露 `getEffectiveSystemPrompt` + getInfo 复用 | 极低(展示口径) | ✅ patch |

单期,patch。改动极小(1 新增 + 1 改代理),收益明确(调试不再被误导)。
