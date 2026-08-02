# Change: revive-mission-anchor(Phase 1)

> 复活 `add-mission-anchor`(2026-08-01 定位升级重启授权,见 `complex-agent-roadmap` umbrella)。**Phase 1 最小版**:Mission 任务目标 capture + 每轮 pin 段(永不压缩)+ 压缩豁免。默认「**分层默认核心开**」。
> 旧完整 4-Phase proposal 在 [`../2026-07-31-add-mission-anchor/proposal.md`](../2026-07-31-add-mission-anchor/proposal.md);本 change 只做 Phase 1,调整点见 `decision-record.md`。

## Why

1. **长任务跑偏**:几百 K JSON 多轮操作(码良改 10+ 组件),LLM 到后半程偏离原始目标。adaptive-planning 管「步骤」,mission 管「目标锚定」—— 两者正交。
2. **压缩丢主线**:几百 K 必然频繁触发压缩,原始 user 指令被 `indexSummarize` 截 60 字稀释为模糊摘要,LLM 失去主线锚点。
3. **定位升级重启**:旧「轻量」定位下 capture 启发式「误判风险高」被否;新定位「胜任复杂」**接受 capture**(胜任优先,保留 `setMission` 显式 + `capabilities.missionAnchor:false` 单关兜底)。

## What Changes(Phase 1 最小版)

1. **Mission 状态 + 中间件**(`src/core/harness/mission.ts`):`{ goal, acceptanceCriteria?, sourceMessageIdx, capturedAt, explicit }`
2. **capture**:首条「任务型」user 启发式(非空/非问候/含任务动词,**不调 LLM**)+ `send({mission})` 显式覆盖;偏保守(宁可漏,集成方 `setMission` 兜底)
3. **augmentPrompt 每轮注入**「## 当前主线目标」pin 段(**永不压缩**)
4. **压缩豁免**:`summarization.compressInput` 跳过 mission 段;mission 作独立 pin 段常驻 system
5. **SDK API**:`getMission()` / `setMission({goal?, acceptanceCriteria?})`(合并;`{}` 清空)/ `send(text, {mission?})` / `inspect().mission`
6. **capabilities.missionAnchor**(分层默认核心,**默认开**;`false` 关)

## Impact

- **改造**:`mission.ts`(新)/ `summarization.ts`(豁免)/ `createChatSdk.ts`(API + inspect + capabilities)/ `types/index.d.ts`
- **新增**:Mission 类型 / getMission/setMission / inspect().mission / capabilities.missionAnchor / mission 中间件
- **影响规范**:ADD Requirement(Mission 任务目标锚定 + 压缩豁免)
- **向后兼容**:`capabilities.missionAnchor:false` = 不装(行为同现状);旧无 mission 的会话 `inspect().mission = undefined`;`setMission` 在关闭时 warn 不抛
- **测试**:selftest(capture/pin/豁免/setMission/显式覆盖/单关)+ e2e(inspect().mission + setMission + send mission)

## Non-goals(后续 Phase)

- **不做** recall dual-query(基于 mission.goal 召回)—— 后续 Phase
- **不做** spawn prepend parent mission —— 后续 Phase
- **不做** mission 跨 session 持久化(会话级,随 session 丢弃)
- **不做** LLM-based mission 提炼(纯启发式 capture,零 token)
- **不做** mission 编辑历史/版本(整体替换,无 diff)
