# Design: add-dynamic-reconfiguration

> 核心约束:**复用既有 controller + infoTick 模式**(类比 setData/setSkills),不引入新机制。所有动态化经 createChatSdk 层暴露 `sdk.set*`,内部更新可变变量 + 触发 rebind/刷新,不下沉 createAgent 循环骨架。

## 1. 现状定位:四个 const/闭包固化点

**固化点① tools 是 const**(`createAgent.ts:178-191`):
```ts
const allTools = [...middlewares.flatMap(m => m.tools || []), ...extraTools]  // const
const llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm  // const,一次绑定
// :231 每轮:const streamer = caller ?? llmWithTools  (复用旧绑定)
```
→ setTools 无入口;增删工具需重建 agent。

**固化点② subagents 创建时生成工具**(`subagent.ts`):
```ts
// subagents:[] → 中间件生成 use_<id> 委派工具 → 进 middlewares.flatMap(m => m.tools)
// 无 controller,运行时不可变
```

**固化点③ llm 创建时构造**(`createAgent.ts:184-190`):
```ts
const llm = options.llm ?? new ChatOpenAI({...})  // const
// bindTools 一次,无 setLlm 入口
```

**固化点④ memory 闭包捕获创建时值**(`memory.ts`):
```ts
// augmentPrompt: () => memory  (memory 是 options.memory,创建时固定;改 options.memory 不生效)
```

## 2. 解法:可变变量 + rebind + controller(类比 setData/setSkills)

### 2.1 tools 动态化(核心)

`createAgent` 改造:
```ts
let allTools: StructuredToolInterface[] = [
  ...middlewares.flatMap(m => m.tools || []),
  ...extraTools,
]
let llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm

function rebindTools() {
  llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm
}

// 暴露给 createChatSdk 层(经返回对象)
function setTools(userTools: StructuredToolInterface[]) {
  // 只替换用户工具部分;内置工具(中间件贡献)不动
  allTools = [...middlewares.flatMap(m => m.tools || []), ...userTools]
  rebindTools()
}
// :231 改:const streamer = caller ?? llmWithTools  (llmWithTools 现是 let,取最新)
```

`createChatSdk` 层:
```ts
const userToolsRef: StructuredToolInterface[] = [...(options.tools || [])]

function setTools(tools: StructuredToolInterface[]) {
  userToolsRef.length = 0; userToolsRef.push(...tools)
  core.agent.setTools(userToolsRef)  // 调 createAgent 暴露的 setTools
  core.infoTick.value++  // 触发 inspect 刷新
}
function addTool(tool) { setTools([...userToolsRef, tool]) }
function removeTool(name) { setTools(userToolsRef.filter(t => t.name !== name)) }
```

> 关键:`setTools` 只管**用户工具**;内置工具(dataOps/fetchDoc)由中间件贡献,`middlewares.flatMap(m => m.tools)` 每次重算取最新(中间件 tools 若动态也自动反映)。`bindTools` 重新绑定有开销但只在 setTools 时触发,非每轮。

### 2.2 subagents 动态化(复用 tools)

`subagent.ts` 加 `SubagentsController`(类比 `SkillsController`):
```ts
export interface SubagentsController {
  set(configs: SubagentConfig[]): void  // 重新生成 use_<id> 工具
  add(config: SubagentConfig): void
  remove(id: string): void
  get(): SubagentConfig[]
}

// createSubagentsMiddleware 内部:
let subagents = [...initialConfigs]
let subagentTools = generateDelegationTools(subagents)  // use_<id> 工具

const controller: SubagentsController = {
  set(newConfigs) {
    subagents = [...newConfigs]
    subagentTools = generateDelegationTools(subagents)
    onReconfigure?.()  // 触发 createAgent rebindTools(经回调)
  },
  // ...
}
// controller 挂中间件(不可枚举,供 createChatSdk 暴露)
```

`createChatSdk` 层:
```ts
function setSubagents(configs) {
  subagentsController?.set(configs)  // 内部触发 rebind
  core.infoTick.value++
}
```

> 关键:subagents 动态化本质 = 动态生成/移除 `use_<id>` 委派工具 → 复用 tools rebind 机制。`onReconfigure` 回调由 createAgent 提供,subagents 中间件调它触发 `rebindTools()`。

### 2.3 llm 动态化(rebind + 重解析能力)

`createAgent` 改造:
```ts
let llm = options.llm ?? new ChatOpenAI({...})  // 改 let

function setLlm(newLlm: BaseChatModel) {
  llm = newLlm
  rebindTools()  // 用新 llm 重新 bindTools
  // 重解析模型能力(影响 offload 阈值/压缩)→ 经回调通知 createChatSdk 层
  onLlmChange?.(newLlm)
}
```

`createChatSdk` 层:
```ts
function setLlm(llmOpt: BaseChatModel | LLMConfig) {
  const newLlm = isChatModel(llmOpt) ? llmOpt : new ChatOpenAI({
    apiKey: llmOpt.apiKey, model: llmOpt.model, temperature: llmOpt.temperature,
    maxTokens: llmOpt.maxTokens,
    configuration: llmOpt.baseUrl ? { baseURL: llmOpt.baseUrl } : undefined,
  })
  core.agent.setLlm(newLlm)
  // 重解析 modelCaps(影响 offload/压缩)
  modelCaps = resolveModelCaps({ model: newLlm.model, ... })
  core.infoTick.value++
}
```

> 注意:`summaryLlm` 独立(如需切单独 `setSummaryLlm`,本变更不含);新模型需支持 tool calling。

### 2.4 memory 动态化(最简)

`memory.ts` 改造:
```ts
let memoryText = options.memory ?? ''  // 改 let

const controller = {
  set(text: string) { memoryText = text },
  get: () => memoryText,
}
// augmentPrompt: () => memoryText  (取最新 let 值)
```

`createChatSdk` 层:
```ts
function setMemory(text: string) {
  memoryController?.set(text)
  core.infoTick.value++
}
// inspect().memory 改:memoryController?.get() ?? options.memory ?? ''
```

## 3. inspect() 动态化

| 字段 | 现状 | 改后 |
|---|---|---|
| `tools` | `allTools.map(...)` (allTools 曾 const) | 同(但 allTools 现是 let,setTools 后取最新) |
| `memory` | `options.memory` (固定) | `memoryController?.get() ?? options.memory` (动态) |
| `subagent` | `options.subagent` (固定) | `subagentsController?.get()` (动态) |
| `model` | `options.llm.model` (固定) | `currentLlm.model` (动态) |

`infoTick++` 在每次 set* 后触发,DebugDrawer watch 后重拉 `getInfo()` 实时刷新。

## 4. reconfigure 链路(为何能动态)

```
sdk.setTools(newTools)
  → userToolsRef 更新
  → core.agent.setTools(userToolsRef)         // createAgent 层
    → allTools = [内置 + userToolsRef]        // 重算
    → rebindTools()                            // llm.bindTools(allTools) 重新绑定
  → core.infoTick.value++                      // 触发 inspect 刷新
下一轮 invoke/stream
  → streamer = caller ?? llmWithTools          // llmWithTools 现是 let,取最新绑定
  → LLM 收到最新工具定义
```

subagents/llm/memory 链路类似(经 controller + rebind + infoTick)。

## 5. 中间件 tools 的动态性

中间件贡献的工具(`m.tools`)在 `allTools = [...middlewares.flatMap(m => m.tools || []), ...userTools]` 每次重算。若中间件 tools 动态变化(如 subagents controller 改了委派工具),`setTools` 触发重算时自动反映。无需额外机制。

## 权衡

- **为何不把 tools 改成响应式(ref/reactive)**:tools 是 LangChain `StructuredToolInterface` 实例,非纯数据;响应式化需深改 createAgent 循环(每轮 track)。用 `let + rebind + infoTick` 是最小改动,与 setData/setSkills 一致。
- **为何 setTools 只管用户工具**:内置工具(dataOps/fetchDoc)由中间件贡献,与 capabilities 绑定;若允许 setTools 改内置工具,会绕过 capabilities 约束(安全隐患)。setTools 只管用户工具,内置工具经 capabilities 控制(创建时定)。
- **为何 subagents 复用 tools 机制**:subagents 本质是 `use_<id>` 委派工具;单独建动态机制是重复造轮子。复用 tools rebind 一致且省代码。
- **为何 llm 动态化需重解析能力**:模型能力(contextWindow/maxOutputTokens)影响 offload 阈值与压缩触发;切模型不重解析会导致阈值错配(如从 32K 模型切到 1M 模型,offload 阈值仍按 32K)。

## 风险

- **rebind 时机**:`setTools` 立即 rebind,但若在 LLM 调用中(in-flight)调,当前轮仍用旧绑定(安全);下一轮用新绑定。无需锁。
- **bindTools 失败**:新模型不支持 tool calling 时 `bindTools` 可能返 undefined或抛错。`rebindTools` 已有 `?? llm` 兜底(无工具绑定用裸 llm);但工具调用会失效。`setLlm` 时 warn 提醒。
- **subagents controller 时序**:预声明 `subagents:[]` 创建时初始化 controller;运行时 `setSubagents` 替换。若创建时未配 subagents(capabilities.subagent 关),controller 为 null,`setSubagents` warn 不抛错。
- **memory 空字符串**:`setMemory('')` 清空,`augmentPrompt` 返 '' → `if (seg)` 跳过(空串 falsy)。一致。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/harness/createAgent.ts` | `allTools`/`llmWithTools`/`llm` 改 `let`;`rebindTools()`;暴露 `setTools`/`setLlm`(经返回对象) |
| `src/core/harness/subagent.ts` | `SubagentsController` + `onReconfigure` 回调;controller 挂载 |
| `src/core/harness/memory.ts` | `memoryText` 改 `let` + `MemoryController` |
| `src/core/sdk/createChatSdk.ts` | `sdk.setTools/addTool/removeTool/setSubagents/addSubagent/removeSubagent/setLlm/setMemory`;`inspect()` 动态化;`infoTick++` |
| `types/index.d.ts` | `ChatSdk` 接口加 8 个方法签名 |
| `src/core/__tests__/modules/`(selftest) | reconfigure 单元断言(tools rebind/subagents controller/memory set) |
| `tests/e2e/`(inspect / custom-injection) | set* 后 inspect 反映 + 工具实际生效 |
| `doc/system-prompt.md` / `CLAUDE.md` / `README*.md` / `skills/` | 动态 API 文档(中英同步) |
