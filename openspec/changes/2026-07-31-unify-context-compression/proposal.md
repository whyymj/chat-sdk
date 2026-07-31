# Change: unify-context-compression

> 配套:本变更统一上下文压缩的两套独立机制 —— `summarization` 中间件(`compressInput`,上下文窗口压缩,不回写 messages)与 `trimMemoryMessages`(`afterRound`,内存 OOM 裁剪,splice 进 messages)。两者各产一种摘要格式、各有一份"防头部旧摘要丢失"的补丁逻辑,交互靠隐式约定。本变更抽出统一的 `SummarySegment` 协议 + `mergeSummarySegments` 合并纯函数作为单一 source of truth,消除重复补丁。与 `refactor-module-extraction`(抽 contextIndex 纯函数)协同:合并逻辑属同区域,建议在其后或同期。

## Why

1. **两套压缩各搞各的,格式不统一**。`summarization`(`summarization.ts`,复用 `useContextManager`)产 LLM/索引摘要,以 SystemMessage 注入(cutoff-event,不删原 messages);`trimMemoryMessages`(`rounds.ts:trimMemoryMessagesImpl`,`afterRound` 调)产 `【更早对话摘要】` system 消息(splice 进 messages)。两套摘要格式不同、触发维度不同(前者按上下文 token 窗口,后者按内存轮数),却都要处理"头部已有旧摘要"的场景。

2. **"防丢失"补丁各写一份,逻辑重复且脆弱**。`groupRounds` 跳过头部 system 消息 → 旧摘要不在任何 round 内 → 压缩时易被静默丢弃。为此:`trimMemoryMessagesImpl` 提取头部旧摘要正文并入新摘要(`rounds.ts:93-102,113-116`);`summarization` 的 `compress` 也提取头部旧摘要(双摘要协同,见 CLAUDE.md)。**同一份"合并新旧摘要"逻辑分布在两处**,改一方易漏另一方,长期累积不一致风险。

3. **摘要协议无共享契约**。`MEMORY_SUMMARY_PREFIX` 常量在 `rounds.ts`,但 `summarization` 的摘要格式不经它;两个模块对"什么是摘要段、如何合并"无统一类型契约,靠字符串前缀约定耦合。

## What Changes

### 1. 抽 `SummarySegment` 协议 + `mergeSummarySegments` 纯函数

- 新增(随 `refactor-module-extraction` 进 `composables/contextIndex.ts`,或本变更先放 `rounds.ts`):`SummarySegment` 类型(统一摘要段结构:body + meta 如轮数/时间)+ `mergeSummarySegments(prev?, current)` 纯函数(合并新旧摘要正文,保证累积历史不丢)。
- 把 `trimMemoryMessagesImpl` 的 `prevSummary` 提取 + 并入逻辑(:93-116)收敛进 `mergeSummarySegments`。
- `summarization` 的 `compress` 头部旧摘要合并逻辑同样改调 `mergeSummarySegments`。

### 2. 统一摘要段标记

- 两套产出的摘要 system 消息统一用 `MEMORY_SUMMARY_PREFIX`(`【更早对话摘要...】`)标记;`summarization` 的 LLM 摘要若作为头部累积段,也用此前缀(而非裸 SystemMessage),使 `groupRounds` / 互合并逻辑能识别。
- 单一 source of truth:`mergeSummarySegments` 是"如何合并新旧摘要"的唯一实现,两套共用。

### 3. 测试同步

- selftest:`mergeSummarySegments` 白盒(prev 为空 / prev 存在合并 / 格式标记一致);现有 `trimMemoryMessagesImpl` / summarization 压缩断言不破坏。

## Impact

- **改造**:`src/core/utils/rounds.ts`(抽 `mergeSummarySegments`,`trimMemoryMessagesImpl` 改调它)、`src/core/composables/useContextManager.ts` / `summarization.ts`(头部旧摘要合并改调共享函数)、可能动 `composables/contextIndex.ts`(若 refactor 已抽离)。
- **行为变化**:无(统一的是内部合并逻辑,产出格式与触发时机不变)。向后兼容。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(统一摘要合并协议)。
- **测试**:selftest 补 `mergeSummarySegments` 白盒;断言计数同步。

## Non-goals

- **不合并** 两套压缩为单一机制 —— 它们解决不同维度问题(上下文窗口 vs 内存 OOM),各自保留触发时机;本变更只统一"摘要段的格式与合并逻辑"。
- **不改** 压缩触发阈值 / 预设档位(auto/conservative/aggressive)—— 触发策略不变。
- **不改** LLM 摘要 vs 索引摘要的选择 —— `enableLLMSummary` / `summaryLlm` 契约不变。
- **不引入** 跨会话摘要持久化 —— 摘要仍会话级内存,刷新即失(由 storage 的 messages 持久化覆盖)。
- **不重写** `groupRounds` 的轮次分组逻辑 —— 只让它与统一摘要标记配合(头部摘要 system 不进 round 的既有行为保留)。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | 抽 `mergeSummarySegments` + `trimMemoryMessagesImpl` 改调它 | 低 | ✅ patch |
| 期二 | `summarization` 头部旧摘要合并改调共享函数 + 统一标记 | 中(压缩核心,需 e2e) | ✅ patch(叠加) |

建议在 `refactor-module-extraction`(抽 contextIndex)之后,避免同文件冲突。两期 patch(内部重构,行为不变)。
