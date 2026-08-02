# Tasks: add-structured-todos-and-subagent-writes

> 顺序:期一(todos 结构化 + update_todo)→ 期二(evidence 校验)→ 期三(子 agent 写权限)→ 期四(结构化返回)→ 期五(handoff + 内置 skill)→ 期六(测试 + 文档 + 门禁)。
> 全程向后兼容:不传新字段 = 现状行为;两个 capabilities 默认关闭。

## 期一 — todos 结构化 + update_todo(P1)

- [ ] `src/core/harness/todos.ts`:Todo schema 扩展(id/parentId/deps/criteria/evidence);id 自动生成(nanoid 或 idx)
- [ ] `src/core/harness/todos.ts`:新增 `update_todo({ id, status?, evidence? })` 工具(单项更新)
- [ ] `src/core/harness/todos.ts`:`renderTodos` 层级渲染(有 parentId 缩进;无 parentId 扁平);依赖阻塞状态标注
- [ ] `wrapToolCall`:限制一轮内 `update_todo` + `write_todos` 不可同时调用
- [ ] selftest:todo 结构化(id/parentId/deps);update_todo 单项更新;层级渲染;防并行
- [ ] 门禁:`npm run test:types` + `npm test`

## 期二 — todo evidence 校验(P1,可选)

- [ ] `src/core/sdk/createChatSdk.ts`:`capabilities.todoEvidence`(默认 false)
- [ ] `src/core/harness/todos.ts`:`write_todos`/`update_todo` 标 completed 时校验 evidence(callId 存在 + ToolMessage 无错);失败 `TODO_EVIDENCE_MISSING`
- [ ] selftest:evidence 校验通过/失败;capabilities.todoEvidence: false 不校验
- [ ] 门禁:`npm run test:types` + `npm test`

## 期三 — subagent 可选写权限(P1)

- [ ] `src/core/harness/subagent.ts`:`SubagentConfig` 增 `allowedTools?: string[]` + `writablePaths?: string[]`
- [ ] `spawn_agent`/`spawn_agents`/`use_<id>` 参数增 `allowedTools?` + `writablePaths?`(单次覆盖)
- [ ] 子 agent 工具集构造:默认只读;配置后含 write/draft_write/draft_commit
- [ ] `wrapWithPathGuard`:write/draft_commit 限定 writablePaths 前缀;越界 `PATH_OUT_OF_SCOPE`
- [ ] selftest:子 agent 默认只读;配置 allowedTools 含 write;writablePaths 越界拒绝
- [ ] e2e:inspect().subagent 含 allowedTools/writablePaths 配置
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`

## 期四 — subagent 结构化返回(P1)

- [ ] `src/core/harness/subagent.ts`:子 agent 返回 try/catch 解析 JSON;含 `conclusion` 字段为结构化;否则纯文本
- [ ] `SubagentResult` 接口:`{ conclusion, findings?, scopeCompleted, needsParentAction? }`
- [ ] 超大结构化返回经 offload 外存 vfs(主 agent 收摘要 + vfs 引用)
- [ ] selftest:结构化返回解析;纯文本降级;超大 offload
- [ ] 门禁:`npm run test:types` + `npm test`

## 期五 — spawn handoff + 内置 skill(P1-P2)

- [ ] `src/core/sdk/createChatSdk.ts`:`capabilities.subagentHandoff`(默认 false)
- [ ] `src/core/harness/subagent.ts`:`afterToolCall` 检测 spawn 返回;下一轮 `beforeModel` 检查 update_todo/synthesis 关键词;未满足注入 HumanMessage 提醒
- [ ] 内置 skill `large-json-edit`:Markdown 文档(分页 read → query → 分批 patches/draft→commit → read 确认)
- [ ] `src/core/harness/usageHints.ts`:read 截断/数据超阈值时推荐 load_skill('large-json-edit')
- [ ] selftest:handoff 注入提醒;无 synthesis 关键词触发;有则不触发;skill 推荐
- [ ] 门禁:`npm run test:types` + `npm test`

## 期六 — 测试同步 + 文档 + 门禁

- [ ] selftest(新模块 sec-32 或扩展):
  - todos 结构化(id/parentId/deps/criteria/evidence)+ 层级渲染
  - update_todo 单项更新 + 防并行
  - evidence 校验(开/关)
  - 子 agent 写权限(默认只读/配置含 write/writablePaths 越界)
  - 结构化返回解析 + 纯文本降级
  - handoff 注入提醒(开/关)
  - 内置 skill 注册 + 推荐
  - runner 注册 + 计数同步
- [ ] e2e:inspect().todos 结构;inspect().subagent allowedTools/writablePaths;capabilities 反映
- [ ] `CLAUDE.md`:架构要点更新(todos 结构化 / 子 agent 写权限 / handoff / 内置 skill);测试矩阵/计数同步
- [ ] `doc/architecture.md`:编排平面改进说明
- [ ] `doc/usage-guide.md`:新增 §「结构化 todos + 子 agent 写权限 + handoff」
- [ ] `README.md` / `README.zh-CN.md`:特性列表加「结构化 todos + 子 agent 写权限」
- [ ] `skills/page-agent-sdk-integrate/references/api.md`:加 update_todo 行;subagent allowedTools/writablePaths 说明
- [ ] `CHANGELOG.md`:新增条目
- [ ] 门禁全跑:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports` → `npm run test:types` → `npm run test:size`
- [ ] openspec 归档 + specs 合入
