# Tasks: complex-agent-roadmap(umbrella 规划框架)

> **规划框架 change,无直接代码任务**。各 Phase 立项 + 落地如下(每项是独立 change,各自含 proposal/design/tasks/specs)。
> **进度(2026-08-02 回填)**:Phase 1 三 change 均已立项 + 代码落地(mission 已归档;working-memory/schema-tiered P0 完成剩实测);Phase 2/3/4 待立项(opt-in 高级特性,合理保留)。

## Phase 1 —— 三大瓶颈(核心默认开)

- [x] 立 `revive-mission-anchor`(基于旧 proposal 调整:分层默认核心开 + Phase1 最小版 capture+pin+压缩豁免 + capture 争议接受)—— ✅ **已归档**:Phase 1 最小版落地(2.18)
- [x] 立 `revive-cross-round-working-memory`(解绑 C 组 → 独立中间件,只 pin path/hash 关键态)—— ✅ **活跃**:P0 代码+文档完成,剩真场景实测
- [x] 立 `add-schema-tiered-disclosure`(新:顶层概览注入 + 深层按需 schema_data 查)—— ✅ **活跃**:P0 代码+文档完成,剩真场景实测
- [ ] apply Phase 1 三 change(mission ✅ 完结;working-memory/schema-tiered 代码+文档完成,**剩两项实测收口**)
- [ ] 实测 Phase 1 dist 体积增量(定主包/子路径)—— 功能已随 2.18 发布进主包,「主包/子路径拆分」决策待体积压力显现再做
- [ ] 50+ skill 量级压测 + 几百 K 真实 JSON 实测(定 Phase 2 优先级)—— **依赖真 LLM/码良真实场景**,与 #57/#71 真 LLM 验证合并

## Phase 2 —— 批量生成 + 联动(高级 opt-in)

> **状态:待立项**。合理性:定位升级后「日常 JSON 100K+ / 复杂页面几百 K」确认真需求,但三项均 opt-in 高级特性,应待 Phase 1 实测验证瓶颈后再立项,避免过早投入。

- [x] 立 `add-draft-write-commit`(draft_write/commit 分块构建,vfs drafts 池就绪)—— ✅ **已实施(2.19)**:几百 K 逼近 max_tokens 真需求确认;`commitSetToBind` 抽取共享校验链(draft_commit/set_data/writeSlot 共用);`capabilities.draftWrite` 默认关 opt-in。见 `2026-08-02-add-draft-write-commit/`
- [ ] 立 `add-structured-todos-tier`(层级 parentId/deps,复用已做的 update_todo;evidence 可选)—— 合理性:复杂任务依赖链表达,但 LLM 维护依赖图可靠性存疑 → opt-in;`update_todo` 增量基础已由 adaptive-planning 落地
- [ ] 立 `add-subagent-writable`(writablePaths 前缀白名单 + path guard)—— 合理性:动「子 agent 只读隔离」安全边界,需 writablePaths 白名单增复杂度 → opt-in 谨慎;**触发:子 agent「只读+返回结论」成明确功能瓶颈**
- [ ] apply Phase 2 三 change

## Phase 3 —— 可观测(高级 opt-in)

> **状态:待立项**。合理性:定位升级后「后台自动化 agent」需性能归因/错误追溯/SLA,TraceSpan 树有真实价值;但采集有性能开销 → opt-in,调试/自动化场景开。旧 `observability-structured-tracing` 已归档(被本 Phase 取代)。

- [ ] 立 `revive-observability-tracing`(完整 TraceSpan 树 + timing/status/usage + DebugDrawer 树形 + getTraceMetrics)
- [ ] apply Phase 3

## Phase 4 —— 自动化(高级 opt-in,浏览器内后台)

> **状态:待立项(最远)**。合理性:定位升级终态「无人值守自动化」,但依赖 Phase 1-3 基础(可观测/断点/预算)先就绪;架构决策已定「浏览器内后台,不做 Node 跨环境」,零架构改动。

- [ ] 立 `add-automation-layer`(任务级断点续跑 / 资源预算 token+时间 / 批处理辅助 / 无人值守错误恢复)
- [ ] apply Phase 4

## 收口(每 Phase 后)

- [ ] 归档该 Phase changes → `openspec/changes/archive/`(Phase 1:mission ✅;working-memory/schema-tiered 待实测后归档)
- [ ] `openspec/project.md` 更新(进行中/已完成)—— 本次已回填 Phase 1 进度
- [ ] `doc/capability-boundaries.md` 联动(能力从「做不到」移「能做」)—— Phase 1 三项已联动(workingMemory/schemaHint/mission grep 命中)
- [ ] CLAUDE.md / README / usage-guide 中英同步该 Phase 能力—— Phase 1 三项已同步

> 发布触发约定:每 Phase apply 完 + 门禁全绿后,commit 停下询问是否发布,不自动 publish。
