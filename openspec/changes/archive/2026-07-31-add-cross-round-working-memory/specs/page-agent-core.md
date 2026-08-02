# Spec Delta: page-agent-core

> 本文件为 `add-cross-round-working-memory` 变更对 `openspec/specs/page-agent-core.md` 的增量。归档时合入主规范。

## Requirement: 跨轮工作记忆

系统提供 `WorkingMemory` 会话级状态,由框架自动维护(LLM 不可直接写,防伪造),每轮经 `augmentPrompt` 注入 `## 工作记忆` 段至 system prompt,**永不压缩**。`WorkingMemory` 结构为 `{ locatedPaths: string[]; lastHash?: string; draftVfsPath?: string; notes: string[]; updatedAt: number }`。

**自动提取**(`afterToolCall`):
- `read` 结果提取 `path` 写入 `locatedPaths` + `hash` 写入 `lastHash`
- `query_data`/`search_data` 匹配项 path 写入 `locatedPaths`
- `draft_write` 提取 `draftVfsPath`;`draft_commit` 清除
- `write` 成功回执 `affectedPaths` 追加 `notes`(格式「已修改 {path}」)

**容量限制**:`locatedPaths` ≤ 50 项 LRU;`notes` ≤ 20 项 LRU。

**capabilities 开关**:`capabilities.workingMemory`(默认 `true`)控制装载;设 `false` 完全关闭(零开销,行为同现状)。

**hash 跨压缩持久**:`write` 的 autoLock 优先取 `state.workingMemory?.lastHash`,fallback 进程内 `lastReadHash`;跨轮压缩后仍可校验。

## Requirement: 压缩注入活跃 vfs 索引

上下文压缩时,`summarization.compressInput` 扫描 `state.vfs` 的 `large_results/` 与 `drafts/` 文件列表,注入摘要 `【外存文件】path(size)` 段,使 LLM 跨轮可见外存索引,按需 `vfs_read`/`vfs_grep` 回读。无 vfs 文件时不注入。

## Requirement: preserveLastToolResults 默认扩展

`contextOptions.preserveLastToolResults` 默认值从 `['describe_data','read']` 扩展为 `['describe_data','read','query_data','search_data']`。`query_data`/`search_data` 的 preserve 内容为匹配项 path 列表(≤ 20 项),不含全量 value。集成方显式配置时完全覆盖默认(不合并)。

## Requirement: recallRounds 三路召回

`recallRounds` 升级为三路召回:同时基于 `state.mission?.goal` + 最新 user 消息 + `state.workingMemory?.locatedPaths`(取 top 5 关键词)做关键词召回,`dedupeByIndex` 合并去重,topK 不变(3)。确保多轮 follow-up 后既能召回与原始目标、最近子问题、已检索路径相关的早期轮次。
