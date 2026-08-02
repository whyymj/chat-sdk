# Specification Delta: page-agent-core

> 自适应规划:todos 增量更新(`update_todo`)+ 规划阶段防死循环(`maxPlanRevisions`)+ 自适应 prompt 引导。
> 选型见 `decision-record.md`;实现见 `design.md`。

## Requirement: Planning 整表替换 + 增量更新 + 规划阶段防死循环(原:Planning 以 write_todos 整表替换)

Planning 中间件提供两个互补工具管理任务清单:① `write_todos` 整表替换(拆解多步任务);② `update_todo({ id, content?, status? })` 按 id 增量更新单项(执行中动态修订,不必重传整个清单)。`Todo` 含稳定 `id`(`write_todos` 时框架按 index 生成 `t-N`,LLM 也可显式传),`augmentPrompt` 渲染带 id 供 LLM 引用 update。`update_todo` 的 id 在当前清单找不到 → `TODO_NOT_FOUND`(返回当前 id 列表);一轮内 `update_todo` + `write_todos` 不可同时调用(状态冲突)。

**规划阶段防死循环**(`maxPlanRevisions`,默认 5,可配):针对「规划动作」的专项预算,与总轮次总闸 `maxIterations` 正交。状态机:首次 `write_todos` 进入规划阶段(`inPlanning`);每轮 `beforeModel` 计 `planPhaseRounds++`(含 read/query/search 调研轮——调研也算规划成本);首次主数据写工具(`write`/`set_data`/`edit_data`/`delete_data`)成功 → 退出规划阶段;planning 状态下 `planPhaseRounds > maxPlanRevisions` → `write_todos`/`update_todo` 返回结构化提示「规划阶段已达上限,停止调研/修订,基于当前清单执行」(不强制终止,由 `maxIterations` 兜底);执行后可再 `write_todos` 重入(单阶段计数重置,允许多次「规划→执行→再规划」)。

`capabilities.planning: false` → 不装 Planning 中间件(两工具与防死循环均不生效,行为同现状)。`inspect().planPhase` 反映 `{ inPlanning, rounds, limit }`。旧 `Todo`(无 id)hydrate 时按 index 补(向后兼容)。

## Requirement: 自适应规划 prompt 引导(prompt 层软约束,非框架硬约束)

`usageHints` 中间件按 `capabilities.planning`(默认开)注入「自适应规划」引导段:简单/明确任务(改单字段、调样式、查值)直接 `read`/`write` 执行,不必 `write_todos`;复杂任务(多步、大改、有歧义、不可逆)先 `write_todos` 拆解,逐项 `in_progress → completed`;执行中发现步骤要改/补/细分用 `update_todo` 增量改单项;规划出多步方案若需用户拍板,先 `request_human_confirmation` 给方案选项,确认后再执行。该引导为 **prompt 层软约束**(非框架硬约束),可随 prompt 迭代;复杂度判断由 LLM 完成,框架不做启发式检测(避免 mission-anchor 评估的 capture 误判争议)。

内置 skill `adaptive-planning`(入 npm 包 `files`,与 `page-agent-sdk-integrate` 同级)文档化「判断复杂度 → 是否规划 →(可选)用户确认方案 → 执行 → 动态增量修订」标准流程,集成方按需挂载为 agent initialSkills。
