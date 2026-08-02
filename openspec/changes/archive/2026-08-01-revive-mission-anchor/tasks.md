# Tasks: revive-mission-anchor(Phase 1)

> 关联:`proposal.md`(What/Why)+ `design.md`(How)+ `decision-record.md`(选型)。Phase 1 最小版。

## P0 — mission 中间件

- [x] `src/core/harness/mission.ts`:`createMissionMiddleware()` + Mission 状态 + `shouldCapture` 启发式
- [x] `beforeAgent`:capture 首条任务型 user(honor `send({mission})` 显式覆盖)
- [x] `augmentPrompt`:注入「## 当前主线目标」pin 段(goal + 完成标准)
- [x] `beforeAgent` 写入 `state.mission`(供其他中间件/工具读)

## P0 — 压缩豁免

- [x] `src/core/harness/summarization.ts`:`compressInput` 识别 mission 段,跳过(不进 older / 不进 indexSummarize / 独立 pin)

## P0 — SDK API + 类型

- [x] `createChatSdk.ts`:`getMission` / `setMission` / `send({mission?})` / `inspect().mission` / `capabilities.missionAnchor`(默认开)
- [x] 装载序:mission 中间件插在 todos 之前(usageHints 之后)
- [x] `types/index.d.ts`:Mission 类型 + ChatSdkOptions.mission? + SendOptions.mission? + AgentInfo.mission? + capabilities.missionAnchor?

## P0 — 测试

- [x] selftest(capture 首条任务型 / capture 保守:问候/超短/超长不 capture / pin 段注入 / 压缩豁免 / setMission 显式覆盖 / send({mission}) / capabilities 关 no-op / setMission 关闭时 warn)
- [x] e2e(inspect().mission + setMission + send mission + capabilities.missionAnchor:false 不装)

## P1 — 文档

- [x] CLAUDE.md:架构点补「Mission 任务目标锚定(Phase 1)」
- [x] CHANGELOG:[Unreleased] Added
- [x] doc/usage-guide.md(中英):mission 用法
- [x] doc/capability-boundaries.md 联动:mission 落地后「长任务跑偏」边界移「能做」

## 收口

- [x] 门禁:npm test / build / test:e2e / test:types / test:exports / test:size 全绿
- [x] 归档 + project.md 更新
- [x] 实测:几百 K 真实 JSON 长任务(码良页面),验证 mission 防跑偏效果

> 发布触发约定:apply 完 + 门禁全绿后,commit 停下询问是否发布。
