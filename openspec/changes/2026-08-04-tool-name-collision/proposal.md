# Change: tool-name-collision(自定义 tool 与内置 tool 重名处理)

> 用户诉求(2026-08-04,承接「page-agent 架构对比」§3 发现):自定义 tool 与内置 tool 重名当前是**未定义行为**,需对齐 page-agent 的「显式覆盖」语义。
> **状态**:proposal(未实施)。**独立 change**,无前置依赖。基于对源码装配链路的逐行核对(证据见 design §2)。

## Why

当前自定义工具(用户 `tools` / 宿主动作 `actions` / MCP 工具)与内置工具重名时,**没有去重、没有警告、没有文档化的覆盖语义**——是未定义行为:

| 装配环节 | 当前行为 | 问题 |
|---|---|---|
| 装配(`createChatSdk.ts` `allTools`) | 纯数组拼接(`builtin + user + action + mcp`),无去重/冲突检测 | 两个同名定义**一起 bind 给模型**,OpenAI 兼容协议下模型收到重复函数名,行为不确定 |
| 来源标注(`toolSources` Map) | 后注册覆盖前注册(`user` 覆盖 `builtin` 标签) | **标注与实际执行不一致**:标签显示 user,执行的却是 builtin |
| 执行(`createAgent.ts` `coreExecTool`) | `allTools.find(name)` 取**第一个匹配** → builtin 在前,内置工具赢 | 用户以为自定义覆盖了内置,实际调的是内置;或模型在两个定义间困惑 |
| 运行时 `addTool` | 只在 `userTools` 内部去重,与内置重名照样 push | 重名依旧存在,无提示 |
| 运行时 `removeTool` | 只删 userTools 内第一个,内置删不掉 | 用户无法按名移除内置工具 |
| MCP 工具(`mount` 时 `mcpTools.push`) | 无去重 | MCP 工具名可与内置/用户/action 撞 |

**对比参照 `alibaba/page-agent`**(已在 `doc/page-agent-architecture-comparison.md` §3 记录):对方用 `Map<string, Tool>` + `customTools: Record<string, Tool | null>`,**重名 = 自定义覆盖内置;传 `null` = 删除内置工具**,语义明确、文档化、零歧义。我们缺这一层确定性。

**后果**:集成方无法可靠地「替换内置工具行为」;重名时可能拿到两个同名定义(模型困惑)或一个假象(标签对、执行错)。作为「安全边界在 tool 层」的 SDK,工具名的确定性是安全边界的一部分。

## What Changes

把「重名」从**未定义**收敛为**显式覆盖语义**(后注册覆盖先注册,对齐 page-agent),并全程可观察:

### 1. 装配期确定性(核心)
- `createChatSdk` 装配 `allTools` 时做一次**确定性合并**:以 `Map<name, tool>` 收敛,后注册覆盖先注册(`builtin` 最先生成、`user` 覆盖之、`action` 再覆盖、`mcp` 最后)。**同名工具只保留一个** —— 不把重复定义 bind 给模型。
- 覆盖发生时 `console.warn` 提示:`[page-agent-sdk] 工具 "X" 与内置工具重名,已用自定义实现覆盖`(或按覆盖方向对应文案)。`debug` 模式下更详细。

### 2. 执行与标注一致
- `coreExecTool` 继续按 `find(name)` 执行 —— 因为装配期已收敛到单一定义,**执行的就是装配后唯一的那份**,标注(`toolSources`)与执行天然一致。
- `toolSources` 保留「最终生效者的来源」(`user`/`action`/`mcp`/`builtin`),DebugDrawer 展示与实际一致。

### 3. 运行时 API 对齐
- `addTool`:去重范围从「userTools 内部」升级为「**跨 builtin+user+action+mcp 的最终工具集**」——重名时 warn + 覆盖(不再 push 重复)。
- `removeTool(name)`:升级为「从最终工具集按名移除」——若命中的是 user/action/mcp 工具则移除;**若命中的是内置工具,则从最终集移除内置实现**(等价 page-agent 的「传 null 删内置」,但 API 形态保持 `removeTool(name)`,语义显式化)。
- `setTools(tools)`:整体替换 user 工具时同样走收敛逻辑。

### 4. 可观察性
- `inspect().tools` 反映收敛后的唯一工具集(现有机制,无需新字段)。
- 新增 e2e 断言覆盖重名场景(见 Impact)。

## Impact

- **测试**(按「新增功能测试同步约定」):
  - selftest:装配收敛逻辑(user 覆盖 builtin / action 覆盖 user / mcp 覆盖 action / 无重名不报 warn)+ 运行时 addTool/removeTool 重名路径。
  - e2e:`inspect().tools` 重名时只含一个定义 + `toolSources` 来源正确 + removeTool 移除内置工具生效。
- **行为变化**:重名从「两个定义共存」变为「后者覆盖前者」。这是**修正未定义行为**,对从未重名的现有用户零影响;对重名用户,从「模型困惑/假象执行」变为「确定性的自定义覆盖」。
- **向后兼容**:API 零新增零删除(仅语义收敛 + warn);`removeTool` 语义从「只删 userTools」扩展为「可删内置」——对现有「删用户工具」用法兼容,新增「删内置」能力。
- **文档**:CLAUDE.md 架构要点补「工具重名覆盖语义」;usage-guide 工具小节补一句;对比文档 `page-agent-architecture-comparison.md` §5 已把「对齐覆盖语义」列为借鉴项,落地后标注完成。

## 决策

1. **覆盖方向 = 后注册覆盖先注册**(对齐 page-agent 的 `Map.set` 语义):装配序 builtin → user → action → mcp,后者覆盖前者。理由:自定义工具是集成方主动传入,应能替换内置行为;MCP/action 是更晚注入的宿主能力,优先级更高。
2. **覆盖时 warn + debug 详报**:重名是集成方配置瑕疵,不静默;但保持向后兼容不抛错(配置错误可运行,只是语义明确)。
3. **`removeTool` 语义显式化**(可删内置):对齐 page-agent 的「传 null 删内置」,但保持我们 `removeTool(name)` 的 API 形态,避免引入新的 `null` 约定。
4. **不做自定义工具的「覆盖保护」**(不阻止覆盖内置):对齐 page-agent「可覆盖」哲学 —— 集成方有最终话语权,SDK 只负责语义确定 + 告警,不越权。
5. **不做「重名直接报错」**:部分框架重名直接抛错(如 LangChain 对重复 tool name),但那会破坏现有兼容性且对「有意替换」的用户不友好。选 warn + 覆盖。

## Non-goals

- 不改工具注册机制本身(`defineTool`/`tool()` 签名不变)。
- 不做「运行时改名/命名空间」(`tools.<namespace>` 之类)——重名收敛 + 覆盖语义已满足需求,命名空间是更大的侵入。
- 不引入自定义工具与内置工具的「冲突列表」白名单(集成方知道自己在干什么,SDK 只告警)。
- 不并入 `chatdialog-component-split` / `context-inspector` / `agent-driven-compression`。
