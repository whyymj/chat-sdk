# Change: add-structured-todos-tier (Phase 2)

> Todo 层级依赖(parentId/deps)+ 递归渲染。Phase 2 opt-in。
> **状态:已实施(2.19)**。复用 `update_todo` 增量基础(adaptive-planning)。

## Why
复杂多步任务有依赖链(A 依赖 B 必须先完成),扁平 todos 难表达 → LLM 可能漏步骤/乱序。

## What Changes
1. **Todo schema 扩**(`state.ts`):加 `parentId?`/`deps?`/`criteria?`/`evidence?`(可选,向后兼容)
2. **ensureIds 透传**(修旧版只拷 3 字段致层级字段丢)
3. **renderTodos 递归**:有 parentId 缩进 + deps ✓/⏳ 阻塞标注 + evidence/criteria;无 parentId → 扁平 fallback(零破坏)
4. **write_todos/update_todo schema** 加可选层级字段
5. **capabilities.todoDeps** opt-in(usageHints 提示 LLM 用层级)

## Impact
- schema 总含可选字段(向后兼容,LLM 不传则无)
- 扁平 fallback(无 parentId → 现状,零破坏)
- 测试 sec-43(11 项)

## 决策
- schema 总含可选字段(不条件 todoDeps;todoDeps 只控 usageHints 提示)
- renderTodos 根据 todos 实际(parentId 有 → 递归;无 → 扁平)
- 不做 evidence 校验(标 completed 时强制 evidence,~40 行;可选后续)
