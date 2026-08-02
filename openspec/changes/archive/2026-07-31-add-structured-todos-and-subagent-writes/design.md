# Design: add-structured-todos-and-subagent-writes

> 核心约束:**todos 结构化是扩展,不破坏扁平用法**;**子 agent 写权限是 opt-in,默认只读**;**结构化返回向后兼容纯文本**;**handoff 是 opt-in,默认不约束**。所有改动向后兼容,不传新字段 = 现状行为。

## 1. Todo schema 扩展

```ts
interface Todo {
  id: string                     // 自动生成(nanoid 或 idx);LLM 可显式传
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  parentId?: string              // 父 todo id(表达层级)
  deps?: string[]                // 依赖的 todo id(必须先完成)
  criteria?: string              // 完成标准(可选,LLM 自填)
  evidence?: string              // 完成证据(tool callId / 读回 hash);capabilities.todoEvidence 开启时必填
}
```

**向后兼容**:不传 id/parentId/deps/criteria/evidence = 现状(扁平列表);`write_todos` 整表替换仍支持。

## 2. update_todo 工具(增量更新)

```ts
update_todo({ id: string, status?: Todo['status'], evidence?: string })
// 单项更新,减少 token(不必重传整个 todos 数组)
// status 改 completed 时,若 capabilities.todoEvidence 开启,校验 evidence
```

**装载**:`update_todo` 与 `write_todos` 同属 todos 中间件贡献的工具;`inspect().tools` 含两者。

**防并行**:`wrapToolCall` 限制一轮内 `update_todo` + `write_todos` 不可同时调用(防状态冲突)。

## 3. 层级渲染

```ts
function renderTodos(todos: Todo[]): string | undefined {
  if (!todos.length) return undefined
  // 按 parentId 分组,递归渲染
  const roots = todos.filter(t => !t.parentId)
  const childrenOf = (id) => todos.filter(t => t.parentId === id)
  const lines: string[] = []
  const render = (todo: Todo, depth: number) => {
    const indent = '  '.repeat(depth)
    const depStatus = todo.deps?.length
      ? ` (依赖: ${todo.deps.map(d => todos.find(t => t.id === d)?.status === 'completed' ? '✓' : '⏳').join(',')})`
      : ''
    const ev = todo.evidence ? ` [证据: ${todo.evidence}]` : ''
    lines.push(`${indent}- [${todo.status}] ${todo.content}${depStatus}${ev}`)
    childrenOf(todo.id).forEach(c => render(c, depth + 1))
  }
  roots.forEach(r => render(r, 0))
  return ['## 当前任务清单(write_todos / update_todo 管理)', ...lines, '规则:...'].join('\n')
}
```

## 4. todo evidence 校验

**`capabilities.todoEvidence`(默认 false)**:
- 开启后,`write_todos`/`update_todo` 标 `completed` 时需附 `evidence`
- 校验:evidence 引用的 tool callId 必须在当前会话 messages 中存在且对应 ToolMessage 无错误
- 校验失败:`TODO_EVIDENCE_MISSING` 错误,不更新 status
- 默认关闭(零开销);复杂任务场景集成方开启

## 5. subagent 可选写权限

**配置层**:
```ts
// 预声明 subagents
subagents: [{
  id: 'writer',
  description: '写入子 agent',
  allowedTools: ['read', 'write', 'draft_write', 'draft_commit'],  // 默认只读;配置后含写
  writablePaths: ['components.*'],                                  // write 限定 jsonPath 前缀
}]

// 运行时 spawn
spawn_agent({ prompt, allowedTools?, writablePaths? })  // 单次覆盖
```

**工具集构造**(`subagent.ts`):
```ts
const childTools = (config.allowedTools ?? DEFAULT_READONLY_TOOLS)
  .map(name => allTools.find(t => t.name === name))
  .filter(Boolean)
// write/draft_commit 工具包装:限定 writablePaths 前缀
if (config.writablePaths) {
  childTools = childTools.map(t => t.name === 'write' || t.name === 'draft_commit'
    ? wrapWithPathGuard(t, config.writablePaths)
    : t)
}
```

**path guard**:
```ts
function wrapWithPathGuard(tool, prefixes: string[]) {
  return new Tool({ ...tool, func: async (args) => {
    const targetPath = args.jsonPath || ''
    if (!prefixes.some(p => targetPath === p || targetPath.startsWith(p + '.') || targetPath.startsWith(p + '['))) {
      return { error: 'PATH_OUT_OF_SCOPE', message: `子 agent 仅可写 ${prefixes.join(', ')}` }
    }
    return tool.func(args)
  }})
}
```

## 6. subagent 结构化返回

**返回契约**:
```ts
interface SubagentResult {
  conclusion: string              // 最终结论(必填)
  findings?: string[]             // 关键发现(可选)
  scopeCompleted: boolean         // 子任务范围是否完成
  needsParentAction?: string      // 需要主 agent 后续动作(可选)
}
```

**解析**(`subagent.ts`):
```ts
// 子 agent 最终文本
const text = childAgent.getFinalText()
try {
  const parsed = JSON.parse(text)
  if (parsed && typeof parsed.conclusion === 'string') {
    return { structured: parsed, text }  // 结构化
  }
} catch { /* not JSON */ }
return { structured: undefined, text }  // 纯文本(向后兼容)
```

**主 agent 收到**:ToolMessage content 为结构化 JSON 字符串或纯文本;LLM 按格式解析。超大时经 offload 外存 vfs。

## 7. spawn handoff 强制

**`capabilities.subagentHandoff`(默认 false)**:
- 开启后,`afterToolCall` 检测 spawn 工具返回
- 下一轮 `beforeModel`:检查上一轮是否调了 `update_todo` 或输出含 synthesis 关键词(「综上」「基于子结论」「synthesis」)
- 未满足则注入 HumanMessage:「子 agent 已返回,请先对照主线目标 synthesis,再 update_todo 或下一步」

**默认关闭**:避免过度约束简单场景;复杂任务集成方开启。

## 8. 内置 large-json-edit skill

**内容**(中文,Markdown):
```
# 大 JSON 编辑流程
1. 分页 read:read({ jsonPath, offset, limit }) 定位目标
2. query/search 精确查找:query_data({ jsonPath, filter }) / search_data({ text })
3. 分批写入:write({ patches: [...] }) 增量 patch;或 draft_write + draft_commit 分块构建
4. read 确认:read({ jsonPath: affectedPath }) 验证
5. 跨轮保留:工作记忆自动记录 locatedPaths + lastHash,勿重复检索
```

**自动推荐**(`usageHints.ts`):检测到 `read` 返回截断(hasMore)或数据体积 > 阈值时,注入「建议 load_skill('large-json-edit')」。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Todo 层级渲染复杂 | 无 parentId 时退化为扁平(现状);有 parentId 才缩进 |
| evidence 校验开销 | 默认关闭;开启后只校验 callId 存在,不校验语义 |
| 子 agent 写越界 | writablePaths 前缀白名单;越界 PATH_OUT_OF_SCOPE |
| 结构化返回解析失败 | try/catch 降级纯文本;不破坏现有 spawn 返回契约 |
| handoff 误判 synthesis | 关键词列表宽泛(综上/基于/对照/synthesis);默认关闭 |
| 内置 skill 体积 | < 500 字符;offload 阈值下常驻 |
