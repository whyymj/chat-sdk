# page-agent-sdk 复杂场景 + 自动化能力设计报告

> **用途**:SDK 从「轻量页面 agent」升级为「胜任复杂多组件场景 + 浏览器内后台自动化」的能力规划蓝图。整合定位升级、架构决策、6 层能力全景、分期路线图,作为未来实施与拓展的参考。
> **维护日期**:2026-08-01。与 [`capability-boundaries.md`](./capability-boundaries.md)(当前能力边界)、[`openspec/deferred.md`](../openspec/deferred.md)(暂缓清单)、各 change 的 `decision-record.md` 互补。

---

## 1. 定位升级(根基变化)

| 维度 | 旧定位 | 新定位 |
|---|---|---|
| 定位 | 轻量页面 JSON 操作 Agent | **框架无关的胜任级 Agent SDK** |
| 场景 | 嵌入网页辅助简单 JSON 操作 | 嵌入网页 + 胜任复杂多组件任务 + 浏览器内后台自动化 |
| 标尺② | 不滑向重型编排框架(轻量优先) | **能力完整优先**(推翻旧标尺) |
| 暂缓提案 | 5 个暂缓(等真需求) | **5 个全部重启授权**(定位即需求) |

**保留不变**:框架无关(对外 API)、可嵌入(对话框/无头)、纯浏览器运行(决策 1)、自研 Deep Agents 风格 harness、安全边界在 tool 层。

**直接后果**:`deferred.md` 的 5 个提案(mission-anchor / cross-round-working-memory / structured-todos / paging-draft / observability)全部重启——重启触发条件从「等真需求」变成「定位即要求」。`observability` 从缩水恢复为完整 TraceSpan 树。

---

## 2. 关键架构决策(已对齐)

### 决策 1:运行环境 = **浏览器内自动化**

后台自动化通过**无头浏览器**(puppeteer/playwright)或**页面后台常驻**实现,SDK **不跨环境、不做 Node 支持**。

| 含义 | 说明 |
|---|---|
| 架构改动 | **零**(SDK 现状即支持 headless `ui:false` + storage + send/stream) |
| 持久化 | 浏览器 Idb/WebStorage(已有);跨设备/服务端持久化由集成方走服务器 API |
| MCP transport | 浏览器侧 http/sse/websocket(不含 stdio) |
| 后台触发 | 集成方调度(定时/队列),SDK 提供单次/批量执行能力 |
| 放弃 | Node fs/数据库 backend、Node MCP stdio(若未来真需,再立跨环境提案) |

### 决策 2:能力默认 = **分层默认**

| 层级 | 策略 | 目的 |
|---|---|---|
| **核心能力** | **默认开** | 胜任复杂场景的基线(大多数复杂任务开箱即用) |
| **高级能力** | **opt-in**(capabilities 开关 / complex 预设) | 有开销(token/性能)或有安全权衡的,显式开 |

详见 §5 分层默认映射。`contextPreset: 'complex'` 从压缩预设升级为「complex 能力包聚合开关」(开核心 + 可选高级)。

---

## 3. 能力全景(6 层)

| 层 | 现状 | 胜任复杂 + 自动化所需 |
|---|---|---|
| **知识层** | skills 渐进披露 + memory 异步 RAG + load_skill + vfs doc | 50+ skill 量级压测 + 结构化组件文档 + 动态知识库切换 |
| **任务层** | adaptive-planning + subagents + todos(update_todo)+ maxPlanRevisions | structured-todos 层级(parentId/deps)+ **subagent 可写**(writablePaths) |
| **数据层** | read 分页 + write patch + query/search + eval + offload | 大 schema 分层披露 + **draft_write/commit**(分块构建几百K) |
| **上下文层** | summarization(complex 预设)+ memory + vfs 三池 | **mission-anchor**(长任务目标锚定)+ **cross-round-working-memory**(压缩保 path/hash) |
| **可观测层** 🆕 | debugLogs 扁平 + onEvent + onAudit + 三档错误 | **observability TraceSpan 树**(timing/status/usage)+ getTraceMetrics + 审计增强 |
| **自动化层** 🆕 | headless + storage + checkpoint + retry | **任务级断点续跑 / 资源预算(token/时间)/ 批处理辅助 / 无人值守错误恢复** |

---

## 4. 业务场景映射(码良:50+ 组件深嵌套)

| 业务任务 | 主用能力 | 现状 → 目标 |
|---|---|---|
| 动态生成主题页 | 规划 + 批量 write + schema + 长任务 | adaptive-planning ✓ + write patch ✓ → 补 mission(长任务)+ draft(几百K)+ schema 分层披露 |
| UI 设计页面风格 | 创意规划 + 方案确认 + 落地 | subagents 规划-反思-执行 ✓ + humanConfirm ✓(planner-demo 已演示) |
| 改组件业务/参数/样式 | 定位 + 增量 patch + 深嵌套 | query/search ✓ + write patch ✓ + isPathAllowed ✓(2.17.1 修) |
| 问答 | 知识检索 + 回答 | memory RAG ✓ + skills ✓ + read ✓ |
| 组件知识管理 | skill 索引 + 动态加载 | skills ✓ + load_skill ✓ → 50+ 量级压测 |
| **后台自动化** | 无头运行 + 长流程 + 断点续跑 | headless ✓ + storage ✓ + checkpoint ✓ → 补任务级断点/资源预算/错误恢复 |

---

## 5. 分层默认映射(决策 2 落地)

### 核心能力(默认开 = 胜任复杂基线)
| 能力 | 默认 | 理由 |
|---|---|---|
| adaptive-planning(2.18 已做) | ✅ 开 | 复杂任务规划基线 |
| **mission-anchor** | ✅ 开 | 长任务防跑偏(复杂场景刚需) |
| **cross-round-working-memory** | ✅ 开 | 几百K频繁压缩不丢中间态 |
| **大 schema 分层披露** | ✅ 开 | 50+ 组件 schema 不撑爆上下文 |
| summarization / dataOps / skills / subagent(只读)/ memory | ✅ 开 | 已有现状 |

### 高级能力(opt-in = 有开销/权衡,显式开)
| 能力 | 开关 | 理由 |
|---|---|---|
| verify(已有) | `capabilities.verify` | 烧 token |
| **draft_write/commit** | `capabilities.draftWrite` | 批量/从零生成场景;体积+复杂度 |
| **subagent 可写** | subagent `writablePaths` | 动只读安全边界;显式授权 |
| **TraceSpan 树** | `capabilities.tracing` | 采集性能开销;调试/自动化场景开 |
| **structured-todos 层级** | `capabilities.todoDeps` | 复杂依赖任务;LLM 维护依赖图可靠性 |
| **任务级自动化**(断点续跑/资源预算) | `capabilities.automation` | 后台无人值守场景 |

`contextPreset: 'complex'` = 开全部核心 + 按需开高级(集成方一行为复杂场景聚合)。

---

## 6. 分期路线图

| 期 | 能力 | 层 | 价值 | 默认 | 工作量 | 依赖 |
|---|---|---|---|---|---|---|
| **Phase 1** | mission-anchor + cross-round-working-memory + 大 schema 分层披露 | 上下文/数据 | 解决**长任务跑偏 + 压缩丢中间态 + schema 注入过大**三大瓶颈 | 核心开 | 中 | 无(三者独立) |
| **Phase 2** | data-paging draft + structured-todos 层级 + subagent 可写 | 数据/任务 | 批量/从零生成几百K + 多步联动 + 并行写 | opt-in | 中大 | draft 依赖 vfs drafts 池(2.16 就绪) |
| **Phase 3** | observability TraceSpan 树 + getTraceMetrics + 审计增强 | 可观测 | 复杂任务/自动化可追溯 + 性能归因 + APM 接口 | opt-in | 中 | 无 |
| **Phase 4** | 任务级断点续跑(checkpoint 增强)+ 资源预算(token/时间)+ 批处理辅助 + 无人值守错误恢复 | 自动化 | 浏览器内后台自动化(无头跑长流程) | opt-in | 中 | Phase 3(可观测支撑错误恢复) |
| **持续** | 50+ skill 量级压测 + 几百K真实 JSON 实测 | 验证 | 确认机制扛得住 + 定优先级 | — | 小 | 各 Phase 后 |

**体积控制**:每 Phase 实测 dist 增量。核心开的能力进主包;高级 opt-in 能力若体积大,走子路径 export `./complex` 隔离(主包不含)。Phase 1 估 ~30KB,若 <40KB 接受主包(调 size 阈值);超则子路径。

---

## 7. deferred.md 处理

5 个提案全部重启,在 `deferred.md` 标注「已重启,见本报告 + complex 能力包 change」:

| 提案 | 重启为 | 期 |
|---|---|---|
| `add-mission-anchor` | revive-mission-anchor(默认开,Phase1 最小版) | Phase 1 |
| `add-cross-round-working-memory` | revive-cross-round-working-memory(解绑 C 组,默认开) | Phase 1 |
| `add-structured-todos-and-subagent-writes` | structured-todos 层级 + subagent 可写(opt-in) | Phase 2 |
| `add-data-paging-and-chunked-write`(draft 部分) | draft_write/commit(opt-in) | Phase 2 |
| `observability-structured-tracing` | observability TraceSpan 树(恢复完整,非缩水,opt-in) | Phase 3 |

**调整**(双模态/分层默认下,archive proposal 的默认开/依赖要改):
- mission/working-memory:**默认开**(核心),非 archive 的「missionAnchor 默认 true 但可关」→ 改为分层默认核心
- working-memory:**解绑 C 组**(独立中间件,不依赖 draft/mission),只 pin path/hash 关键态
- observability:**恢复完整 TraceSpan 树**(archive 缩水版升级)
- 所有 Phase 2+ 能力:**opt-in**(高级开关)

---

## 8. 拓展性保证(未来持续扩展)

架构不需重构,按既有模式加:

| 拓展需求 | 模式 | 已有支撑 |
|---|---|---|
| 新能力 | 中间件 + capabilities 开关 | 中间件契约 + capabilities |
| 新组件库增长 | 动态 schema + 动态 skill | setData / setSkills(运行时重配) |
| 新任务类型 | 集成方 systemPrompt + SDK 能力组合 | adaptive-planning 框架 + augmentSystem 钩子 |
| 新知识源 | memory 异步 + skill doc + vfs | memory RAG + skills 渐进披露 |
| 新运行触发 | 集成方调度(定时/队列)+ SDK headless 执行 | headless ui:false + send/stream |

**架构零重构,只加不减**。每加一个能力 = 一个中间件 + 一个 capabilities 开关 + 测试,不破坏既有。

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| mission capture 启发式误判 | 分层默认核心开但保留 `setMission` 显式 + 单关;复杂场景接受 capture |
| working-memory 段占 context | 只 pin 关键(path/hash/中间结论),非全量;体积阈值 |
| 子 agent 写越界 | writablePaths 前缀白名单 + path guard;越界 PATH_OUT_OF_SCOPE |
| TraceSpan 采集性能开销 | opt-in;采样可控 |
| 体积膨胀(核心默认开) | 子路径 export 隔离高级能力;每 Phase 测体积 |
| 双模态/分层测试矩阵 | light/complex + 核心开/高级开 多组合测;selftest/e2e/browser 覆盖 |
| LLM 维护依赖图不可靠(structured-todos) | opt-in;扁平 fallback;evidence 校验可选 |
| 后台无人值守错误恢复 | 三档错误模型 + checkpoint + 任务级重试/跳过/人工介入;TraceSpan 可追溯 |

---

## 10. 落地方式(OpenSpec)

- **umbrella change `complex-agent-roadmap`**:本报告作为 proposal(定位升级 + 全景 + 分期),不直接写代码,是规划框架
- **各 Phase 能力独立 change**(基于 archive proposal 调整为分层默认):
  - Phase 1:`revive-mission-anchor` / `revive-cross-round-working-memory` / `add-schema-tiered-disclosure`
  - Phase 2:`add-draft-write-commit` / `add-structured-todos-tier`(复用 update_todo)/ `add-subagent-writable`
  - Phase 3:`revive-observability-tracing`
  - Phase 4:`add-automation-layer`
- 每个 change 含 `decision-record.md`(选型)+ proposal/design/tasks/specs,apply 后归档

---

## 11. 维护约定

- 本报告随 Phase 落地更新:能力从「所需」移到「已有」;Phase 完成 → 标版本。
- 与 `capability-boundaries.md` 联动:能力补齐后,对应边界从「做不到」移到「能做」。
- 与 `deferred.md` 联动:重启的提案标注「已重启,见本报告」。
- 新增能力需求 → 评估归入哪个 Phase 或新立项;架构决策变更 → 更新本报告 §2。
