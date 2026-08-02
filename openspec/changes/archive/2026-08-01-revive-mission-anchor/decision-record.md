# 决策记录:revive-mission-anchor(Phase 1)

> 本 change 是 `add-mission-anchor` 在定位升级后的复活。记录 Phase 1 范围取舍 + 调整点。

## 1. 重启授权(为什么现在做)

`deferred.md` 标尺②「不滑向重型」已被 2026-08-01 定位升级推翻 —— SDK 新定位「胜任复杂多组件 + 浏览器内后台自动化」**就是要胜任重型长任务**。Mission 的重启触发条件(「LLM 跑偏/压缩丢主线 真实反馈」)被用户场景满足:码良 50+ 组件、几百 K JSON、多轮长任务(生成主题页/批量改)。详见 `doc/complex-agent-roadmap.md`。

## 2. 范围选型:Phase 1 最小版(capture + pin + 压缩豁免)

| 候选范围 | 内容 | 决策 | 理由 |
|---|---|---|---|
| **Phase 1 最小版** | capture + pin 段 + 压缩豁免 + API | ✅ 选 | 直击「长任务跑偏 + 压缩丢主线」两大痛点;价值最高、改动最小、零依赖 |
| Phase 1 + recall dual-query | + 基于 mission.goal 召回早期轮 | ❌ 后续 | 增量增强,非核心痛点;recall 改造复杂,独立 Phase |
| Phase 1 + spawn prepend | + 子 agent prompt 注入父目标 | ❌ 后续 | 子 agent 收口,Phase 2 子agent 可写时一起做更合适 |
| 完整 4-Phase | + drift 检测 + goal verify | ❌ 后续 | 4-Phase 重型;单 change 只交付开头,启动即承诺长线(旧暂缓理由之一) |

**结论**:Phase 1 只做 capture + pin + 豁免。recall/spawn/drift/goal-verify 是后续 Phase,各自独立立项。

## 3. 调整点(相对旧 `add-mission-anchor` proposal)

| 维度 | 旧 proposal(2026-07-31) | 本 change 调整 |
|---|---|---|
| **默认策略** | `capabilities.missionAnchor` 默认 true(可关) | 明确为「**分层默认核心开**」(胜任基线;非"可关 opt-in"语义) |
| **capture 争议** | 旧定位否(「误判风险高,LLM 自律非框架问题」) | 新定位**接受**(胜任优先;保留 `setMission` 显式 + `capabilities.missionAnchor:false` 单关 + 启发式保守兜底) |
| **范围** | 4-Phase 路线,Phase 1 含 capture+pin+豁免+recall+spawn | **只 Phase 1 最小版**(capture+pin+豁免),recall/spawn 移后续 |
| **capture 启发式** | 同(非空/非问候/任务动词) | 沿用;补充「设计/搭建/编排」动词(覆盖码良生成主题页场景) |

## 4. 为什么 capture 启发式现在可接受

旧定位否 capture 的理由:「误判风险高 + LLM 自律不该框架管」。新定位下:
- **胜任优先 > 零误判**:复杂长任务跑偏的代价 >> 偶尔误 capture 的代价
- **多层兜底**:① 启发式保守(白名单动词,宁漏不误);② `setMission` 显式覆盖;③ `capabilities.missionAnchor:false` 完全关;④ `explicit` 标记区分自动/显式
- **可观测**:`inspect().mission` 可见当前 capture,集成方可核对

→ 误判风险被多层兜底压到可接受;收益(长任务防跑偏)在新定位下值得。

## 5. 与其他 Phase 1 能力的关系

- `revive-cross-round-working-memory`:正交(mission 管目标,working-memory 管中间态 path/hash);两者都豁免压缩,可并存
- `add-schema-tiered-disclosure`:正交(schema 披露管注入体积);三者独立,Phase 1 可并行实施

## 6. 升级路径(Phase 1 之后)

- **Phase 后续**:recall dual-query(基于 mission.goal + lastUser 双召回)+ spawn prepend(子 agent 注入父目标)
- **触发**:Phase 1 落地后,实测长任务仍现「召回偏离子问题」或「子 agent 不知父目标」时
