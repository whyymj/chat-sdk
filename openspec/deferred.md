# 已评估暂缓的 Change(Deferred Backlog)

> 本文件记录经评估后**暂缓 / 缩水 / 拆分**的 change 规划。每项含:结论、核心理由(基于代码核实)、重启触发条件、缩水替代方案。
>
> **定位**:这些是「有想法、但当前不该做」的规划沉淀 —— 保留思路、避免规划积压占用「进行中」心智,也避免未来重复构思。原 change 目录(`openspec/changes/<id>/`)不删,作为详细规划底稿;本文件是**汇总索引 + 决策依据**。
>
> **评估日期**:2026-08-01。**评估背景**:8 个 change 全为 2026-07-31 同日规划,经逐项对照代码现状核实(proposal 声称的现状缺陷**全部属实**),核心矛盾是「复杂任务 + 超大 JSON 编排」方向 vs SDK「轻量页面 JSON 操作 Agent」定位。详见会话评估记录。

---

> 🔄 **[2026-08-01 定位升级覆盖 —— 本节以下 5 项全部重启]**
> SDK 定位从「轻量页面 JSON 操作 Agent」升级为「**胜任复杂多组件 + 浏览器内后台自动化的胜任级 Agent SDK**」(见 [`doc/complex-agent-roadmap.md`](../doc/complex-agent-roadmap.md))。**本文件的核心标尺②「不滑向重型编排框架」已被推翻** —— 以下 5 个暂缓提案**全部重启授权**(定位升级即真需求,不再等「重启触发条件」),按设计报告分期落地(Phase 1-4)。
> 下方的「评估原则」与「各项详情」为**旧定位下的历史评估**,保留作决策溯源;每项的**重启状态 + Phase 归属**见下表。重启落地为 `revive-*` / 调整后新 change(基于旧 proposal,非直接 apply —— 旧 proposal 有默认策略 / 依赖绑定 / 已实现部分去重等需调整)。

> 📦 **[2026-08-02 归档]**:以下 5 项的旧 proposal 已移入 `openspec/changes/archive/2026-07-31-*/`(顶部加「📦 已归档(被取代)」标注),作溯源底稿,不再实施。重启落地的新 change 状态(活跃/已归档)见 [`project.md`](./project.md)「进行中」与「最近完成」段。

## 暂缓项一览

> 🔄 定位升级后**重启状态**(旧 ⏸/🟡/❌ 见各详情段历史):

| change | 旧结论 | 🔄 重启状态 | 落地 Phase |
|---|---|---|---|
| observability-structured-tracing | ❌ 缩水 | 🔄 **恢复完整**(TraceSpan 树,非缩水) | Phase 3 |
| add-mission-anchor | ⏸ 暂缓 | 🔄 **重启**(分层默认核心开;capture 争议接受) | Phase 1 |
| add-cross-round-working-memory | ⏸ 暂缓 | 🔄 **重启**(**解绑 C 组** → 独立中间件,只 pin path/hash) | Phase 1 |
| add-structured-todos-and-subagent-writes | ⏸ 暂缓 | 🔄 **重启**(update_todo 已由 adaptive-planning 做;剩余层级 deps + 子agent写) | Phase 2 |
| add-data-paging-and-chunked-write(draft 部分) | 🟡 拆分 | 🔄 **重启 draft**(read 分页已并入 2.17.0;只剩 draft_write/commit) | Phase 2 |

## 评估原则(为什么暂缓)— ⚠️ 旧定位下;标尺②已推翻

> 🔄 **[定位升级覆盖]** 以下原则基于旧「轻量页面 agent」定位。**标尺②「定位契合度——不滑向重型」已被新定位推翻**(新定位就是要胜任重型复杂 + 自动化)。标尺①(真需求驱动)、③(依赖绑定 → 解绑后单独立项)、④(沉没成本)逻辑仍适用,但 ① 的「真需求」已被「定位升级」满足。以下保留作历史溯源,不代表当前决策。

SDK 定位是**框架无关的轻量页面 JSON 操作 Agent**(自研 Deep Agents 风格 harness,刻意规避 LangGraph / langchain 整包)。评估的核心标尺:

1. **真需求驱动 vs 规划完整驱动** —— change 是为解决真实用户场景,还是为「能力矩阵补全」?
2. **定位契合度** —— 是否把 SDK 推向「重型任务编排框架」(违背轻量初衷)?
3. **依赖绑定** —— C 组四件套(mission / working-memory / structured-todos / paging-draft)互相声明依赖,要么一坨做(巨大工作量 + 偏离定位),要么止损暂缓。
4. **沉没成本不构成理由** —— 2.16.0 的 `complex` 预设 + vfs `drafts` 空池已是朝复杂场景的前置投资,但**不构成「必须做下去」的理由**(drafts 空池无害,LRU 就绪)。

## 各项详情

### observability-structured-tracing — ❌ 缩水(TraceSpan 树不做)

**核实现状**:`debugLogs` 是扁平 `{timestamp,type,data,source?}[]`(`createAgent.ts:42`),无 duration / 父子层级;`inspect()`(`types/index.ts:107`)无 trace/metrics 字段。proposal 声称属实。

**暂缓理由**:
- **最明显的过度工程**。TraceSpan 树 + timing + status + `onEvent('trace')` + APM 上报是**后端 agent 框架**(LangGraph / CrewAI)的可观测性需求。
- SDK 用户多为**前端集成开发者**,不是运维 SRE;`debugLogs` 扁平数组 + DebugDrawer 对调试已够用。
- 改动面大(createAgent 各节点采集 span + DebugDrawer 树形渲染 + 类型 + 事件),收益人群窄。

**缩水替代**:若未来确需,只做 `getTraceMetrics(debugLogs)` 纯函数 —— 聚合现有扁平 debugLogs 出「每轮延迟 / 工具成功率 / 重试 / 压缩频次」,不引入 TraceSpan 树、不碰 createAgent 采集、不加 APM 上报。低成本。

**重启触发**:集成方明确提「生产监控 / SLA / 分布式追踪」需求,或自研 agent 规模化后内部需要性能归因。

---

### add-mission-anchor — ⏸ 暂缓(整个 change)

**核实现状**:无任务级目标模型;`compress` 的 `indexSummarize` 截 user 60 字 / assistant 80 字(`contextIndex.ts:50`);recall 锚点是「最新 user」(`useContextManager.ts:149`)。proposal 声称属实。

**暂缓理由**:
- proposal 自己承认「任务主线是 **LLM 自律问题,不是框架 invariant**」。用框架硬约束补偿 LLM 自律,与「轻量」定位有张力。
- **自动 capture 首条任务型 user**靠启发式(非空 / 非问候 / 长度阈值),误判风险高;`send({mission})` 显式传入又把「判断任务目标」的责任推给集成方。
- 这是 **4-Phase 长期路线**(Phase 1 本变更 → todos evidence → drift 检测 → goal verify),单个 change 只能交付开头 —— 启动即承诺一条重型演进线。

**重启触发**:出现 LLM 在长任务中**频繁忘记原始目标 / 压缩后偏离主线**的真实用户反馈(prompt 软约束失效),且 simple prompt 调整无法缓解。重启时只做 Phase 1 最小版(capture + pin 段),不碰 recall / spawn。

---

### add-cross-round-working-memory — ⏸ 暂缓(先做低成本软改进)

**核实现状**:`preserveLastToolResults` 默认 `['describe_data','read']`(`contextPreset.ts:26`),不含 query/search/eval;`lastReadHash` 是 createDataOps 闭包内变量(`dataOps.ts:112`),跨压缩无持久机制。proposal 声称属实。

**暂缓理由**:
- **绑定 C 组**:proposal #3/#4/#5 依赖 `paging` 的 `draft_write`(未实现)+ `mission-anchor` 的 dual-query(暂缓)—— 单独做是半成品。
- **「永不压缩的工作记忆段」本质是另一种 context 占用**,locatedPaths 累积 + notes 自由文本可能膨胀,抵消 summarization 的经济性。
- 引入新 state 字段 + 新中间件 + augmentPrompt 段 + compress 豁免 + recall 改造,复杂度高。

**缩水替代(低成本,可独立做)**:
- 扩 `preserveLastToolResults` 默认到 `['describe_data','read','query_data','search_data']`(proposal #2,软改进,一处配置)—— 覆盖 80% 的「多步检索链断裂」痛点,零结构改动。
- 这条可并入下一个 context 相关 change,不必立项 working-memory。

**重启触发**:扩 preserve 默认后,复杂任务场景下「压缩丢 path/hash」仍是瓶颈(实测 token 浪费显著),再考虑引入 workingMemory state。

---

### add-structured-todos-and-subagent-writes — ⏸ 暂缓(整个 change)

**核实现状**:Todo 仅 `{content, status}`(`state.ts:13`),无 id/deps;`write_todos` 整表替换(`todos.ts:34`),无 update_todo;子 agent 默认只读。proposal 声称属实。

**暂缓理由**:
- C 组里**最重、依赖最多**(弱依赖 mission-anchor)。
- **「子 agent 可写」动了「只读隔离」安全边界** —— writablePaths 白名单 + `PATH_OUT_OF_SCOPE` 校验增加复杂度,且削弱了子 agent「过程隔离、只返回结论」的设计。
- todos 结构化(id/parentId/deps)依赖 **LLM 可靠维护依赖图**,实践中 LLM 维护 deps 的可靠性存疑;evidence 校验 / handoff 强制又是「用框架硬约束补偿 LLM」。
- 内置 `large-json-edit` skill 绑定「超大 JSON」场景(该方向本身待定)。

**重启触发**:子 agent「只读 + 返回结论」成为明确功能瓶颈(有「检索 + 写入需在同一子任务闭环」的真实需求),且 mission-anchor 已落地(todos 对照 mission)。重启时先做「结构化返回 + `update_todo` 单项更新」(低成本),「子 agent 可写」与 evidence / handoff 仍暂缓。

---

### add-data-paging-and-chunked-write — 🟡 拆分(read 分页/eval 做;draft_write/commit 暂缓)

**核实现状**:`read` 仅单路径 + fields/depth,无 offset/limit(`dataOps.ts:511`);query/search 上限 200 无 cursor(`dataOps.ts:368/393`);`write` 无 dryRun;eval 全量深拷贝;`drafts` 池已分池(`vfs.ts:24`)但 `draft_write`/`draft_commit` 未实现。proposal 声称属实。

**拆分决策**:
- ✅ **做**(低成本高价值,可并入 `evolve-default-toolset` 或独立小 change):
  - `read` 增 `offset`/`limit`(大数组分页读)
  - `eval_script` 增 `jsonPath` 子树模式(降大 JSON 成本)
  - query/search cursor(中价值,可选)
- ⏸ **暂缓**(重量级,场景存疑):
  - `draft_write` / `draft_commit` 分块写入协议 —— 针对「超大 JSON 单次 LLM 输出写不完」场景。**页面 Agent 典型 JSON(页面配置 / 低代码 schema)一般几十~几百 KB,单次 write 可扛**,真实瓶颈未验证。`drafts` 池(2.16.0 已分)保持空池占位(LRU 就绪),不构成必须做 draft_write 的理由。

**重启触发**:集成方真实场景出现「单次 write 装不下的超大 JSON 生成」(如生成百级组件页面),且 patch 增量 + eval transform 仍不够用。重启时 drafts 池已有,直接补 draft_write/commit。

---

## 2026-08-03 新增:p2-architecture-refactor 重构子项拆出(等痛点驱动)

> `p2-architecture-refactor` 的 ①(createChatSdk 1787 行拆分)+ ②(createAgent 回归中间件契约)+ ③剩余(read/get_data 合并 + writeSlot 拆)从原 change 拆出暂缓。原 change 已归档(实际完成 ③ 装饰器 + ④ capabilities 注册表 + ⑤ types 防漂移),底稿见 `changes/archive/2026-08-02-p2-architecture-refactor/`。

**拆出理由(基于代码核实)**:
- **纯内部重构,零用户可见价值**:proposal 自述「纯重构零行为变化」—— SDK 当前能用、已发版、全测绿,做完用户无感;价值仅「可维护性」,但**当前无维护痛点驱动**(无「反复改坏 createChatSdk」反馈)。
- **大重构是隐性负债**:1787 行拆 5 文件 + AgentCore mixin / 动 ReAct 主循环做格式守卫中间件化,引入回归概率非零,收益抽象。无痛点驱动的拆分是 over-engineering。
- **② 尤其危险**:为把已工作的 quirk(DSML/wrap_up)塞进契约而动主循环 —— 当前无回归就别动(YAGNI)。

**重启触发(任一)**:
- createChatSdk 出现**反复改坏**真实反馈(多人协作撞车 / 某块反复回归)→ 拆 ①,边界自然清晰
- createAgent 主循环 DSML/format/wrap_up 出现**实际回归 bug**(当前无)→ 做 ② 契约化
- read/get_data 合并或 writeSlot 拆成为**其他改动前置阻塞**(当前独立可用)

**重启底稿**:`changes/archive/2026-08-02-p2-architecture-refactor/proposal.md` 子项 1/2 + tasks.md(行号 + 步骤齐全,直接 apply,无需重新构思)。

**与已完成部分关系**:③ 的 `applyPatchesToBind` 装饰器已消除 patch 应用重复(乐观锁×拦截器×dryRun 三轴 bug 高发区)—— 这是 p2 里**唯一有 bug 驱动的**子项,已做;①② 是纯结构优化,无 bug 驱动,暂缓合理。

---

## 维护约定

- 暂缓项**不进** `project.md`「进行中的 change」(避免占心智);本文件是唯一索引。
- 🔄 **定位升级后**(2026-08-01):5 项全部重启授权,分期落地(见 `doc/complex-agent-roadmap.md` + 上方覆盖块)。重启以 `revive-*` / 调整后新 change 推进(不直接 apply 旧 proposal —— 默认策略 / 依赖绑定 / 已实现部分需调整);旧详情段保留作"当初为何暂缓"的溯源,不删。
- 原 change 目录保留(proposal / design / tasks 不删),作为详细底稿;各 proposal.md 顶部已加 `⏸ 已评估暂缓` 标注块指向本文件。
- **重启某项时**:从本文件移除 → 立项进 `project.md`「进行中」→ 按正常 OpenSpec 流程推进(先修行号 + apply)。
- 本文件随评估持续维护;新增暂缓项追加到表尾。
