# Specification Delta: page-agent-core

> 本文件为 change `unify-context-compression` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 统一的对话摘要段协议与合并逻辑

上下文压缩的两套机制 —— `summarization` 中间件(按上下文 token 窗口压缩,`compressInput`,cutoff-event 不删原 messages)与 `trimMemoryMessages`(按内存轮数裁剪,`afterRound`,splice 进 messages)—— 共享统一的摘要段协议:摘要段以 `MEMORY_SUMMARY_PREFIX`(`【更早对话摘要...】`)标记,由 `SummarySegment`(`{ body, rounds? }`)描述;新旧摘要的合并经单一纯函数 `mergeSummarySegments(current, prev?)` 完成(prev 的 body 在前作"更早",current 在后作"续",累积轮数相加),配合 `parseSummarySegment` / `renderSummarySegment` 实现解析与渲染往返。该合并逻辑是唯一 source of truth,替代此前分布在 `trimMemoryMessagesImpl` 与 `useContextManager.compress` 两处的重复"防丢失"补丁;两套压缩产出统一标记的摘要段,使 `groupRounds` 能稳定识别头部摘要 system 消息(不进任何 round),累积历史不丢。两套机制的触发维度(上下文窗口 vs 内存轮数)与动作(不删 messages vs splice)保持独立,本统一仅收敛摘要段格式与合并逻辑。
