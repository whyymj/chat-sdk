# Specification Delta: page-agent-core

> revive-mission-anchor(Phase 1):Mission 任务目标锚定 + 压缩豁免。

## Requirement: Mission 任务目标锚定(Phase 1:capture + pin + 压缩豁免)

系统维护**会话级** Mission 状态(`{ goal, acceptanceCriteria?, sourceMessageIdx, capturedAt, explicit }`)。**capture 策略**:首条「任务型」user 消息启发式捕获(非空/非问候/含任务动词如「改/加/生成/设计/搭建」等,纯规则**不调 LLM**),或 `send(text, { mission })` 显式传入覆盖(`explicit:true`)。

**每轮 pin 段**:`augmentPrompt` 注入「## 当前主线目标」(goal + 完成标准)到 system prompt,**永不压缩** —— `summarization.compressInput` 豁免 mission 段(不进 older 分区、不进 indexSummarize、作独立 pin 段常驻 system,经 augmentPrompt 每轮重建)。原始任务目标不随多轮压缩稀释。

**SDK API**:`getMission()` / `setMission({ goal?, acceptanceCriteria? })`(合并更新;传 `{}` 清空)/ `send(text, { mission? })` / `inspect().mission`。`capabilities.missionAnchor`(分层默认核心,**默认开**;`false` 不装 → `getMission` 返 undefined,`setMission` warn 不抛,行为同现状)。Mission 会话级,不进 checkpoint,不跨 session 持久化。

Mission 与 `memory`(静态知识)/ `todos`(步骤)/ `adaptive-planning`(规划)正交:Mission 管「为什么做」(目标锚定),其余管「做什么/怎么做」。
