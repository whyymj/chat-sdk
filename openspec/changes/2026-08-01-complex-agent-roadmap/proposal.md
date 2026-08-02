# Change: complex-agent-roadmap(umbrella 规划框架)

> **规划框架 change** —— SDK 定位升级为「胜任复杂多组件 + 浏览器内后台自动化的胜任级 Agent SDK」。本 change **不直接写代码**,定义架构决策 + 分期路线,各 Phase 能力由独立 change 落地。
> **详细设计报告**:[`doc/complex-agent-roadmap.md`](../../../doc/complex-agent-roadmap.md)(11 节全景:定位升级 / 决策 / 6 层 / 业务映射 / 分层默认 / 分期 / deferred 处理 / 拓展性 / 风险)。

## Why

1. **定位升级**:SDK 从「轻量页面 JSON 操作 Agent」→「**胜任级 Agent SDK**」。真实驱动:码良平台 50+ 组件深嵌套、日常 JSON 100K+ / 复杂页面几百 K、任务覆盖「生成主题页 / UI 设计 / 改组件 / 问答 / 后台自动化」。旧定位「轻量」不再成立。
2. **推翻 deferred 标尺②**:「不滑向重型编排框架」基于旧定位 —— 新定位就是要胜任重型复杂。**5 个暂缓提案全部重启授权**(定位即真需求,不再等「重启触发条件」)。
3. **架构不需重构**:中间件可插拔 + capabilities 开关 + 动态注册(setData/setSkills/setTools/setLlm/setSubagents)的拓展骨架已就绪。缺的是点能力,按 6 层全景分期补齐。

## What Changes(规划框架,非代码)

本 change 定义以下决策与路线(代码由各 Phase 独立 change 落地):

### 1. 两个架构决策(已对齐)
- **决策 1:浏览器内自动化** —— 后台自动化走无头浏览器/页面后台,**不做 Node 跨环境**(零架构改动;持久化 Idb/服务器 API)
- **决策 2:分层默认** —— 核心能力默认开(胜任基线),高级能力 opt-in(有开销/权衡)

### 2. 6 层能力全景
知识 / 任务 / 数据 / 上下文 / **可观测**🆕 / **自动化**🆕(详见设计报告 §3)

### 3. 分期路线(Phase 1-4)
| Phase | 能力(change) | 默认 |
|---|---|---|
| **1**(三大瓶颈) | revive-mission-anchor / revive-cross-round-working-memory / add-schema-tiered-disclosure | 核心开 |
| 2(批量+联动) | add-draft-write-commit / add-structured-todos-tier / add-subagent-writable | opt-in |
| 3(可观测) | revive-observability-tracing(完整 TraceSpan 树) | opt-in |
| 4(自动化) | add-automation-layer(任务级断点/资源预算/批处理/无人值守错误恢复) | opt-in |

### 4. deferred 重启映射
5 提案 → Phase 归属 + 调整点(默认策略 / 解绑 C 组 / 去重已实现部分 / observability 升级)。详见设计报告 §7 + 各 proposal 顶部 🔄 块。

### 5. 拓展性保证
未来新能力 / 新组件 / 新任务类型 / 新知识源,按「中间件 + capabilities + 动态注册」模式加,**架构零重构**。

## Impact

- **改造**:无直接代码(本 change 是规划框架)
- **新增**:本 change 文档(proposal/design/tasks)+ 引用 `doc/complex-agent-roadmap.md`
- **影响规范**:无(各 Phase change 各自改 `openspec/specs/page-agent-core.md`)
- **向后兼容**:完全兼容(分期落地;高级 opt-in 默认关;核心开能力各自 change 保证兼容)

## Non-goals

- 本 change **不写代码**(各 Phase 独立 change)
- **不做 Node 跨环境**(决策 1)
- 不定义各 Phase 具体实现(各 Phase change 的 design 负责)
- 不在本 change 改 `deferred.md` / 5 proposal 标注(已在 T1/T2 完成)
