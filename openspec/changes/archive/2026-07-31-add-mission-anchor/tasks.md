# Tasks: add-mission-anchor

> 顺序:期一(Mission 中间件 + capture)→ 期二(压缩豁免 + recall dual-query)→ 期三(spawn prepend)→ 期四(SDK API + 类型 + capabilities)→ 期五(测试同步)→ 期六(文档 + 门禁 + 归档)。
> 全程向后兼容:`capabilities.missionAnchor: false` = 完全关闭(零开销,行为同现状)。期一可独立交付(价值最高)。

## 期一 — Mission 中间件 + capture(P0,核心)

- [ ] 新增 `src/core/harness/mission.ts`:`createMissionMiddleware()` 中间件
  - `Mission` 接口:`{ goal: string; acceptanceCriteria?: string[]; sourceMessageIdx: number; capturedAt: number; explicit: boolean }`
  - 内部 `let mission: Mission | undefined`
  - `beforeAgent`:若 mission 为空且 `state.messages` 有未处理 user,按 `shouldCapture` 启发式自动 capture;写入 `state.mission`
  - `augmentPrompt`:注入 `## 当前主线目标` pin 段(goal + 可选 criteria + 「偏离时回到主线」提示)
  - 暴露 controller:`get()` / `set(partial)` / `clear()`(不可枚举挂载,类比 SkillsController)
- [ ] `src/core/harness/createAgent.ts`:`HarnessState` 增 `mission?: Mission` 字段(state 初始化 + 类型)
- [ ] `src/core/harness/createAgent.ts`:`buildSystemPrompt` 已是中间件驱动,mission 中间件 `augmentPrompt` 自动注入(验证装载序正确)
- [ ] 门禁:`npm run test:types` + `npm test` 全过(无新断言,只验证不破坏)

## 期二 — 压缩豁免 + recall dual-query(P0,防意图丢失)

- [ ] `src/core/harness/summarization.ts`:`compressInput` 钩子识别 mission 段;compress 时 mission 不进 `older` 分区、不进 `indexSummarize`;mission 作为独立 pin 段始终保留(经 `augmentPrompt` 每轮重建)
- [ ] `src/core/harness/createAgent.ts`:`trimMemoryMessages` 跳过 mission 段(mission 在 system 经 augmentPrompt 重建,不在 messages 数组,自然豁免;验证)
- [ ] `src/core/composables/useContextManager.ts`:`recallRounds` 改 dual-query —— 同时基于 `state.mission?.goal` + `lastUserQuery` 召回,`dedupeByIndex` 合并去重,topK 不变
- [ ] 门禁:`npm run test:types` + `npm test` 全过

## 期三 — spawn prepend parent mission(P1,子 agent 收口)

- [ ] `src/core/harness/subagent.ts`:`wrapToolCall` 钩子拦截 `spawn_agent` / `spawn_agents` / `use_<id>`;若 `state.mission` 存在,在 `args.prompt` 首部 prepend `【父任务目标】{goal}\n【完成标准】...\n【本子任务范围】{原 prompt}`
- [ ] `src/core/harness/usageHints.ts`:补一句规则「spawn 返回后先 synthesis(对照主线目标)再下一步」
- [ ] 子 agent 结构化返回(可选,向后兼容):返回若为合法 JSON 含 `conclusion` 字段,框架解析为结构化;否则按纯文本(不破坏现有 spawn 返回契约)
- [ ] 门禁:`npm run test:types` + `npm test` 全过

## 期四 — SDK API + 类型 + capabilities(P1)

- [ ] `src/core/sdk/createChatSdk.ts`:
  - `capabilities.missionAnchor`(默认 `true`):`false` 时不装载 mission 中间件,`getMission` 返回 undefined,`setMission` warn 不抛错
  - mission 中间件装载序:usageHints 之后、todos 之前
  - `send(text, options?)`:`options.mission` 显式 setMission(覆盖自动 capture)
  - `sdk.getMission()` / `sdk.setMission(partial)` / `inspect().mission`
  - `setMission` 后 `infoTick++` 触发刷新
- [ ] `types/index.d.ts`:`ChatSdk` 接口加 `getMission`/`setMission`;`SendOptions` 加 `mission?`;`AgentInfo` 加 `mission?`;导出 `Mission` 类型
- [ ] `src/core/index.ts`:导出 `createMissionMiddleware` + `Mission` 类型(供高级集成方自定义 capture)
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`(inspect.mjs mission 反映)

## 期五 — 测试同步(强制)

- [ ] selftest(新模块 sec-30 或加 sec-19/29):
  - mission capture 启发式:含白名单动词 capture;纯问候/太短/超长不 capture
  - `augmentPrompt` 注入 pin 段:goal + criteria + 提示
  - `setMission` 替换/清空;`getMission` 反映
  - `compressInput` 豁免:mission 段不进 older/summary
  - `recallRounds` dual-query:goal + lastUser 双召回去重
  - spawn prepend:wrapToolCall 注入 parent goal block
  - `capabilities.missionAnchor: false`:中间件不装载,getMission undefined
  - runner 注册 + 断言计数同步
- [ ] e2e(`tests/e2e/inspect.mjs` 或新模块):
  - `inspect().mission` 反映自动 capture
  - `sdk.setMission({ goal })` 后 inspect 反映
  - `send(text, { mission: { goal: '...' } })` 显式覆盖
  - `capabilities.missionAnchor: false` 时 inspect().mission undefined
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过

## 期六 — 文档 + 门禁 + 归档

- [ ] `CLAUDE.md`:架构要点新增「Mission 锚定」小节;测试矩阵/计数同步
- [ ] `doc/architecture.md`:新增「主线锚定层」设计说明
- [ ] `doc/usage-guide.md`:新增 §6.x「Mission 主线锚定」(自动 capture / setMission / capabilities.missionAnchor / spawn prepend)
- [ ] `README.md` / `README.zh-CN.md`:特性列表加「Mission 主线锚定」;便捷 API 表加 `getMission`/`setMission`
- [ ] `skills/page-agent-sdk-integrate/references/api.md`:加 `getMission`/`setMission` 行
- [ ] `skills/page-agent-sdk-integrate/references/advanced.md`:加「Mission 主线锚定」示例
- [ ] `CHANGELOG.md`:新增 `[Unreleased]` 条目
- [ ] 门禁全跑:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports` → `npm run test:types` → `npm run test:size` → `npm pack --dry-run`
- [ ] openspec 归档:`openspec/changes/2026-07-31-add-mission-anchor/` → `archive/`;`openspec/specs/page-agent-core.md` 合入增量 Requirement
