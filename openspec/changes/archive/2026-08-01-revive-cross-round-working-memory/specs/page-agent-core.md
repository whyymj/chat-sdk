# Specification Delta: page-agent-core

> revive-cross-round-working-memory(Phase 1):跨压缩工作记忆(path/hash)。

## Requirement: 跨压缩工作记忆(Phase 1:path/hash pin)

系统维护**会话级** `WorkingMemory`(`{ locatedPaths: string[](≤10 LRU), lastHashes: Record<path, string>(≤10 LRU) }`),跨上下文压缩保留关键定位态。**自动捕获**:`wrapToolCall`/`afterToolCall` 从 `read`/`query`/`search` 工具结果提取 path(→ `locatedPaths`,LRU 去重 ≤10)与 hash(→ `lastHashes[path]`,LRU ≤10),纯结构化不调 LLM;其他工具不捕获。

**压缩豁免**:`summarization.compressInput` 豁免 workingMemory 段(不进 older 分区、不进 indexSummarize、作独立 pin 段常驻 system,经 `augmentPrompt` 每轮重建)。跨压缩后 LLM 仍可见最近定位 path + hash → 不重复检索(token 节省)+ 写时用对 hash(减少乐观锁误冲突)。

**augmentPrompt 注入**「## 工作记忆(跨压缩保留)」段(最近定位 path + hash)。`capabilities.workingMemory`(分层默认核心,**默认开**;`false` 不装 → 行同现状)。`inspect().workingMemory` 反映当前 pin。

workingMemory 与 `preserveLastToolResults`**互补**(preserve 保工具结果摘要,workingMemory 保 path/hash 结构化);与 `mission`(目标)/ `summarization`(压缩)正交。会话级,不进 checkpoint,不跨 session 持久化。**不做** notes 自由文本(控 context;后续 Phase)。
