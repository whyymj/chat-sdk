# Change: add-adaptive-planning

> 自适应规划:agent 按任务复杂度决定是否先规划 + 执行中动态增量完善 todos(防死循环)+ 规划方案可选人工确认 + 内置 skill 与默认提示词。
> **范围:轻量版** —— 框架只加 `update_todo` 增量 + `maxPlanRevisions` 防死循环;复杂度判断 / 方案确认 / 标准流程全在 prompt 层。
> 选型依据(各候选方案细节、优缺点、升级路径)见本目录 `decision-record.md`;与暂缓提案关系见其 §5。

## Why

1. **「是否规划」当前是一刀切 prompt 引导,无自适应分流**。`usageHints` 现有 planning 提示是「多步任务建议先 write_todos 拆解」(usageHints.ts:36),不分简单/复杂:简单任务(改标题)也被引导规划 → 过度编排;复杂任务(多步配置)引导又太弱,缺标准流程。用户要「按复杂度自适应」。

2. **todos 只能整表替换,无法动态增量完善**。`write_todos` 是整表替换语义(todos.ts:34-54);执行中发现某步要改/补/细分,必须重传整个数组。步骤多时每次修订重传浪费 token,且 `wrapToolCall` 拒一轮内多次 write_todos(todos.ts:65-76)。用户要「执行中实时完善」,缺增量入口。

3. **无「规划死循环」专项防护**。已有 `maxIterations`(总轮次总闸,默认 max(maxToolRounds*3, 30),createAgent.ts:141)防整体死循环,但太粗:LLM 可在前 N 轮一直 write_todos / read 调研改计划而不执行(光规划不动手),在总闸触顶前浪费大量 token。用户明确要「次数限制防死循环」——针对「规划动作」的专项闸。

4. **规划方案缺「给用户确认」的引导**。已有 `request_human_confirmation`(humanConfirm),但 usageHints 现有人工确认引导只覆盖「给方案/歧义/高风险」三类(usageHints.ts:73-79),未明确「规划出的多步方案先给用户确认再执行」场景。用户要「自行决定是否需人工确认规划流程」。

5. **缺规划标准流程 skill**。内置 skill 只有 `page-agent-sdk-integrate`(面向集成方),无面向 agent 运行时的「自适应规划标准流程」skill。用户要「补充必要的 skill」。

## What Changes

### 1. todos 增量更新:`update_todo` 工具(P0,框架)
- `Todo` 增 `id` 字段(state.ts);`write_todos` 整表替换时框架按 index 自动生成稳定 id(`t-1`/`t-2`...,LLM 也可显式传)
- 新工具 `update_todo({ id, content?, status? })`:单项增量更新(不必重传整个数组)
- `augmentPrompt` 渲染 todos 时带 id(供 LLM 引用 update)
- `wrapToolCall`:`update_todo` 的 id 在当前数组找不到 → `TODO_NOT_FOUND`;限一轮内 `update_todo` + `write_todos` 不可同时调(状态冲突)

### 2. 规划阶段防死循环:`maxPlanRevisions`(P0,框架)
- 新增配置 `maxPlanRevisions`(默认 5):**规划阶段总轮次**预算(语义详见 decision-record §B3,非 write_todos 次数)
- 状态机(todos 中间件维护):首次 `write_todos` 进入规划阶段(`inPlanning=true`);每轮 `beforeModel` 计数 `planPhaseRounds++`(含 read/query/search 调研轮——调研也算规划成本);首次主数据写工具(`write`/`set_data`/`edit_data`/`delete_data`)成功 → 退出规划阶段
- 超限:planning 状态下 `planPhaseRounds > maxPlanRevisions` → 下次 `write_todos`/`update_todo` 返回结构化提示「规划阶段已达上限,停止调研/修订,基于当前清单执行」(不强制终止,由 `maxIterations` 总闸兜底)
- 重入:执行后可再 `write_todos` 重新进入(单阶段计数重置,允许多次「规划→执行→再规划」);反复进出刷预算由 `maxIterations` 总闸兜底
- 与 `maxIterations` 正交:本闸管「规划阶段别拖」,总闸管「整体别死循环」

### 3. 自适应规划 prompt 引导(P0,prompt 层)
- `usageHints` 的 planning 段升级为「自适应规划」:简单任务(单字段/明确)直接执行;复杂任务(多步/大改/有歧义/不可逆)先 `write_todos` 拆解;`update_todo` 增量修订
- 复用 `request_human_confirmation`:复杂任务规划出多步方案后,若需用户拍板,先调工具确认计划再执行(humanConfirm 段补「规划方案确认」场景)

### 4. 内置 skill `adaptive-planning`(P0,prompt 层)
- `skills/adaptive-planning/SKILL.md`:文档化「判断复杂度 → 是否规划 → (可选)用户确认方案 → 执行 → 动态增量修订(update_todo)」标准流程
- 入 npm 包 `files`(分发给使用者;集成方按需挂载为 agent initialSkills)

### 5. SDK API + 类型(P0)
- `createChatSdk({ maxPlanRevisions })` 配置项(默认 5)
- `inspect().planPhase`:`{ inPlanning: boolean; rounds: number; limit: number }` 反映当前规划阶段状态(供 DebugDrawer 可观测)
- `types/index.d.ts`:`ChatSdkOptions` 加 `maxPlanRevisions?`;`AgentInfo` 加 `planPhase?`

## Impact

### 改造
- `src/core/harness/todos.ts`:Todo id 生成 + `update_todo` 工具 + `maxPlanRevisions` 状态机 + augmentPrompt 带 id 渲染
- `src/core/harness/state.ts`:`Todo` 增 `id` 字段(输入可选、输出必有,向后兼容)
- `src/core/harness/usageHints.ts`:planning 段升级自适应 + humanConfirm 补规划方案确认
- `src/core/sdk/createChatSdk.ts`:`maxPlanRevisions` 配置透传 `createTodosMiddleware`;`inspect().planPhase`
- `types/index.d.ts`:`ChatSdkOptions` + `AgentInfo`

### 新增
- `update_todo` 工具;`maxPlanRevisions` 配置项;内置 `adaptive-planning` skill;`inspect().planPhase`

### 影响规范
- `openspec/specs/page-agent-core.md`:MODIFY「Planning 以 write_todos 整表替换」→「Planning:整表替换 + 增量更新 + 规划阶段防死循环」;ADD「自适应规划 prompt 引导」

### 向后兼容
- 不传 `maxPlanRevisions` = 默认 5(宽松,典型规划 2-3 轮,几乎不触限)
- 旧 `Todo` 无 id:hydrate 时按 index 补;`write_todos` 不传 id 框架按 index 生成
- `write_todos` 整表替换仍支持(现状);`update_todo` 是新增
- `capabilities.planning: false` → 不装 todos 中间件,`update_todo`/`maxPlanRevisions` 都不生效(现状)

### 测试
- selftest:`update_todo` 增量 / `TODO_NOT_FOUND` / id 生成 / `maxPlanRevisions` 阶段计数 / 超限回灌 / 写工具退出阶段 / 重入
- e2e:`inspect().planPhase` + `inspect().tools` 含 `update_todo` + 默认 usageHints 含自适应规划引导 + `maxPlanRevisions` 配置反映
- browser:planner-demo 走规划流程(write_todos → update_todo → write 执行),新增/扩展 spec

## Non-goals

- **不做** mission-anchor 的任务目标 capture / 压缩豁免 / spawn prepend(⏸ 独立提案;本 change 正交,见 decision-record §5)
- **不做** structured-todos 的 parentId/deps/evidence/handoff/子 agent 写/结构化返回/large-json-edit skill(⏸ 独立提案;本 change 只借 `update_todo` 增量思路)
- **不做** 框架级「复杂度检测中间件」(复杂度判断在 prompt 层;框架检测重蹈 mission capture 启发式误判争议,见 decision-record §0.2)
- **不做** todos 跨 session 持久化(已有 checkpoint)
- **不做** `maxPlanRevisions` 的「按复杂度动态预算」(固定值可配;动态预算为未来演化,见 decision-record §4.4)
- **不做** evidence 校验(防「假装完成」;与 verify 重叠,用户未提;升级路径见 decision-record §4.1)
