---
name: adaptive-planning
description: 自适应规划标准流程——判断任务复杂度决定是否先规划,规划后可选用户确认,执行中动态增量修订
---

# 自适应规划流程

> 内置 skill(add-adaptive-planning)。文档化 agent 运行时的自适应规划标准流程。
> 集成方按需挂载:`createChatSdk({ skills: [adaptivePlanningSkill] })`,或从 npm 包 `skills/adaptive-planning` 取。

## 1. 判断复杂度(自适应分流)

- **简单**(单字段、明确、可逆,如「标题改红色」)→ 跳过规划,直接 `read` → `write`。
- **复杂**(多步、大改、有歧义、不可逆,如「把首页改成营销活动页」)→ 进入规划。

判断由你(LLM)完成,框架不强加。拿不准时倾向于规划(复杂任务不规划的代价 > 简单任务多规划的代价)。

## 2. 规划(write_todos)

拆解为**可执行**步骤,每步一个明确动作(`read` 某字段 / `write` 某路径 / `query` 筛选)。首个任务标 `in_progress`。

```
write_todos({ todos: [
  { content: '读取当前 components 结构', status: 'in_progress' },
  { content: '给 hero 组件加标题字段', status: 'pending' },
  { content: 'read 确认写入', status: 'pending' },
]})
```

框架给每步自动生成稳定 id(`t-1`/`t-2`...),也可显式传语义化 id(如 `read-structure`)。

## 3.(可选)用户确认

若方案有歧义 / 多选 / 高风险 → `request_human_confirmation` 给选项,用户确认后再执行:

```
request_human_confirmation({ question: '活动页主色调?', options: ['红色喜庆', '蓝色科技', '金色奢华'], recommendation: '红色喜庆' })
```

## 4. 执行

按清单逐步 `read` / `write`。**完成一项立即标完成**(不必重传整个清单):

```
update_todo({ id: 't-1', status: 'completed' })
```

## 5. 动态修订(执行中完善)

执行中发现步骤要改 / 补 / 细分 → `update_todo` 增量改单项,不必重传整个清单:

- 改描述:`update_todo({ id: 't-2', content: '给 hero 组件加标题字段 + 副标题' })`
- 补步骤:用 `write_todos` 重传完整清单(新增项会获得新 id)
- 拆分:把一项标 completed,用 `write_todos` 补更细的子步骤

## 防死循环(框架兜底)

规划阶段有轮次预算(`maxPlanRevisions`,默认 5)。**勿反复调研 / 改计划而不执行**——超限框架会回灌「规划阶段已达上限,基于当前清单开始执行」。

规划充分后即开始 `write` 落地(写工具成功即退出规划阶段,预算重置)。

## 何时不用本 skill

- 纯查询任务(只 read 不 write):直接 read/query/search,不必规划
- 单步明确任务:直接 write
- 已有领域 skill(如集成方的业务 skill)指导流程时:遵循那个
