# Spec Delta: page-agent-core

> 本文件为 `add-mission-anchor` 变更对 `openspec/specs/page-agent-core.md` 的增量。归档时合入主规范。

## Requirement: 任务主线 Mission 锚定

系统提供 `Mission` 一等公民作为会话级目标状态,每轮经 `augmentPrompt` 注入 `## 当前主线目标` pin 段至 system prompt,确保多轮复杂任务中 LLM 始终可见原始目标。`Mission` 结构为 `{ goal: string; acceptanceCriteria?: string[]; sourceMessageIdx: number; capturedAt: number; explicit: boolean }`。

**自动 capture**:首条「任务型」user 消息经启发式规则(含白名单动词、长度 8~2000、非纯问候)自动 capture 为 mission,`explicit: false` 标记;capture 不调 LLM,零额外 token 开销。

**显式 setMission**:集成方可经 `sdk.setMission(partial)` 或 `send(text, { mission })` 显式指定/覆盖,`explicit: true`。

**capabilities 开关**:`capabilities.missionAnchor`(默认 `true`)控制是否装载 mission 中间件;设 `false` 完全关闭(`getMission` 返回 undefined,`setMission` warn 不抛错),行为同现状。

## Requirement: Mission 段压缩豁免

上下文压缩(`summarization.compressInput`)与单轮 trim(`trimMemoryMessages`)对 Mission pin 段做豁免:mission 段不进 `older` 分区、不进 `indexSummarize` 摘要、不进 trim 裁剪;mission 作为独立 pin 段始终保留在 system(经 `augmentPrompt` 每轮重建)。

`recallRounds` 改 dual-query:同时基于 `state.mission.goal` 与最新 user 消息做关键词召回,`dedupeByIndex` 合并去重,topK 不变,确保多轮 follow-up 后既能召回与最近子问题相关、也能召回与原始目标相关的早期轮次。

## Requirement: 子 agent 继承父任务目标

`spawn_agent` / `spawn_agents` / `use_<id>` 工具调用时,若 `state.mission` 存在,框架自动在子 agent `prompt` 首部 prepend `【父任务目标】{goal}\n【完成标准】...\n【本子任务范围】{原 prompt}`,使子 agent 首轮即知 parent goal,避免越钻越深偏离主线。

子 agent 返回支持结构化 JSON(含 `conclusion` 字段,向后兼容纯文本);主 agent 收到 spawn 结果后应先 synthesis(对照主线目标)再下一步。
