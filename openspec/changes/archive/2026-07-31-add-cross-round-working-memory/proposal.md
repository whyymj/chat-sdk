# Change: add-cross-round-working-memory

> 📦 **已归档(2026-08-02):被 `complex-agent-roadmap` 定位升级重启取代,落地为新 change(见下方 🔄 块)。作溯源底稿保留,不再实施。**

> ⏸ **状态:已评估暂缓(2026-08-01)**
> **结论**:暂缓 —— 先用低成本软改进(扩 `preserveLastToolResults` 默认到含 query/search)替代
> **理由**:绑定 C 组(依赖未实现的 `draft_write` + 暂缓的 mission dual-query),单独做是半成品;「永不压缩的工作记忆段」是另一种 context 占用,可能抵消压缩经济性。
> **重启触发**:扩 preserve 默认后,复杂任务下「压缩丢 path/hash」仍成瓶颈。
> 决策详情与缩水替代见 [`openspec/deferred.md`](../../deferred.md)。原规划内容保留作底稿,下方不变。

> 🔄 **[2026-08-01 定位升级:重启 —— Phase 1]**
> 定位升级(见 [`doc/complex-agent-roadmap.md`](../../../doc/complex-agent-roadmap.md)),标尺②推翻,本 change 重启授权。
> **调整**:① **解绑 C 组** —— 不依赖 `draft_write`(未实现)/ mission dual-query(独立推进),做成**独立中间件**;② 只 pin 关键态(path/hash/中间结论),非全量 locatedPaths+notes(控 context 占用);③ 默认「分层默认核心开」;④ 「扩 preserve 默认」软改进已由 complex 预设部分覆盖(query/search),作补充而非替代。
> 落地为新 change `revive-cross-round-working-memory`。下方旧 ⏸ 评估保留作溯源。

---

> 记忆平面改进(Phase 1 of「复杂任务 + 超大 JSON」演进)。直击 P0:跨轮压缩丢失工具链路中间态(path/hash/中间结论)。配套:`add-mission-anchor`(主线锚定,管「目标」)、`add-data-paging-and-chunked-write`(数据平面)、`add-structured-todos-and-subagent-writes`(编排平面)。本变更与 `add-mission-anchor` 互补:mission 管「为什么做」,working memory 管「做到了什么」。

## Why

1. **跨轮 messages 只保留 user/assistant 文本**。10+ 步检索-写入流程中,中间 `read`/`query` 的 tool 结果**不跨轮保留**;压缩后 path/hash 易丢,导致多步检索链断裂,LLM 重复检索浪费 token。

2. **召回锚点是「最新 user」而非「原始目标 + 中间结论」**。`recallRounds` 基于最新 user 消息做关键词召回;多轮 follow-up 后召回偏向最近子问题,偏离主线 + 丢失早期已定位的 path。

3. **preserve 默认仅 describe_data/read**。`preserveLastToolResults` 默认 `['describe_data','read']`,query/search/eval 结果不 preserve,多步检索链路易断。

4. **压缩不注入活跃 vfs 索引**。大结果外存 vfs 后,压缩时摘要不引用「详情在 vfs path X」,LLM 跨轮不知有外存可用。

5. **hash 状态不持久跨压缩**。autoLock 依赖 `lastReadHash`(进程内);跨轮若未 read 就 write,或摘要丢 hash 提示,易 VERSION_CONFLICT。

## What Changes

### 1. 跨轮工作记忆槽(P0)

- `HarnessState` 增 `workingMemory?: WorkingMemory` 字段
- `WorkingMemory` 结构:`{ locatedPaths: string[]; lastHash?: string; draftVfsPath?: string; notes: string[] }`
- 新增 `createWorkingMemoryMiddleware()` 中间件:
  - `afterToolCall`:自动从 `read`/`query_data`/`search_data` 结果提取 path 写入 `locatedPaths`;从 `read` 结果提取 hash 写入 `lastHash`;从 `draft_write` 提取 draftId 写入 `draftVfsPath`
  - `augmentPrompt`:每轮注入 `## 工作记忆` 段(locatedPaths + lastHash + draftVfsPath + notes),**永不压缩**
  - `compressInput`:workingMemory 段豁免(不进 older/summary)

### 2. 扩展 preserveLastToolResults 默认(P0)

- 默认值从 `['describe_data','read']` 扩展为 `['describe_data','read','query_data','search_data']`
- 集成方可显式配置 `contextOptions.preserveLastToolResults` 覆盖
- preserve 保留的是工具 result 的**摘要片段**(path + 关键字段),非全量

### 3. 压缩注入活跃 vfs 索引(P1)

- `summarization.compressInput`:压缩时扫描 `state.vfs` 的 `large_results/` + `drafts/` 文件列表,注入摘要 `【外存文件】path1(size), path2(size)...`
- LLM 跨轮可见外存索引,按需 `vfs_read`/`vfs_grep` 回读

### 4. recallRounds 三路召回(P1)

- 在 `add-mission-anchor` 的 dual-query 基础上扩展为三路:`mission.goal` + `lastUserQuery` + `workingMemory.locatedPaths`(取 top 关键词)
- 合并去重,topK 不变(3)

### 5. hash 跨压缩持久(P1)

- `workingMemory.lastHash` 在 `read` 后自动更新;压缩不丢
- `write` 时 autoLock 优先取 `workingMemory.lastHash`(而非进程内 lastReadHash 变量)
- 跨轮未 read 就 write:若 `workingMemory.lastHash` 存在则用它;否则 fallback 现状(不校验)

## Impact

- **改造**:
  - `src/core/harness/workingMemory.ts`(新):工作记忆中间件 + afterToolCall 提取
  - `src/core/harness/createAgent.ts`:`HarnessState` 增 `workingMemory` 字段
  - `src/core/harness/summarization.ts`:`compressInput` 豁免 workingMemory 段 + 注入 vfs 索引
  - `src/core/composables/useContextManager.ts`:`recallRounds` 三路召回;`preserveLastToolResults` 默认扩展
  - `src/core/tools/dataOps.ts`:autoLock 优先取 `state.workingMemory?.lastHash`
- **新增**:`workingMemory` 中间件;`WorkingMemory` 类型
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(工作记忆 / vfs 索引注入)
- **向后兼容**:
  - `workingMemory` 中间件默认装载;`capabilities.workingMemory: false` 关闭(零开销)
  - preserve 默认扩展是**软变更**(多保留 query/search 摘要,不破坏行为)
  - autoLock 优先取 workingMemory.lastHash 是**增强**(更多场景能校验,不破坏现状)
- **测试**:selftest 加 workingMemory 断言(extract/注入/豁免/三路召回/hash 持久);e2e 加 inspect().workingMemory

## Non-goals

- **不做** 工作记忆的 LLM 提炼(纯规则提取 path/hash,不调 LLM)
- **不做** 工作记忆跨 session 持久化(会话级,随 session 结束丢弃)
- **不做** 工作记忆手动编辑 API(框架自动维护,不暴露 setWorkingMemory)
- **不做** notes 的语义化结构(notes 是自由文本数组,由 LLM 自行写入)
