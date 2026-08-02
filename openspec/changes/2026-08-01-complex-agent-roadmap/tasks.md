# Tasks: complex-agent-roadmap(umbrella 规划框架)

> **规划框架 change,无直接代码任务**。各 Phase 立项 + 落地如下(每项是独立 change,各自含 proposal/design/tasks/specs)。
> **进度(2026-08-02 全量回填)**:✅ **Phase 1-4 全部完成发布**(2.18-2.20)。roadmap 主体规划使命结束,后续增强走独立 change(component-library-expansion / checkpoint-incremental-snapshot / quality-hardening / p2-architecture-refactor)。本 umbrella 保留作定位升级决策记录,不再新增 Phase。

## Phase 1 —— 三大瓶颈(核心默认开)✅ 全完成

- [x] 立 `revive-mission-anchor` —— ✅ **已归档**:Phase 1 最小版落地(2.18)
- [x] 立 `revive-cross-round-working-memory` —— ✅ **已归档**:代码+文档+真场景实测(#57 验证 locatedPaths 跨任务保留)全完成
- [x] 立 `add-schema-tiered-disclosure` —— ✅ **已归档**:代码+文档+真场景实测(#57 验证 34 类型 systemPrompt 3548 chars)全完成
- [x] apply Phase 1 三 change —— ✅ 全完结
- [x] 实测 Phase 1 dist 体积增量 —— ✅ 功能随 2.18 进主包(<40KB 接受);「主包/子路径拆分」决策待体积压力显现再做(未触发)
- [x] 50+ skill 量级压测 + 几百 K 真实 JSON 实测 —— ✅ 与 #57/#71 合并完成(#57 34 类型四任务闭环 / #71 1M huge write 精准改单实例)

## Phase 2 —— 批量生成 + 联动(高级 opt-in)✅ 全完成

- [x] 立 + apply `add-draft-write-commit` —— ✅ **已归档**(2.19):commitSetToBind 抽取共享校验链;capabilities.draftWrite 默认关 opt-in;#71 真 LLM 实测通过
- [x] 立 + apply `add-structured-todos-tier` —— ✅ **已归档**(2.19):层级 parentId/deps + capabilities.todoDeps opt-in
- [x] `add-subagent-writable`(writablePaths 前缀白名单 + path guard)—— ✅ **已实施(2.19, commit 151cbf7)**,直接落地未走独立 change 文件;4 agent 审查后补 types SubagentConfig.writablePaths(2.20.1);集成测待补(见 quality-hardening 子项)

## Phase 3 —— 可观测(高级 opt-in)✅ 功能完成,文档债待归档

- [x] 立 `revive-observability-tracing`(完整 TraceSpan 树 + timing/status/usage + DebugDrawer 树形 + getTraceMetrics)
- [x] apply Phase 3 ✅(2.19 实施 + 真 LLM 实测通过:spans 72 / round:23 / model:23 / tool:25 / 工具成功率 84%)
- [ ] 归档 `revive-observability-tracing` —— ⏳ 剩 2 文档项(usage-guide tracing 用法 + capability-boundaries B7 移「能做」)已转 `quality-hardening` 文档债,补完后归档

## Phase 4 —— 自动化(高级 opt-in,浏览器内后台)✅ 全完成

- [x] 立 + apply `add-automation-layer` ✅(2.20):§1 资源预算闸(budget middleware,commit bda4e62)+ §2-4 错误恢复/断点续跑/批处理(commit 2d91b70);capabilities.automation opt-in;e2e automation.mjs 7 测
- [x] 真 LLM 验证 automation(可选)—— ⏳ 未做真 LLM 端到端(stub model 集成测待补,见 quality-hardening)

## 收口(roadmap 主体)

- [x] Phase 1 归档(mission/working-memory/schema-tiered 全归档)
- [x] Phase 2 归档(draft/todos-tier 归档;subagent-writable 直接落地)
- [ ] Phase 3 归档(observability 文档债补完后)
- [x] Phase 4 落地(automation 2.20 发布)
- [x] `openspec/project.md` 更新(进行中/已完成)
- [x] `doc/capability-boundaries.md` 联动(能力从「做不到」移「能做」)—— Phase 1-4 主能力已联动;observability B7 待 quality-hardening 补
- [x] CLAUDE.md / README / usage-guide 中英同步 —— 主能力已同步;observability/automation 详细用法待 quality-hardening 补

## 后续(roadmap 之外的独立 change,非本 umbrella)

- component-library-expansion(P2 持续):complex-demo 34→~80 类型,标尺真实度 + 分层披露量级压测
- checkpoint-incremental-snapshot(P1 perf):vfs+bind 脏标记增量快照
- quality-hardening(P1):stub model 集成测 + 小 perf + 文档债(observability/automation)
- p2-architecture-refactor(P2):createChatSdk 拆分 / createAgent 契约 / dataOps 装饰器 / capabilities 注册表 / types 漂移

> 发布触发约定:每 Phase apply 完 + 门禁全绿后,commit 停下询问是否发布,不自动 publish。
