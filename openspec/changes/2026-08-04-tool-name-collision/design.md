# Design: tool-name-collision(自定义 tool 与内置 tool 重名处理)

> **核心**:装配期 Map 收敛为「后注册覆盖先注册」,执行与标注天然一致;运行时 API 语义显式化。零 API 新增零删除,对齐 page-agent 覆盖语义。评审修正:核对装配链源码 + MCP 异步注入时机。

## 1. 装配链现状(证据,逐环节核对)

```
createChatSdk 构造(同步):
  builtinTools = selectBuiltinTools(...)              # dataOps(fetch/dom/inspect 按 caps)
  userTools    = [...(options.tools || [])]           # 无去重
  actionTools  = actionsToTools(options.actions ?? {})  # 无去重
  allTools = [builtin, user, action, humanConfirm?, checkpoint]

mount 异步 core.initDone:
  mcpTools = 连接后收集(重名工具直接 push)
  allTools = rebuildExtraTools()  # [builtin, user, action, humanConfirm, checkpoint, mcp]
  core.agent = createAgent({ tools: allTools, ... })

createAgent:
  llmWithTools = llm.bindTools(allTools)   # 两个同名定义一起 bind → 模型困惑
coreExecTool:
  target = allTools.find(t => t.name === ctx.name)  # 第一个匹配 → builtin 赢
toolSources:
  builtin→'builtin', user→'user', action→'action', mcp→'mcp:<label>'  # 后覆盖前,与执行不一致
```

**结论**:当前是「三不管」——绑定层重复定义、执行层 builtin 赢、标注层显示后注册来源。语义未定义。

## 2. 装配期确定性(核心改动)

### 2.1 收敛纯函数(可单测)

```ts
// src/core/sdk/toolRegistry.ts(新)
/** 按装配序后注册覆盖先注册,返回唯一工具集 + 覆盖告警列表 */
export function dedupeTools(
  groups: { label: string; tools: StructuredToolInterface[] }[],
): { tools: StructuredToolInterface[]; collisions: { name: string; winner: string; loser: string }[] }
```

- 遍历 `groups`(按装配序 `builtin` → `user` → `action` → `humanConfirm/checkpoint` → `mcp`),`Map.set(name, tool)` 后注册覆盖。
- 覆盖时记录 `collisions`(含 winner/loser 来源标签)返回,供上层 warn。
- 纯函数,无副作用,selftest 直接测。

### 2.2 createChatSdk 装配改调

```ts
const { tools: mergedTools, collisions } = dedupeTools([
  { label: 'builtin', tools: builtinTools },
  { label: 'user', tools: userTools },
  { label: 'action', tools: actionTools },
  { label: 'humanConfirm', tools: humanConfirmTool ? [humanConfirmTool] : [] },
  { label: 'checkpoint', tools: checkpointTools },
])
if (collisions.length) console.warn('[page-agent-sdk] 工具重名,后注册覆盖:', collisions)
// debug 模式:每条 detail
allTools = mergedTools
```

- `rebuildExtraTools()`(setTools/mcp 注入时复用)同样改调 `dedupeTools`,mcp 组放最后 → MCP 工具覆盖内置/user/action。
- **注意**:`humanConfirm` / `checkpoint` 工具名(`restore_last_checkpoint` 等)是内置专属,一般不会与用户工具撞;但仍纳入收敛统一处理(若用户刻意重名,覆盖语义同样生效 + warn)。

### 2.3 执行与标注天然一致

- `coreExecTool` 的 `find(name)` 不变 —— 装配后唯一,执行的就是收敛后的那份。
- `toolSources` 在收敛**后**按最终生效者标注:对每个 `collisions`,把被覆盖者的来源改成胜者来源。简化:收敛后遍历最终工具集重建 `toolSources`(先清空再按最终来源 set),消除「标注 vs 执行」漂移。

## 3. 运行时 API 语义显式化

### 3.1 `addTool`(去重范围升级)

```ts
addTool(tool) {
  // 与最终工具集按名比较,而非仅 userTools
  if (allTools.some(t => t.name === tool.name)) {
    console.warn(`[page-agent-sdk] 工具 "${tool.name}" 已存在,新工具覆盖`)
  }
  userTools = userTools.filter(t => t.name !== tool.name).concat(tool)  // 移除旧 user 同名,加入新
  allTools = dedupeTools([...])  // 走统一收敛
  rebind()
}
```

- 重名覆盖对**内置工具**同样生效:filter 掉 userTools 中的同名 + 收敛时 user 覆盖 builtin。
- 保留「userTools 内重复不 push」的旧行为(现 filter 天然满足)。

### 3.2 `removeTool(name)`(可删内置)

```ts
removeTool(name): boolean {
  // 1. 若 userTools 中有 → 移除(user 工具,现状)
  // 2. 否则若内置/action/mcp 中有 → 从最终工具集移除该内置实现(等价 page-agent「传 null 删内置」)
  //    实现:userTools 里 push 一个同名「空实现占位」?否 —— 直接改 allTools 剔除,并标注 sources 移除
  const removed = allTools.some(t => t.name === name)
  if (!removed) return false
  // 从 builtin/action/mcp 中剔除:维护一个「禁用集」disabledNames,装配时过滤
  disabledNames.add(name)
  allTools = rebuild()  // rebuild 时过滤 disabledNames
  toolSources.delete(name)
  rebind()
  return true
}
```

- **实现要点**:直接 splice allTools 会在下次 rebuild 时回来(builtin 源固定生成)。所以用 `disabledNames: Set<string>` —— 装配/rebuild 时对 builtin/action/mcp 组过滤掉 disabledNames;对 userTools 组,removeTool 已从 userTools 数组移除,无需 disabledNames。
- 语义:移除后内置工具不再出现在最终工具集 → LLM 看不到、也调不到 → 等价「禁用内置」。`inspect().tools` 不含。
- 边界:`removeTool('restore_last_checkpoint')` 等内置专属工具同样可删(用户明确要求)。

### 3.3 `setTools`(整体替换)

- 走统一收敛;替换后重算 collisions + warn。现有「内置不动」的约束保持(只替换 user 组,内置组仍由 caps 生成)。

## 4. 可观察性

- `inspect().tools`:收敛后唯一工具集(现有机制,无需新字段)。重名场景下 e2e 断言只含一个。
- `toolSources`:收敛后重建,来源 = 最终生效者。DebugDrawer 展示与实际一致。
- `console.warn` + `debug` 详报:覆盖发生时明确告知集成方「谁覆盖了谁」。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重名用户行为改变(从「两个共存」变「后者覆盖」) | 修正未定义行为,方向对齐 page-agent;重名是配置瑕疵,覆盖语义更可预期 |
| `removeTool` 语义扩展破坏现有「删用户工具」用法 | 现有用法(删 userTools 内工具)完全兼容;新增「可删内置」是增量能力 |
| disabledNames 泄漏(builtin 源固定生成,rebuild 回来) | disabledNames 在装配/rebuild 统一过滤,单点控制 |
| toolSources 重建遗漏 | 收敛后统一重建(先 clear 再 set),消除两处漂移 |
| MCP 异步注入时机(createAgent 构造前) | mcpTools 在 core.initDone 中收集后调 rebuildExtraTools 走收敛;createAgent 只收到唯一工具集 |

## 6. 与现有机制关系

| 机制 | 关系 |
|---|---|
| `capabilities` | 内置工具仍由 caps 决定装载;重名收敛是「装载后合并」层,不改变 caps 语义 |
| `actions` | action 工具纳入收敛(user 与 action 重名时 action 赢);集成方可在 actions 中覆盖内置工具行为 |
| MCP | mcp 组最后 → MCP 工具覆盖内置/user/action;这与「连外部 server 注入能力」的直觉一致(外部能力优先级高) |
| 预声明子 agent | 子 agent 工具子集由中间件筛选;收敛在 createChatSdk 层,子 agent 内部工具同样经受(若子 agent 也走 createAgent 的 allTools 构造) |
| `doc/page-agent-architecture-comparison.md` §5.1 | 对比文档已把「对齐覆盖语义」列为借鉴项,落地后更新状态 |

## 7. 关键实现文件

| 文件 | 改动 |
|---|---|
| `src/core/sdk/toolRegistry.ts`(新) | `dedupeTools` 纯函数 + 类型 |
| `src/core/sdk/createChatSdk.ts` | 装配改调 dedupeTools + collisions warn;addTool/removeTool/setTools 语义升级;rebuildExtraTools 收敛;toolSources 重建 |
| `src/core/harness/createAgent.ts` | coreExecTool 不变(已收敛);如需可加断言「allTools 无同名」 |
| `src/core/types/index.ts` + `types/index.d.ts` | `disabledNames` 相关若暴露则同步(默认内部,不暴露) |
| `src/core/index.ts` | 导出 dedupeTools(供集成方自测?可选,不必须) |
