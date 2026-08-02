# Design: add-adaptive-planning

> 核心约束:**框架只做不可省的(增量入口 + 防死循环),自适应判断 / 方案确认 / 标准流程全在 prompt 层**。向后兼容:不传新字段/新配置 = 现状行为。选型依据见 `decision-record.md`。

## 1. Todo schema:id 字段(state.ts)

```ts
export interface Todo {
  id: string            // 稳定标识(write_todos 时框架按 index 生成;LLM 可显式传;hydrate 旧数据补)
  content: string
  status: TodoStatus
}
```

**向后兼容**:`id` 为「输出必有、输入可选」——`write_todos` 入参的 todos 项 `id` 可选(不传则框架生成);hydrate 的旧 todos(无 id)按 index 补。`HarnessState`/`createInitialState` 无需改(todos 默认空数组)。

## 2. id 生成策略

- `write_todos` 整表替换:遍历 input,项无 id → 生成 `t-${index + 1}`(基于数组位置的可读稳定 id)
- LLM 显式传 id → 保留(允许语义命名,如 `research` / `write-title`)
- hydrate 旧 todos(无 id):`applySnapshot` 时按 index 补 `t-N`
- `update_todo({ id })` 在当前 todos 找不到 → `TODO_NOT_FOUND`(返回当前所有 id 供 LLM 修正)

**为什么基于 index 而非 nanoid**:① 可读(LLM 看 augmentPrompt 渲染就懂);② 零依赖;③ `write_todos` 整表替换语义下每次重生成,位置稳定即可;④ `update_todo` 在「当前数组」内定位,无需跨 `write_todos` 持久。

## 3. `update_todo` 工具(todos.ts)

```ts
const updateTodoTool = tool(
  async ({ id, content, status }) => {
    const idx = todos.findIndex((t) => t.id === id)
    if (idx < 0) return `错误:找不到 id="${id}" 的任务。当前任务 id:${todos.map((t) => t.id).join(', ') || '(空)'}`
    if (content !== undefined) todos[idx].content = content
    if (status !== undefined) todos[idx].status = status
    return `已更新任务 ${id}:[${todos[idx].status}] ${todos[idx].content}`
  },
  {
    name: 'update_todo',
    description: '增量更新单个任务(按 id)。修改 content/status 不必重传整个清单。id 见当前任务清单渲染。与 write_todos 不可同轮调用。',
    schema: z.object({
      id: z.string().describe('目标任务 id(见当前任务清单)'),
      content: z.string().optional().describe('新任务描述(不传则不改)'),
      status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('新状态(不传则不改)'),
    }),
  },
)
```

**防并行**(`wrapToolCall`):一轮内 `update_todo` + `write_todos` 不可同时调(整表替换会清掉增量更新的基准)→ 第二个返回错误提示。

## 4. `maxPlanRevisions` 状态机(todos 中间件闭包)

```ts
let inPlanning = false
let planPhaseRounds = 0
// 退出规划阶段的「主数据写」工具(transform 落地)
const PLAN_EXIT_TOOLS = new Set(['write', 'set_data', 'edit_data', 'delete_data'])
```

- `createTodosMiddleware({ maxPlanRevisions = 5 })`:接收预算
- `beforeModel`:若 `inPlanning` → `planPhaseRounds++`(含期间 read/query/search 调研轮)
- `wrapToolCall`:
  - `write_todos`:若 `!inPlanning` → 进入规划(`inPlanning=true, planPhaseRounds=1`);若 `inPlanning && planPhaseRounds > maxPlanRevisions` → 返回「规划阶段已达上限(N 轮),停止调研/修订,基于当前清单开始执行」**不执行写入**
  - `update_todo`:planning 状态下同样受 `maxPlanRevisions` 约束(防用 update_todo 绕过);非 planning(执行阶段)不受约束(正常标 completed)
  - `PLAN_EXIT_TOOLS` 成功(status=done):`inPlanning=false, planPhaseRounds=0`(退出,开始执行了)

**阶段边界灰区处理**:
- 纯查询任务(LLM 只 read 不 write)→ 不退出规划;但 read/query 属调研,计入 `planPhaseRounds` 合理(调研也是成本),超限回灌「停止调研,给结论」——符合「防光调研不动手」语义
- `eval_script`:transform 模式虽写,但 query 模式只读,框架不便区分 → **本期不列入 PLAN_EXIT_TOOLS**(transform 在执行阶段使用,planning 阶段罕见);未来需细化时再按 mode 判断
- 终止性输出(无 tool_calls 的 finish):agent 自然 return,不影响计数

**与 `maxIterations` 正交**:本闸管「规划阶段别拖」(细粒度,默认 5 轮);总闸管「整体别死循环」(粗粒度,默认 30)。LLM 反复「规划→写一下→再规划」刷预算时,总闸兜底。

## 5. augmentPrompt 渲染(带 id)

```ts
function renderTodos(todos: Todo[]): string | undefined {
  if (!todos.length) return undefined
  const lines = todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`)
  return [
    '## 当前任务清单(write_todos 整表替换 / update_todo 增量改单项)',
    lines.join('\n'),
    '规则:开始前用 write_todos 拆解;首个任务标 in_progress;完成一个立即 update_todo 标 completed(不必重传整个清单);保持至少一个 in_progress 直到全部完成。',
  ].join('\n')
}
```

→ LLM 看到 `#t-1` 即知 `update_todo({ id: 't-1', status: 'completed' })`。

## 6. 配置 + inspect(createChatSdk.ts)

- `options.maxPlanRevisions`(默认 5)透传:`createTodosMiddleware({ maxPlanRevisions: options.maxPlanRevisions ?? 5 })`
- `inspect().planPhase`:`{ inPlanning, rounds: planPhaseRounds, limit: maxPlanRevisions }`(todos 中间件暴露 getter,或经 `agentRef.current.getState()` 扩展)
- `AgentInfo` 增 `planPhase?` 字段(types/index.ts)

## 7. usageHints 自适应规划段(usageHints.ts)

`planning` 段(原一行)升级为多行自适应引导(仅 `caps?.planning !== false` 时注入):

```
【自适应规划】按任务复杂度决定是否先规划,不要对简单任务过度编排:
  · 简单/明确任务(改单字段、调样式、查值)→ 直接 read/write 执行,不必 write_todos。
  · 复杂任务(多步、大改、有歧义、不可逆)→ 先 write_todos 拆解,逐项 in_progress → completed。
  · 执行中发现步骤要改/补/细分 → 用 update_todo({id,...}) 增量改单项,不必重传整个清单。
  · 规划出多步方案若需用户拍板 → 先 request_human_confirmation 给方案选项,确认后再执行。
```

`humanConfirm` 段补第 4 类场景:

```
4) 规划出多步方案需用户确认时:把整个方案(或分步)作为 option 调 request_human_confirmation,确认后再执行。
```

## 8. 内置 skill `adaptive-planning`(skills/adaptive-planning/SKILL.md)

```markdown
---
name: adaptive-planning
description: 自适应规划标准流程——判断任务复杂度决定是否先规划,规划后可选用户确认,执行中动态增量修订
---

# 自适应规划流程

## 1. 判断复杂度
- 简单(单字段/明确/可逆)→ 跳过规划,直接 read → write
- 复杂(多步/大改/歧义/不可逆)→ 进入规划

## 2. 规划(write_todos)
拆解为可执行步骤,首个标 in_progress。每步一个明确动作。

## 3.(可选)用户确认
若方案有歧义/多选/高风险 → request_human_confirmation 给选项,确认后再执行。

## 4. 执行
按清单逐步 read/write。完成一项立即 update_todo({id, status:'completed'})。

## 5. 动态修订
执行中发现步骤要改/补/细分 → update_todo({id, content/status}) 增量改,不必重传整个清单。
```

入 `package.json` `files`(与 `page-agent-sdk-integrate` 同级)。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `maxPlanRevisions` 误伤正常长规划 | 默认 5 宽松(典型规划 2-3 轮够);可配;超限只回灌不强制终止(`maxIterations` 兜底) |
| 阶段边界灰区(纯查询不退出) | 写工具退出 + 调研计入合理 + `maxIterations` 兜底;`eval_script` 本期不列入(简化) |
| id 基于 index 在数组变动时不稳 | `write_todos` 整表替换每次重生;`update_todo` 在当前数组定位;不跨 `write_todos` 持久 |
| `update_todo` + `write_todos` 同轮冲突 | `wrapToolCall` 拒同轮同时调(返回错误提示) |
| `Todo.id` 向后兼容(旧持久化数据) | hydrate 按 index 补;id 为输出必有、输入可选;selftest 覆盖 hydrate 补 id |
| `inspect().planPhase` 实时性 | todos 中间件暴露闭包 getter;`infoTick++` 触发 DebugDrawer 刷新(与现有动态重配一致) |

## 10. 与现有机制的兼容性

| 现有机制 | 兼容性 |
|---|---|
| `write_todos` 整表替换 | 并存:`update_todo` 是增量补充;两者都支持,`wrapToolCall` 防同轮冲突 |
| `maxIterations` 总闸 | 正交:`maxPlanRevisions` 细粒度(规划阶段),总闸粗粒度(整体);两者叠加 |
| `checkpoint` | 不变:todos(含 id)随 checkpoint 快照;hydrate 时补 id |
| `verify` | 不变:本 change 不动 verify(evidence 校验为未来升级口,见 decision-record §4.1) |
| `humanConfirm` / `approval` | 增强:复用 `request_human_confirmation`,补「规划方案确认」引导;不新建强制 |
| `subagent` | 不变:子 agent 工具子集是否含 update_todo 由 allowedTools 决定(默认含,子 agent 也能规划) |
