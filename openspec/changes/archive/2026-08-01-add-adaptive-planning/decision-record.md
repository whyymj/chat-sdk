# 决策记录:add-adaptive-planning(自适应规划)

> 本文档记录「自适应规划」change 的**方案选型过程**:各候选方案的细节、优缺点、最终决策与理由。
> **用途**:供未来参考——当需要升级规划能力、或重启相关暂缓提案(`add-mission-anchor` / `add-structured-todos-and-subagent-writes`)时,回看当初的决策依据与边界,避免重复构思、避免无意推翻已论证的边界。
> **评估日期**:2026-08-01。**评估背景**:2.17.0 发布后,用户提出「agent 自适应规划 + 动态 todos + 防死循环 + 自适应确认 + skill/默认提示词」需求。

---

## 0. 背景与约束

### 0.1 用户需求(原文)

1. agent 根据**任务复杂度**自行决定是否先规划
2. 执行中实时**完善 todos / 规划步骤**,但需有**次数限制防死循环**
3. agent 自行决定是否需要**人工确认规划的任务流程**
4. 补充必要的 **skill 与默认提示词**

### 0.2 评估标尺(来自 `openspec/deferred.md`,本次设计的"宪法")

SDK 定位是**框架无关的轻量页面 JSON 操作 Agent**(自研 Deep Agents 风格 harness,刻意规避 LangGraph / langchain 整包)。核心标尺:

1. **真需求驱动 vs 规划完整驱动** — change 是为解决真实用户场景,还是为「能力矩阵补全」?
2. **定位契合度** — 是否把 SDK 推向「重型任务编排框架」(违背轻量初衷)?
3. **依赖绑定** — 互声明依赖的要么一坨做(巨大 + 偏离定位),要么止损暂缓。
4. **沉没成本不构成理由**。

**两条已沉淀的教训**(直接约束本次设计):

- `add-mission-anchor` 暂缓教训:**任务主线是 LLM 自律问题,不是框架 invariant**。用框架硬约束补偿 LLM 自律,与轻量定位有张力;自动 capture 启发式误判风险高。
- `add-structured-todos-and-subagent-writes` 暂缓教训:**依赖图 / evidence / handoff 是「框架硬约束补偿 LLM」**,最重、依赖最多;todos 结构化依赖 LLM 可靠维护依赖图,实测不可靠。

### 0.3 核心洞察:需求分两层

| 需求性质 | 归属 | 处理方式 |
|---|---|---|
| 何时规划 / 何时确认 / 怎么动态修订 | **LLM 路由/自律问题** | **prompt 层**(skill + usageHints + 默认 prompt):可随时迭代、零误判争议、不重蹈 mission capture 覆辙 |
| 防死循环(光规划不执行) | **框架必须兜底的硬约束** | **框架层**(`maxPlanRevisions`):prompt 软约束防不住死循环 |
| 动态完善 todos 的增量入口 | **框架轻量增强** | **框架层**(`update_todo` 增量):整表重传浪费,需增量入口 |

---

## 1. 决策维度 A:框架增强深度

> 自适应判断 / 方案确认 / skill 始终在 prompt 层(三个方案一致),此处只问**框架增强**做到哪个深度。

### A1. 轻量(✅ 选定)

**细节**:
- 框架只加两样:① `update_todo({id, content?, status?})` 增量工具(从 `add-structured-todos-and-subagent-writes` 精简复活,**去掉** parentId/deps/evidence/criteria);② `maxPlanRevisions` 防死循环预算。
- 其余(复杂度判断 / 规划方案确认 / 标准流程)全在 prompt 层:内置 `adaptive-planning` skill + `usageHints` 自适应规划段。

**优点**:
- ✅ 最贴合轻量定位(标尺②),改造面最小(`todos.ts` + `usageHints.ts` + 1 skill + 配置项)
- ✅ 真需求全覆盖(标尺①):用户 4 条需求全部满足,无能力补全
- ✅ 无依赖绑定(标尺③):独立 change,不依赖 mission / working-memory / draft
- ✅ 不重蹈覆辙:`update_todo` 是减负工具(增量,省 token),非"框架硬约束补偿 LLM"
- ✅ 可扩展:schema 干净,未来 evidence / deps 可作 capabilities 开关平滑叠加(见 §4)

**缺点**:
- ⚠️ 不校验 todo 是否「真正完成」(LLM 可标 completed 但没实际做)——由已有 `verify` 中间件(写后读回)在写场景兜底;纯规划步骤无写操作的,不校验(页面场景可接受)
- ⚠️ 无依赖图表达(不能显式声明「A 依赖 B」)——靠扁平列表 + 顺序 + prompt 引导,复杂依赖任务表达力弱(但页面 JSON 操作场景罕见)

**适用场景**:页面 JSON 操作 Agent 的主流场景(改字段 / 调样式 / 加组件 / 多步配置)。

---

### A2. 中等(A1 + 可选 todoEvidence 校验)

**细节**:
- A1 全部 + `capabilities.todoEvidence`(默认 `false`):开启后 `write_todos`/`update_todo` 标 `completed` 需附 `evidence`(tool callId 或读回 hash);框架校验 callId 在 messages 中存在且对应 ToolMessage 无错,否则 `TODO_EVIDENCE_MISSING` 拒绝标 completed。

**优点**:
- ✅ 防 LLM「假装完成」(标 completed 但实际没做),规划-执行可信度提升
- ✅ opt-in(默认关),零开销,不破坏现状

**缺点**:
- ⚠️ 与已有 `verify` 中间件功能重叠:verify 已做「写后读回 + schema 校验」;evidence 在「写场景」边际效用低(改没改成 read 一下就知道)
- ⚠️ 增加框架复杂度:校验逻辑要遍历 messages 找 ToolMessage + 对应 callId;多一个 capabilities 开关 + 错误码 + 测试
- ⚠️ evidence 对「纯规划步骤」(无写操作,如「调研需求」「确认方案」)无法提供有效证据——而这些恰恰是最该校验的,反而校验不到
- ⚠️ 偏离「真需求」:用户没提「假装完成」痛点(标尺①:能力补全嫌疑)

**适用场景**:未来出现「LLM 在长任务中频繁假装完成步骤」的真实反馈时,作为 capabilities 开关叠加。

---

### A3. 完整复活 `add-structured-todos-and-subagent-writes`

**细节**:
- `update_todo` + 层级 `parentId`/`deps`(依赖图)+ `evidence` 校验 + 内置 `large-json-edit` skill(仍不做子 agent 写——连 structured-todos 本身都标了暂缓)。

**优点**:
- ✅ 表达力最强:层级依赖、完成证据、大 JSON 编辑流程文档化

**缺点**(7 条,对照 deferred 标尺):

| # | 缺点 | 对照标尺 |
|---|---|---|
| 1 | **偏离定位**:parentId/deps 依赖图 + evidence = 「框架硬约束补偿 LLM」,把 SDK 推向 LangGraph/CrewAI 式重型编排 | ② 定位契合(❌) |
| 2 | **LLM 难可靠维护依赖图**:实测常漏填 id / 依赖循环 / 标 completed 但 deps 未完成;框架还要渲染 ✓/⏳ 阻塞状态,增 prompt 体积 | deferred 明确暂缓理由 |
| 3 | **evidence 与 verify 重叠**:防「假装完成」但 verify 已做写后读回;页面场景 evidence 边际效用低 | ① 真需求(❌ 能力补全) |
| 4 | **large-json-edit skill 与 usageHints 重复**:2.17.0 已做 read 分页 + write patches + dryRun,usageHints 已文档化该流程;skill 还需 LLM 主动 load 才生效(不如每轮自动注入) | 沉没成本/重复 |
| 5 | **改造+测试面 3-4 倍**:层级递归渲染 + deps 状态计算 + evidence 查 messages + skill 注册,代码与测试同步膨胀 | 维护成本 |
| 6 | **推翻自己定的重启触发条件**:structured-todos 暂缓时声明「重启需:子 agent 只读成瓶颈 **且** mission-anchor 已落地」——两个条件都没满足。强行复活破坏 deferred.md 治理一致性 | ③ 依赖绑定 |
| 7 | **用户真实需求不需要**:parentId/deps/evidence 是能力补全,非用户所求;A1 已全覆盖用户 4 条需求 | ① 真需求(❌) |

**适用场景**:未来出现「复杂依赖任务 + LLM 频繁假装完成 + 子 agent 只读成瓶颈」的**复合**真实反馈,且 mission-anchor 已落地时,按重启触发条件评估。

---

## 2. 决策维度 B:防死循环计数语义

> 已有 `maxIterations`(默认 max(maxToolRounds*3, 30))是**总轮次总闸**(防任何死循环)。此处 `maxPlanRevisions` 是针对「规划动作」的**专项闸**,二者正交。

### B1. 只计整表重写(`write_todos` 次数)

**细节**:统计 `write_todos`(整表替换)调用次数;`update_todo` 增量不计数。超限回灌「停止重写,基于当前清单执行」。

**优点**:
- ✅ 实现最简单(wrapToolCall 里计数 write_todos 即可)
- ✅ 语义清晰:只防「反复推翻重写整个计划」,鼓励增量完善(update_todo 不消耗预算)

**缺点**:
- ⚠️ 防不住「增量式拖延」:LLM 可一直 update_todo 小修小补(不消耗预算)而不执行,绕过限制
- ⚠️ 防不住「调研式拖延」:LLM 在规划阶段反复 read/query/search 调研(不计入),迟迟不 write_todos 也不执行

**适用场景**:对实现成本敏感、且信任 LLM 不会用增量/调研绕过的场景。

---

### B2. 计所有 todos 写操作(`write_todos` + `update_todo`)

**细节**:两者都计入预算。

**优点**:
- ✅ 比 B1 严:堵住「增量式拖延」(update_todo 也消耗预算)

**缺点**:
- ⚠️ **误伤正常多步拆解**:LLM 正常「write_todos 拆 5 步 → 逐步 update_todo 标 completed」会消耗 6 次预算(1 整表 + 5 增量),正常规划被误判为死循环
- ⚠️ 仍防不住「调研式拖延」(read/query/search 不计入)
- ⚠️ 预算阈值难定:太严误伤,太松无效

**适用场景**:无明显优势,基本不推荐。

---

### B3. 计「规划阶段」总轮次(✅ 选定)

**细节**:
- **进入规划阶段**:首次调用 `write_todos`(开始拆解)→ 置 `inPlanning=true`,`planPhaseRounds=1`
- **阶段内计数**:planning 状态下每轮 `beforeModel` 时 `planPhaseRounds++`(含期间 read/query/search/**调研轮**——调研也算规划成本)
- **退出规划阶段**:首次**写操作工具**(`write`/`set`/`edit`/`delete`/`eval` transform)成功 → `inPlanning=false`(开始执行了)
- **超限**:planning 状态下 `planPhaseRounds > maxPlanRevisions` → 下次 `write_todos`/`update_todo` 返回结构化提示「规划阶段已达上限,停止调研/修订,基于当前清单开始执行」
- **重入与兜底**:执行后可再 `write_todos` 重新进入规划(单阶段计数重置,允许多次「规划→执行→再规划」);若 LLM 反复进出刷预算,已有 `maxIterations` 总闸兜底

**优点**:
- ✅ **语义最准**:防的就是「光调研/改计划不动手」——把规划阶段的所有轮次(含调研)都计入,真正度量「规划耗时」
- ✅ 堵住 B1/B2 的两个漏洞(增量式拖延 + 调研式拖延都计入)
- ✅ 不误伤:执行阶段(写工具)一旦开始就退出计数,正常「规划 N 轮 → 执行」不受限
- ✅ 与 `maxIterations` 正交分工:本闸管「规划阶段别拖」,总闸管「整体别死循环」

**缺点**:
- ⚠️ **实现最复杂**:需维护 `inPlanning` 状态机 + 阶段边界识别(写工具成功才退出)+ beforeModel 计数 + 重入重置
- ⚠️ 阶段边界有灰区:若 LLM 用 `read` 而非 `write` 来「执行」(如纯查询任务,不改数据),永远不退出规划阶段——需定义「执行」含哪些工具(建议:写工具 + 终止性文本回复)
- ⚠️ 重入刷预算:单阶段重置可被「规划→写一下→再规划」绕过;依赖 `maxIterations` 兜底(可接受,因总闸已存在)

**适用场景**:对死循环防护精度要求高、愿承担状态机实现成本的场景(本 SDK 选此)。

---

## 3. 最终决策

**A1(轻量)+ B3(规划阶段总轮次)**。

### 理由

1. **A1 踩中 deferred 全部 4 标尺的「通过」**,A3 踩中全部 4 标尺的「雷」,高下立判。
2. **B3 语义最准**:用户明确要「防死循环」,B3 是唯一堵住「调研式/增量式拖延」且不误伤正常规划的方案;实现复杂度可接受(状态机 + 总闸兜底)。
3. **用户真实需求全覆盖**:A1 + B3 + prompt 层(skill + usageHints)精准命中用户 4 条需求,零能力补全。
4. **可扩展**:A1 的干净 schema + B3 的独立预算,为未来升级到 A2/A3 留平滑接口(见 §4),不会因选轻量而封死升级路径。

---

## 4. 扩展口与未来升级路径

> 选轻量**不等于**永远不做 A2/A3。关键是在「真实反馈触发」时增量叠加,而非「能力补全」驱动。

### 4.1 升级到 A2(+ todoEvidence)

- **重启触发**:出现「LLM 在长任务中频繁标 completed 但实际未做」的真实用户反馈,且 `verify` 中间件(写后读回)无法覆盖(如纯规划步骤无写操作的场景)
- **怎么叠加**:`update_todo` schema 增可选 `evidence?: string` 字段;新增 `capabilities.todoEvidence`(默认 false);`wrapToolCall` 在 status→completed 时校验 callId 存在。**对 A1 零破坏**(可选字段 + 默认关开关)
- **预估工作量**:~40 行 + 3-5 条测试

### 4.2 升级到 A3(+ 层级 deps)

- **重启触发**:出现「复杂依赖任务(显式 A 依赖 B)」真实反馈,且扁平列表 + prompt 引导无法表达
- **怎么叠加**:`update_todo`/`write_todos` schema 增可选 `parentId?`/`deps?`;`renderTodos` 递归渲染 + 依赖阻塞状态。**前置**:先重启 `add-mission-anchor`(结构化 todos 弱依赖 mission)
- **预估工作量**:~120 行 + 层级渲染 + 测试(参考 `add-structured-todos-and-subagent-writes` design)

### 4.3 与 `add-mission-anchor` 的叠加

- planning(本 change)管「**步骤**」(怎么拆、怎么做);mission 管「**目标锚点**」(为什么做、防跑偏)
- 两者正交:本 change 不做 mission capture,未来 mission-anchor 重启时,二者可叠加(planning 段 + mission 段并列注入 system)
- **mission-anchor 重启触发**(来自 deferred):「LLM 频繁跑偏 / 压缩后丢主线」真实反馈,prompt 调整无法缓解

### 4.4 `maxPlanRevisions` 的演化

- 当前:固定预算(默认 5,可配)
- 未来:可演化为「按任务复杂度动态预算」(简单任务 0-2,复杂任务 8-10)——但复杂度判断仍在 prompt 层(LLM 自评),不做框架中间件检测(重蹈 mission capture 误判争议)

---

## 5. 与暂缓提案的关系矩阵

| 提案 | 状态 | 本 change 关系 |
|---|---|---|
| `add-mission-anchor` | ⏸ 暂缓(整个) | **正交不冲突**。本 change 不做 mission capture/压缩豁免/spawn prepend;未来 mission 重启可叠加(planning 管步骤,mission 管目标) |
| `add-structured-todos-and-subagent-writes` | ⏸ 暂缓(整个) | **部分复用**。本 change 借其 `update_todo` 增量思路(精简,去 parentId/deps/evidence);**不复活**其层级/evidence/handoff/子 agent 写/结构化返回/large-json-edit skill |
| `add-cross-round-working-memory` | ⏸ 暂缓 | **无关**。本 change 不涉及跨轮工作记忆 |
| `add-data-paging-and-chunked-write` | 🟡 部分完成(read 分页/eval 已做;draft 暂缓) | **无关**。本 change 不涉及数据分页/分块写 |
| `observability-structured-tracing` | ⏸ 缩水 | **无关**。本 change 不涉及 trace |

---

## 6. 决策摘要表

| 维度 | 候选 | 决策 | 核心理由 |
|---|---|---|---|
| A 框架深度 | A1 轻量 / A2 +evidence / A3 完整复活 | **A1** | 踩中 deferred 4 标尺全部「通过」,真需求全覆盖,可扩展 |
| B 计数语义 | B1 整表计数 / B2 全操作计数 / B3 规划阶段轮次 | **B3** | 语义最准,堵住调研式/增量式拖延且不误伤,总闸兜底 |

> 本决策记录与 `proposal.md`(What/Why)、`design.md`(How/实现)互补:`proposal` 说做什么、`design` 说怎么做、本文档说**为什么这么选 + 未来怎么升级**。
