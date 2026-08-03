# page-agent-sdk 项目

## 概述
`page-agent-sdk` 是一个**框架无关的 JS SDK**,以对话框形态挂载到任意网页,内置一个基于 ReAct 模式的 Tool-Calling Agent。Agent 通过自定义 tool 读写集成方声明的 `data.bind` 单主对象(基于 **schema 校验 + jsonPath 增量 patch + 乐观锁 + 快照回退**;集成方按需自己挂 window,SDK 不再自动挂)、GET 抓取文档,并具备 planning / skills / 内存工作区 / context 管理能力。

本项目由 `zhuanti-agent`(Vue3 库模式、深度绑定"什么值得买专题"业务)重构而来,目标是剥离业务身份、补齐"操作所在页面"能力,并自研一套架构对齐 Deep Agents 的轻量 harness。

## 设计原则
- **纯浏览器运行**:无 Node 文件系统依赖;不引入 `langchain` 整包 / LangGraph(规避 [deepagentsjs#292](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。
- **架构对齐 Deep Agents**:ReAct 循环 + 可插拔中间件 + 内存 backend,自研实现;仅依赖浏览器可用的 `@langchain/openai` + `@langchain/core`。
- **框架无关**:对外暴露命令式 API(`createChatSdk`),内部 Vue 打包进 SDK,使用者无需安装/了解 Vue。
- **安全边界在 tool 层**:数据槽操作经属性注册表 + schema 校验(无人工审批,但强约束范围与格式)。

## 技术栈
- Vue 3.5(**打包进 SDK**,非 peer)、Vite 8 库模式、TypeScript
- LangChain 浏览器子包:`@langchain/openai` + `@langchain/core`(external + peerDep)
- `marked` + `highlight.js`(打包进 SDK)
- `zod`(schema 校验,external + peerDep)

## OpenSpec 工作流
1. **提 change**:在 `openspec/changes/<id>/` 下写 `proposal.md`(Why/What/Impact)、`design.md`(技术决策)、`tasks.md`(实施清单)、`specs/<capability>.md`(增量 requirement)。
2. **实施**:按 `tasks.md` 勾选推进;实现须满足 `specs/` 的 requirement。
3. **归档**:实现完成后将 `specs/` 增量合入 `openspec/specs/`(系统真相源),change 移入 `openspec/changes/archive/`。

## 进行中的 change

> 2026-08-03 状态:P1(checkpoint + quality-hardening)+ P2(component-library)全部归档。**当前无活跃 change**(openspec `changes/` 清空,全部在 `archive/`)。

**推进顺序建议**(2026-08-03 更新):全部活跃 change 归档完成。后续按需新提 change(P1 清空;component-library 范围缩减到 3 个完成)。~~p2-refactor(最后,功能稳定后动结构)~~ → 已部分归档(③④⑤ 完成;① createChatSdk 拆分 / ② createAgent 契约拆 deferred,等痛点驱动)。umbrella 定位升级决策记录见 [`doc/complex-agent-roadmap.md`](../doc/complex-agent-roadmap.md)(已归档)。

## 已评估暂缓 → 已重启并全部落地(2026-08-01 定位升级 → 2026-08-02 完成)

> 经 2026-08-01 评估,以下 5 个 change 曾「暂缓 / 缩水 / 拆分」(决策见 [`deferred.md`](./deferred.md))。**`complex-agent-roadmap` 定位升级后标尺②推翻,5 个全部重启授权**,落地情况(2026-08-02 全完成):
>
> | 旧 change | 重启落地 |
> |---|---|
> | `add-mission-anchor` | ✅ `revive-mission-anchor`(已归档,Phase 1,2.18 发布) |
> | `add-cross-round-working-memory` | ✅ `revive-cross-round-working-memory`(已归档,Phase 1,2.18 发布;#57 验证 locatedPaths 跨任务保留) |
> | `add-data-paging-and-chunked-write` | ✅ read 分页/eval 子树并入 `evolve-default-toolset`(已归档);✅ draft 部分 → `add-draft-write-commit`(已归档,Phase 2,2.19 发布) |
> | `add-structured-todos-and-subagent-writes` | ✅ `update_todo` 增量由 `add-adaptive-planning` 落地(已归档);✅ `add-structured-todos-tier`(已归档,Phase 2,2.19)+ subagent-writable 直接落地(2.19,未走独立 change) |
> | `observability-structured-tracing` | ✅ `revive-observability-tracing`(已归档,Phase 3,2.19 发布;TraceSpan 树 + getTraceMetrics + DebugDrawer 🌳 tab) |
>
> 5 个旧 proposal 已移入 `archive/2026-07-31-*/`(proposal 顶部加「📦 已归档(被取代)」标注),作溯源底稿。`complex-agent-roadmap` umbrella 本身也于 2026-08-02 归档(Phase 1-4 全完成)。

## 最近完成的 change(已归档)

> **2026-08-03 component-library-expansion 归档(范围调整)**:用户决策「不需要 80,加几个意思意思就可以」。实际完成批 A **3 个简单展示类**(badge / progress / skeleton):`defs/*.ts` + `components/*Comp.vue` + `pageSchema.ts`(schema + union 33→36 + PageComponent 类型)+ `defs/index.ts`(import + push 基础内容)+ `CompRenderer.vue`(import + COMP_MAP)+ initialPage 实例(footer 前 3 个)。`tsc` 类型检查通过 + complex-demo browser spec **9 passed** 回归(新组件不破渲染/交互/huge 800 计数)。批 B-E(到 ~80)取消。**意外发现(澄清核心担忧)**:`extractSchemaHint(pageSchema)` 对 `components[discriminatedUnion]` 数组字段不展开每个 type(只简短描述 +「用 read 查看实际形状」)→ 原担忧「80 type 撑爆 systemPrompt」**不成立**(union 在数组字段内不全量注入,深入靠 `schema_data` 工具)。活跃 1→0。

> **2026-08-03 quality-hardening 归档(本次)**:核对收尾发现 §1§2§3§3b 全部完成并随 2.21.0/2.22.0 发布 —— §1(stub BaseChatModel 基建 `_stub-model.mjs` + automation/subagent-writable/todos-tier 运行时测 automation.mjs,d1b297e)+ §2(formatForLog short-circuit / proxyLlm `throwOnDirectInProduction` 生产安全闸 / extractSchemaHint WeakMap 缓存,21fefd0)+ §3(中英 usage-guide §6.13 结构化追踪 / §6.14 无人值守自动化 + capability-boundaries B7 移「能做」)+ §3b(`tests/runtime/` 3 真 LLM 脚本 tool_call 收集修正:stream 模式收 / `inspect().trace.spans` filter tool 收)。⚠ **运行时测驱动发现并修复 storage bug**:`SnapshotKind`/`SNAPSHOT_KINDS` 不含 checkpoints/usage → automation 断点续跑持久化自 2.20 发布从未生效(见 CHANGELOG)。e2e 实跑 283 passed 0 failed。活跃 2→1。

> **2026-08-03 checkpoint-incremental-snapshot 归档(本次)**:核对收尾发现 tasks.md 滞后于代码 —— Phase A 全部完成并随 **2.21.0** 发布(selftest 1030→1055 / e2e 263 / browser 全绿):① **vfs 脏标记**(`backends/vfs.ts` `_dirty` 经 Proxy set/delete 统一置脏零遗漏 + `consumeDirty`/`isDirty`,checkpoint save 复用闭包 `lastVfsClone`);② **bind 脏标记**(dataOps controller `markDataDirty`/`consumeDataDirty` + 全写路径标脏,`commitSetToBind` 新增 `onWrite` 回调收敛 set_data/write(set)/draft_commit,dryRun 不触发;checkpoint save 复用 `lastBindClone`);③ **restore/importStack 重置增量基线**(测试驱动发现:restore 走 restoreInPlace 不经 dataOps 脏标记 → 重置 `lastBindClone`/`lastVfsClone` 强制下次 save 重建,防静默错乱);④ **跨轮 restore 一致性测试** sec-17(写→save→写→save→restore id1/id2/id3 → bind/vfs 数据一致)。Phase B(messages 结构共享)按 proposal 决策 3 **有意延后**(MVP 正确性优先,summarization splice 与快照 length 基线冲突险,留未来评估;messages 保持整体 clone)。性能 bench 为可选项未做。对外 API 零变(纯内部 perf)。活跃列表 3→2。

> **2026-08-03 p2-architecture-refactor 部分归档(本次)**:实际完成 ③(dataOps patch 装饰器 `applyPatchesToBind` 消除 patch 应用重复)+ ④(capabilities 注册表 `resolveCapabilities` 单一解析)+ ⑤(types 防漂移:`tests/types.test-d.ts` 字段级 Pick/Extract 断言)。**①(createChatSdk 1787 行拆分)+ ②(createAgent 回归中间件契约)+ ③剩余(read/get_data 合并 + writeSlot 拆)拆出暂缓** —— 纯内部重构零用户价值,无维护痛点驱动,等真实痛点再重启(见 [`deferred.md`](./deferred.md))。活跃列表 4→3。

> **2026-08-02 收尾归档(本次)**:`complex-agent-roadmap` umbrella + `revive-observability-tracing` 归档。Phase 1-4 全部完成发布(2.18-2.20):Phase 1(mission/workingMemory/schema-tiered)/ Phase 2(draft-write/todos-tier/subagent-writable)/ Phase 3(observability tracing)/ Phase 4(automation 资源预算+错误恢复+断点续跑+批处理)。observability 的 2 个文档项(usage-guide tracing + capability-boundaries B7)转 `quality-hardening` §3 统一补。`automation-layer` 与 `subagent-writable` 直接落地未走独立 change 文件(代码已随 2.19/2.20 发布)。活跃列表转 4 项(quality-hardening / checkpoint-incremental-snapshot / component-library-expansion / p2-architecture-refactor)。

> **2026-08-02 openspec 整理**:归档 5 个被 `complex-agent-roadmap` 重启取代的旧版 proposal(`add-cross-round-working-memory` / `add-mission-anchor` / `add-structured-todos-and-subagent-writes` / `add-data-paging-and-chunked-write` / `observability-structured-tracing`)→ `archive/2026-07-31-*/`。活跃列表 8→3(剩 `add-schema-tiered-disclosure` / `complex-agent-roadmap` / `revive-cross-round-working-memory`)。`project.md` / `deferred.md` / roadmap tasks 回填 Phase 1 进度;补 CHANGELOG 漏记的 workingMemory/schema-tiered 条目。

- `archive/2026-08-02-revive-observability-tracing/`:结构化追踪 TraceSpan 树(Phase 3 opt-in,2.19 发布)—— `createAgent` 内 `spans` shallowRef + `startSpan`/`endSpan`(round/model/tool/compression 4 埋点)+ `onSpan`/`onTrace` 回调(tracing 关 no-op);`getTraceMetrics(spans)` 纯函数(轮次/延迟/工具成功率/重试/压缩/token);`inspect().trace` + `onEvent('trace')`;`capabilities.tracing` opt-in(默认关);DebugDrawer 第 4 tab 🌳 Trace(metrics 卡片 + span 列表)。selftest sec-42(11 项)+ e2e inspect.mjs(tracing 开/关)+ 真 LLM 实测(spans 72 / round:23 / 工具成功率 84%)。文档债(usage-guide tracing / capability-boundaries B7)转 quality-hardening §3。
- `archive/2026-08-01-complex-agent-roadmap/`:umbrella 规划框架(不写代码,定义 SDK 定位升级「胜任复杂多组件 + 浏览器内后台自动化的胜任级 Agent SDK」+ 6 层能力全景 + 分层默认 + 分期路线)。Phase 1-4 全完成:① Phase 1(mission-anchor + cross-round-working-memory + schema 分层披露,核心默认开)② Phase 2(draft-write/commit + structured-todos-tier + subagent-writable,opt-in)③ Phase 3(observability TraceSpan 树,opt-in)④ Phase 4(automation 资源预算/错误恢复/断点续跑/批处理,opt-in)。详细报告见 `doc/complex-agent-roadmap.md`(11 节)。后续增强走独立 change(非本 umbrella)。

- `archive/2026-08-01-add-adaptive-planning/`:自适应规划(① `update_todo({id,content?,status?})` 增量更新 + `Todo` 稳定 id;② `maxPlanRevisions` 规划阶段防死循环(与 `maxIterations` 正交);③ usageHints planning 段 + 内置 `adaptive-planning` skill;④ `inspect().planPhase`。2.18 发布)。选型见其 `decision-record.md`,能力边界见 `doc/capability-boundaries.md`。
- `archive/2026-08-01-revive-mission-anchor/`:任务目标锚定 Phase 1(会话级 Mission 状态 + capture 启发式 + pin 段跨压缩 + `getMission`/`setMission`/`send({mission})` API + `capabilities.missionAnchor` 默认开。2.18 发布)。
- `archive/2026-08-01-followup-from-live-llm-audit/`:真 LLM 全覆盖审计(4 agent:complex/人工确认+嵌套/子agent+多agent/RAG)收口 —— ① 修 `isPathAllowed`/`getSchemaAtPath` discriminatedUnion pre-existing bug(误当 ZodArray 致 `components.N.props.X` 深层路径误 PATH_DENIED;严格判 + union 降级开放,safeParse 兜底;sec-31 +8 断言);② browser flaky 修(`_helpers` clearStorage 入 clearChat + waitForAgentIdle timeout 30→60s,跨 spec 状态污染);③ usageHints 补 history_data/diff_data 提示;④ 补 `nested-demo.spec.ts` + `error-recovery.spec.ts` + `rag-demo.spec.ts` + page-demo offset 翻页用例(browser 7→15,连跑 2 次稳);⑤ planner-demo systemPrompt 加"收到方案必须 write 落地"。selftest 780→782、browser 7→15(2 次稳)。
- `archive/2026-08-01-refine-dataops-reachability/`:dataOps 精修(内部,未发布)—— read 概览去约束(与 systemPrompt 去重复,约束靠 systemPrompt + schema_data)+ usageHints 补分页/多路径/dryRun(让 evolve 能力 LLM 可达)+ describeSchemaNode zod 版本防御(adapter 集中声明 + dev warn 去重)。微行为变化。
- `archive/2026-08-01-fix-unify-error-half-done/`:unify-error 缩水(内部,未发布)—— routeError 降级为导出工具 + 扩展口注释(框架内置 catch 未消费),middleware 删空头契约承诺。零行为变化,为未来 wrapToolCall 自动路由补全留低改动面。
- `archive/2026-07-31-expose-schema-constraints/`:字段约束可见性(minor,未发布)—— `describeSchemaNode` 纯函数结构化提取 zod 4 字段约束;zod 4.4+ adapter。两处消费(refine 后):`extractSchemaHint` → systemPrompt「可操作数据」段带约束 + `schema_data({ jsonPath? })` 工具(advanced)。LLM 写前即知规则,减试错轮次。新增导出 describeSchemaNode/renderSchemaHint/renderSchemaOverview/formatConstraints + SchemaNodeDesc。
- `archive/2026-07-31-evolve-default-toolset/`:默认(simple)工具集演进(minor,未发布)—— ① 精简:`snapshot_data`/`list_data_snapshots` 移 advanced(simple 8→7,被自动快照+restore_data+history_data 覆盖);② 补缺:`history_data({ id?, jsonPath? })` 只读查看快照进 simple(填 list 元信息/restore 破坏性之间的空档);③ 增强:`read` 多路径(`jsonPaths`)+ 数组分页(`offset`/`limit`,切片+total/hasMore),`write` `dryRun`(四意图预检不落盘),`eval_script` `jsonPath`(子树模式);④ 新增 `diff_data({ snapshotId?, against? })`(advanced,纯函数 `diffObjects` 导出)。**同时落地 `add-data-paging` 的 ✅ 部分**(read 分页/eval 子树);draft_write/commit 部分仍暂缓。
- `archive/2026-07-31-unify-error-model/`:三档错误模型(minor,未发布)—— 显式化隐式三档 `AgentError.severity`(recoverable 回灌 / fatal emit+中断 / observable 记录不中断)+ `routeError`/`asAgentError` 纯函数(默认 Error=fatal,保守暴露问题);各 catch 点(coreExecTool/afterAgent/emit/invoke)按档归一化。`onEvent('error')` payload 扩展 `{ severity?, code?, context? }`(向后兼容)。新增导出 ErrorSeverity/AgentError/ErrorRouting/routeError/asAgentError/agentError。
- `archive/2026-07-31-declarative-middleware-ordering/`:中间件声明式 priority 排序(**期一**,patch,未发布)—— `composeMiddlewareStack` 纯函数 + `MIDDLEWARE_PRIORITY` 常量稳定排序 + selftest 断言锁死顺序约束;修了初版 `sdk-events=9999` bug(用户中间件 Infinity 排到其后,破坏"最后观察",e2e 不断言顺序所以漏网)。行为不变(排序=原硬编码)。**期二(`createReconfigurable` setter 收敛)DEFERRED** —— 纯内部重构量大收益低,推迟到频繁加可配置项时再做(设计见 archive design.md §2.2)。selftest 696→699。期一规范已合入。
- `archive/2026-07-31-unify-context-compression/`:双摘要合并协议统一(patch,未发布)—— 抽 `SummarySegment` 协议 + `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 纯函数(single source of truth);`trimMemoryMessagesImpl`(`rounds.ts`)与 `useContextManager.compress` 的"提取头部旧摘要"改调共享 `parseSummarySegment`(消除两处逐字重复的提取补丁)。内部重构,行为不变(两套压缩保留各自触发时机与产出格式,只统一合并逻辑)。selftest 692→696。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-react-loop-budget/`:ReAct 循环预算语义加固(patch,未发布)—— `rounds` 回归"只计工具轮"(自纠不耗 rounds,有独立预算 formatRetries/verifyAttempts);新增 `iterations` 总循环计数 + `maxIterations` 硬上限(默认 max(maxToolRounds*3, 30),经纯函数 computeMaxIterations 推导)防自纠死循环;wrap-up 兜底文案改进展引导(不再让用户"简化问题")。向后兼容(语义修正,更符合直觉)。selftest 688→692。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-optimistic-lock/`:乐观锁加固(patch,未发布)—— `hashValue` djb2(32-bit)→ cyrb53(53-bit,碰撞空间 2^53,生日碰撞阈值从 ~65536 对象升到 ~9500 万);`lastReadHash` 并发语义文档化(`maxParallelTools>1` 下 autoLock 退化为"整体快照语义",建议并发下 LLM 显式传 `expectedHash` 精确控制)。hash 不持久化无兼容问题(语义不变,LLM 只比对相等)。selftest 683→688。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-model-caps-matching/`:模型能力表匹配加固(patch,未发布)—— `resolveModelCaps` first-match → longest-match(按"实际匹配子串长度"`exec[0].length` 取最具体条目,非 `pattern.source.length` —— `|` 分支会虚高 source 长度,实测 `glm-4.5` 被 `glm-4|glm4` 误压)。消除"顺序依赖"脆弱性(新模型名是旧模型子串时不再匹配错条目拿错 contextWindow);补表驱动断言锁死"已知模型名 → 预期 caps"。行为不变(当前顺序下 longest=first 结果一致)。selftest 680→683。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-fix-introspection-consistency/`:inspect 展示口径修复(patch,未发布)—— `inspect().systemPrompt` 漏中间件 augmentPrompt 段(usageHints/todos/skills/memory/subagents,getInfo 只拼 base+data+augmentSystem 另起炉灶,与实际发给 LLM 的不符)→ `createAgent` 暴露 `getEffectiveSystemPrompt()`(复用权威 `buildSystemPrompt`),getInfo 代理(单一真相源,展示=运行时)。LLM 实际收到的 prompt 本就对(向后完全兼容)。e2e 217→221。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-add-complex-preset-and-vfs-json/`:体验平面改进(复杂任务 + 超大 JSON 演进 Phase 3,2.16.0 发布)—— ① complex 上下文预设(`contextPreset:'complex'`,比例制 `windowRatio=0.6`/`summaryThresholdRatio=0.7`/`recallTopK=5`/`enableLLMSummary=true`;`preserveLastToolResults` 按 preset 取,complex 扩 `query_data`/`search_data`;映射在 `sdk/contextPreset.ts`);② vfs JSON 感知工具(`vfs_json_read` 按 jsonPath 读子树 / `vfs_json_patch` 原子 patch / `vfs_write` 增 `jsonString` 校验);③ vfs 三池分池(`large_results` 4MB / `drafts` 2MB / `userFiles` 2MB 独立 LRU,`vfs.maxBytes` 默认 8MB,`poolBytes` 可配;`drafts` 池依赖前序 change 的 `draft_write`);④ offload 结构化元数据(`OffloadResult` + 大结果 `suggestedReadPlan`)。顺带修正 vfs 工具族 source 标记 `user`→`builtin`(`VFS_TOOL_NAMES`)。minor(新增能力,向后兼容)。selftest 642→680、e2e 212→217。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-fix-dataops-write-correctness/`:dataOps 写路径正确性/安全修复(两缺陷合并,2.15.1 发布)—— ① 数组子项删除稀疏(`deleteByPath` 对数组元素用 `delete arr[i]` 产生 empty 槽,length 不减、序列化渲染 null 污染 hashValue/持久化/Vue reactive,四入口 delete_data/write del/edit remove/eval patches remove 全踩)→ 父为数组且末段数字索引时改 splice 移除,对象属性仍 delete(语义不变);② 白名单绕过(set_data/write(set) 在 safeMerge 后把 LLM 原始 parsed 的未声明字段无校验写回 bind)→ 删两处逐字相同的写回块,bind 严格只收 schema 声明字段(interceptors.write 转换/审计/拒绝已声明字段值不变,不再能绕白名单塞字段)。纯逻辑 patch,安全/正确性收紧。selftest 630→642、e2e 210→212。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-refactor-module-extraction/`:模块抽离重构(可维护性,纯重构零行为变化,2.14.0 发布)—— `dataOps.ts` 纯函数 → `tools/jsonUtils.ts` + `tools/schemaUtils.ts`;`useContextManager.ts` 纯函数 → `composables/contextIndex.ts`;`createChatSdk.ts` 高频改动点 → `sdk/{promptBuilder,llmResolver,conflictManager,optionsResolver,events}.ts`;开放 subpath `./storage` / `./query` / `./llm`。createChatSdk 1751→1613、dataOps 969→670、useContextManager 321→235;sec-30/31/32 白盒单测,selftest 537→630、e2e 210 全过。skillStore 桥接延后(闭包依赖深,留独立 change)。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-dynamic-reconfiguration/`:运行时资源动态加载/卸载 —— `sdk.setTools/addTool/removeTool`(用户工具动态,核心基础设施)/ `sdk.setSubagents/addSubagent/removeSubagent`(复用 tools 机制)/ `sdk.setLlm`(模型切换 + 重解析能力)/ `sdk.setMemory`(memory 动态)。复用 `let + rebind + infoTick` 模式(类比 setData/setSkills),全程向后兼容。自测 524/524,e2e 210/210。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-augment-system-hook/`:动态 system prompt 注入钩子 `augmentSystem(ctx)`(集成方按运行时状态注入部分 schema / 组件说明)+ A4「可操作数据」段改为每轮随 data 动态(修 `setData()` 不同步 Bug,经 `dataHint` 中间件)。复用 augmentPrompt 中间件机制,不污染 `HarnessState`。规范已合入 `openspec/specs/page-agent-core.md`。自测 495/495,e2e 189/189。
- `archive/2026-07-24-add-verify-middleware/`:Verify 自检中间件(`beforeReturn` 钩子点 + `createVerifyMiddleware` + `createWriteBackCheck` 写后读回 + 对抗验证)。对应 `doc/evolution-roadmap.md` #5。自测 146/146,规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-23-generalize-chat-sdk/`:通用化(provider 抽离 / headless / capabilities / MCP / presets)。
- `archive/refactor-to-chat-sdk-sdk/`:重构为框架无关页面内 Agent SDK(规范已合入 `openspec/specs/page-agent-core.md`)。
