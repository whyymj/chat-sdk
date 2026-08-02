# Tasks: add-structured-todos-tier (Phase 2)

> 关联 `proposal.md`。**已实施(2.19)**。

- [x] `state.ts`:Todo 加 parentId/deps/criteria/evidence(可选,向后兼容)
- [x] `todos.ts`:TodoInput + ensureIds 透传(修旧版只拷 3 字段)
- [x] `todos.ts`:renderTodos 递归(parentId 缩进 + deps ✓⏳ + evidence/criteria)+ 扁平 fallback
- [x] `todos.ts`:write_todos/update_todo schema 加可选层级字段
- [x] capabilities.todoDeps opt-in(usageHints 提示)
- [x] inspect().todos 透传 parentId/deps
- [x] 测试 sec-43(11 项:层级输入/递归渲染/deps ✓⏳/evidence/criteria/扁平 fallback/hydrate)
- [x] CHANGELOG + capabilities 注释

## 收口
- [x] 门禁:selftest 992 + tsc 全过
- [x] 归档 + project.md(实测后)
- [x] 真 LLM 实测(复杂任务层级规划,验证 LLM 用 parentId/deps)
