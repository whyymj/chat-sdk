# Change: add-structured-todos-and-subagent-writes

> 📦 **已归档(2026-08-02):被 `complex-agent-roadmap` 定位升级重启取代,落地为新 change(见下方 🔄 块)。作溯源底稿保留,不再实施。**

> ⏸ **状态:已评估暂缓(2026-08-01)**
> **结论**:暂缓(整个 change)
> **理由**:C 组最重、依赖最多(弱依赖 mission-anchor);「子 agent 可写」动「只读隔离」安全边界(writablePaths 白名单增复杂度);todos 结构化依赖 LLM 可靠维护依赖图,evidence/handoff 又是「框架硬约束补偿 LLM」。
> **重启触发**:子 agent「只读 + 返回结论」成为明确功能瓶颈,且 mission-anchor 已落地。重启先做「结构化返回 + update_todo」。
> 决策详情见 [`openspec/deferred.md`](../../deferred.md)。原规划内容保留作底稿,下方不变。

> 🔄 **[2026-08-01 定位升级:重启 —— Phase 2]**
> 定位升级(见 [`doc/complex-agent-roadmap.md`](../../../doc/complex-agent-roadmap.md)),标尺②推翻,本 change 重启授权。
> **调整(重要,去重)**:① **`update_todo` 增量 + Todo.id 已由 `add-adaptive-planning`(2026-08-01 落地)实现** —— 本 change 去掉这部分,剩余:层级 parentId/deps + evidence 校验 + handoff + **subagent 可写**(writablePaths);② 默认「高级 opt-in」(子agent写动安全边界 / 依赖图 LLM 可靠性存疑 → 显式开);③ 内置 large-json-edit skill 与 usageHints 重复,去掉。
> 落地为新 change(`add-structured-todos-tier` + `add-subagent-writable`,Phase 2)。下方旧 ⏸ 评估保留作溯源。

---

> 编排平面改进(Phase 2 of「复杂任务 + 超大 JSON」演进)。直击 P1:todos 无结构化依赖 + subagent 不能写 + 返回未收口。配套:`add-mission-anchor`(Phase 1 主线锚定)、`add-data-paging-and-chunked-write`(数据平面)、`add-cross-round-working-memory`(记忆平面)。本变更弱依赖 mission-anchor(todos 对照 mission)。

## Why

1. **todos 无结构化依赖**。扁平列表,无子任务层级/依赖/优先级;「检索→决策→写入」依赖链难表达;整表替换成本高(步骤多时每次更新重传完整数组)。

2. **可「假装完成」**。框架不校验步骤是否真正完成,只信 LLM 改 status;无 tool result / 写操作 / 子 agent 结论的交叉验证。

3. **子 agent 不能写**。默认只读,「检索子任务 + 写入子任务」无法闭环,主 agent 仍要承担所有 write,token 压力集中在主上下文。

4. **子 agent 返回 unstructured string**。大 JSON 检索结果仍可能超大(虽经 offload,但主 agent 需再 vfs_read);无 `{ conclusion, findings, scopeCompleted, needsParentAction }` 结构化返回。

5. **spawn 后无 mandatory synthesis**。主 agent 收到 spawn 结果后可能忽略、误读或过度展开子结论,无框架约束「对照主线目标 synthesis 再下一步」。

6. **子 agent 不知 parent goal**。(由 `add-mission-anchor` 的 spawn prepend 解决;本变更补充结构化返回 + handoff)

## What Changes

### 1. todos 结构化(P1)

- Todo schema 扩展:`{ id: string; content: string; status: 'pending'|'in_progress'|'completed'; parentId?: string; deps?: string[]; criteria?: string; evidence?: string }`
- `write_todos` 支持增量:`update_todo({ id, status?, evidence? })` 单项更新(减少 token);`write_todos` 仍支持整表替换(向后兼容)
- `id` 自动生成(若 LLM 不传);`parentId`/`deps` 表达层级与依赖
- `augmentPrompt` 注入时渲染层级(缩进)+ 标注依赖阻塞状态

### 2. todo 完成校验(P1,可选)

- `capabilities.todoEvidence`(默认 `false`):开启后 `completed` 状态需附 `evidence`(工具 callId 或读回 hash)
- 框架校验:evidence 引用的 tool callId 必须存在且成功;否则 `TODO_EVIDENCE_MISSING` 拒绝标 completed
- 默认关闭(零开销);复杂任务场景集成方开启

### 3. subagent 可选写权限(P1)

- `subagents` 配置增 `allowedTools?: string[]`(预声明)和 `writablePaths?: string[]`(jsonPath 前缀白名单)
- `spawn_agent`/`spawn_agents` 参数增 `allowedTools?` + `writablePaths?`(单次委派覆盖)
- 子 agent 工具集:默认只读;配置后含 `write`/`draft_write`/`draft_commit`,但 write 限定 `writablePaths` 前缀
- 越界 write 返回 `PATH_OUT_OF_SCOPE`

### 4. subagent 结构化返回(P1)

- 子 agent 返回支持结构化 JSON:`{ conclusion: string; findings?: string[]; scopeCompleted: boolean; needsParentAction?: string }`
- 框架 try/catch 解析:合法 JSON 含 `conclusion` → 结构化;否则按纯文本(向后兼容)
- 结构化返回经 offload 后,主 agent 收到摘要 + vfs 引用(若超大)

### 5. spawn handoff 强制(P1)

- `capabilities.subagentHandoff`(默认 `false`):开启后 spawn 返回后,框架强制下一步为 `update_todo` 或显式 synthesis message
- 实现:`afterToolCall` 检测 spawn 工具返回后,若下一轮 LLM 未调 `update_todo` 也未输出 synthesis 文本,注入 HumanMessage 提醒
- 默认关闭(避免过度约束);复杂任务场景集成方开启

### 6. 内置大 JSON 编辑 skill(P2)

- 内置 skill `large-json-edit`:文档化「分页 read → query 定位 → 分批 patches / draft→commit → read 确认」标准流程
- `usageHints` 在检测到大 JSON 场景(数据体积 > 阈值 或 read 截断)时自动推荐 load 该 skill

## Impact

- **改造**:
  - `src/core/harness/todos.ts`:Todo schema 扩展;`update_todo` 工具;层级渲染;evidence 校验
  - `src/core/harness/subagent.ts`:结构化返回解析;`allowedTools`/`writablePaths` 配置;write 限定
  - `src/core/harness/usageHints.ts`:spawn synthesis 规则;大 JSON skill 推荐
  - `src/core/sdk/createChatSdk.ts`:`capabilities.todoEvidence`/`subagentHandoff`;内置 skill 注册
- **新增**:`update_todo` 工具;结构化返回;`allowedTools`/`writablePaths` 配置;内置 `large-json-edit` skill;2 个 capabilities 开关
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 3 条 Requirement(结构化 todos / 子 agent 写权限 / 结构化返回 + handoff)
- **向后兼容**:
  - Todo 不传 id/parentId/deps = 现状(扁平列表)
  - `write_todos` 整表替换仍支持;`update_todo` 是新增
  - 子 agent 默认只读(现状);配置后才有写权限
  - 结构化返回向后兼容(纯文本仍支持)
  - 两个 capabilities 默认关闭(零开销)
- **测试**:selftest 加 todos 结构化/evidence/子 agent 写权限/结构化返回/handoff 断言;e2e 加 inspect().todos 结构 + subagent 写权限

## Non-goals

- **不做** todos 自动推进(框架不自动改 status,仍由 LLM 驱动;evidence 只校验「标 completed 时有依据」)
- **不做** 子 agent 递归写(子 agent 仍排除 spawn,防递归)
- **不做** handoff 的 LLM 判定(纯规则:检测下一轮是否 update_todo/synthesis;不调 LLM 判断)
- **不做** 内置 skill 的多语言(中文文档,后续按需补英文)
