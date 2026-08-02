# Change: add-mission-anchor

> 📦 **已归档(2026-08-02):被 `complex-agent-roadmap` 定位升级重启取代,落地为新 change(见下方 🔄 块)。作溯源底稿保留,不再实施。**

> ⏸ **状态:已评估暂缓(2026-08-01)**
> **结论**:暂缓(整个 change)
> **理由**:proposal 自承「任务主线是 LLM 自律问题,非框架 invariant」;自动 capture 首条 user 的启发式误判风险高;且是 4-Phase 重型演进路线,启动即承诺一条偏「重型编排框架」方向的线。
> **重启触发**:出现「LLM 频繁跑偏 / 压缩后丢主线」的真实用户反馈,且 prompt 调整无法缓解。重启只做 Phase 1 最小版。
> 决策详情见 [`openspec/deferred.md`](../../deferred.md)。原规划内容保留作底稿,下方不变。

> 🔄 **[2026-08-01 定位升级:重启 —— Phase 1]**
> SDK 定位升级为「胜任复杂 + 浏览器内自动化」(见 [`doc/complex-agent-roadmap.md`](../../../doc/complex-agent-roadmap.md)),**标尺②推翻,本 change 重启授权**。
> **调整**(基于下方旧 proposal,非直接 apply):① 默认策略改「**分层默认核心开**」(胜任基线,非旧"可关 opt-in");② capture 启发式争议在新定位下**接受**(胜任优先,保留 `setMission` 显式 + 单关);③ 本 change 只做 **Phase 1 最小版**(capture + pin 段 + 压缩豁免),不碰 recall dual-query / spawn prepend(后续 Phase)。
> 落地为新 change `revive-mission-anchor`。下方旧 ⏸ 评估保留作溯源。

---

> Phase 1 of「主线锚定」演进。配套:本变更引入 **Mission 一等公民**(会话级目标状态 + 压缩豁免 + spawn prepend),直击三种跑偏现象(忘记原始目标 / 压缩丢意图 / 子 agent 返回未收口)。后续 Phase 2(todos evidence)、Phase 3(drift 检测)、Phase 4(goal verify)为独立提案,本变更不含。

## Why

1. **任务主线是 LLM 自律问题,不是框架 invariant**。当前 SDK 有完善的「工具正确性」(schema 校验、写后读回、乐观锁)和「上下文经济性」(压缩、子 agent 隔离),但**没有任务级目标模型**——`HarnessState` 不存原始 user 指令,todos 完全由 LLM 自写可偏离,跑偏全靠 prompt 软约束。

2. **压缩会截断首条任务指令**。`useContextManager.compress()` 的 `indexSummarize` 把每条 user 截断为 60 字、assistant 80 字;多轮复杂任务触发压缩后,「为什么开始这个任务」的原始意图被稀释为模糊摘要,LLM 失去主线锚点(跑偏现象 ①③)。

3. **子 agent 不知 parent goal**。`spawn_agent` 的 `prompt` 由主 LLM 填写,框架不自动注入原始任务/验收标准;子 agent 独立 ReAct(默认 6 轮)无 parent context,返回 unstructured string,主 agent 收到后无强制 synthesis 步骤(跑偏现象 ②④)。

4. **召回锚点是「最新 user」而非「原始目标」**。`recallRounds` 基于最新 user 消息做关键词召回;多轮 follow-up 后召回偏向最近子问题,偏离主线。

5. **机制已部分就绪,缺 Mission 一等公民**。`memory` 中间件已是「每轮注入 + 跨 session 持久」,但它是静态集成方知识,非会话级任务主线;`augmentPrompt` 装载序已为中间件驱动,只需新增 `mission` 中间件即可注入 pin 段。`summarization` 的 `compressInput` / `trimMemoryMessages` 已是中间件钩子,可对 mission 段做豁免。

## What Changes

### 1. Mission 状态 + 中间件(P0,核心)

- 新增 `src/core/harness/mission.ts`:`createMissionMiddleware()` 中间件,内部维护 `Mission` 状态
- `HarnessState` 增 `mission?: Mission` 字段
- `Mission` 结构:`{ goal: string; acceptanceCriteria?: string[]; sourceMessageIdx: number; createdAt: number }`
- **capture 策略**:首条「任务型」user 消息自动 capture(启发式:非空、非纯问候、长度 > 阈值);或 `send` 时由集成方显式传入 `mission` 参数覆盖
- `augmentPrompt` 每轮注入 `## 当前主线目标\n{goal}\n完成标准:...`(**永不压缩**)
- `beforeAgent` 把 mission 写入 `state.mission`(供其他中间件/工具读取)

### 2. 压缩豁免(P0,防意图丢失)

- `summarization` 中间件 `compressInput` 钩子:跳过 mission 段(不进 older 分区,不进摘要)
- `createAgent` 的 `trimMemoryMessages`:mission 段标记为不可裁剪
- `useContextManager.compress()`:mission 作为独立 pin 段始终保留在 system,不进 older/recall 池
- `recallRounds` dual-query:同时基于 `mission.goal` + `lastUserQuery` 召回,合并去重

### 3. spawn prepend parent mission(P1,子 agent 收口)

- `subagent` 中间件:`spawn_agent` / `spawn_agents` / `use_<id>` 工具调用时,框架自动在子 agent prompt 首部 prepend `【父任务目标】{mission.goal}\n【本子任务范围】...`
- 子 agent 返回结构化 JSON(可选,向后兼容纯文本):`{ conclusion, findings?, scopeCompleted, needsParentAction? }`
- 主 agent 收到 spawn 结果后,`usageHints` 补一句规则:「spawn 返回后先 synthesis(对照主线目标)再下一步」

### 4. SDK API + 类型

- `createChatSdk`:`send(text, { mission? })` 支持显式传入 mission(覆盖自动 capture);`sdk.getMission()` / `sdk.setMission(mission)` 供 headless 集成方外部监控/注入
- `inspect().mission` 反映当前 mission 状态
- `types/index.d.ts`:`ChatSdk` 接口加 `getMission`/`setMission`;`SendOptions` 加 `mission?`
- `src/core/index.ts`:导出 `createMissionMiddleware` + `Mission` 类型(供高级集成方自定义 capture)

### 5. capabilities 开关

- `capabilities.missionAnchor`(默认 `true`):复杂任务场景默认受益;设 `false` 完全关闭(零开销,行为同现状)

## Impact

- **改造**:
  - `src/core/harness/mission.ts`(新):Mission 中间件 + capture 启发式
  - `src/core/harness/createAgent.ts`:`HarnessState` 增 `mission` 字段;`trimMemoryMessages` 跳过 mission 段
  - `src/core/harness/summarization.ts`:`compressInput` 豁免 mission pin
  - `src/core/composables/useContextManager.ts`:`compress()` mission 作为独立 pin 段;`recallRounds` dual-query
  - `src/core/harness/subagent.ts`:spawn prepend parent mission
  - `src/core/harness/usageHints.ts`:补 spawn synthesis 规则
  - `src/core/sdk/createChatSdk.ts`:`send` 支持 `mission` 参数;`sdk.getMission`/`setMission`;`inspect().mission`;`capabilities.missionAnchor`
- **新增**:`mission` 中间件;`Mission` 类型;`getMission`/`setMission` API;`capabilities.missionAnchor`
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(Mission 状态 + 压缩豁免)
- **向后兼容**:
  - 不传 mission = 自动 capture 首条任务型 user(行为近似现状,但多了 pin 段)
  - `capabilities.missionAnchor: false` = 完全关闭(零开销,行为同现状)
  - 子 agent 返回纯文本仍兼容(结构化 JSON 可选)
- **测试**:selftest 加 mission 单元断言(capture/注入/豁免/spawn prepend);e2e 加 `inspect().mission` + `setMission` + send with mission

## Non-goals

- **不做** todos 结构化改造(Phase 2,独立提案:todo evidence / 依赖 / 自动推进)
- **不做** 运行时 drift 检测(Phase 3,独立提案:drift middleware / handoff 强制)
- **不做** goal completion verify(Phase 4,独立提案:createGoalCompletionCheck)
- **不做** mission 跨 session 持久化(mission 是会话级,随 session 结束丢弃;如需持久化由集成方自行存取)
- **不做** LLM-based mission 提炼(自动 capture 用启发式规则,不调 LLM;避免每会话额外 token 开销)
- **不做** mission 编辑历史/版本(mission 一经设定,只允许整体替换;无 diff/回滚)

## 与后续 Phase 的关系

| Phase | 管什么 | 依赖 |
|---|---|---|
| Phase 1(本变更) | Mission 一等公民 + 压缩豁免 + spawn prepend | 独立,无依赖 |
| Phase 2 | todos evidence + 主线对照注入 | 弱依赖 Phase 1(读 mission) |
| Phase 3 | drift 检测 + spawn handoff 强制 | 依赖 Phase 1(mission) + Phase 2(todos) |
| Phase 4 | goal completion verify + adversarial 增强 | 依赖 Phase 1(mission) + Phase 2(todos) |

建议顺序:Phase 1 → Phase 2 → Phase 3 → Phase 4。Phase 1 可独立交付(价值最高、改动最小、零破坏)。
