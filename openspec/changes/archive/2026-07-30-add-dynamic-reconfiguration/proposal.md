# Change: add-dynamic-reconfiguration

> 配套变更:`2026-07-30-add-augment-system-hook`(system prompt 动态段注入,已独立提案)。两者共同构成「运行时动态能力」:本变更管**资源动态加载/卸载**(tools/subagents/llm/memory),配套变更管**提示词动态注入**。可顺序实施,互不依赖。

## Why

1. **tools 运行时不可变,挡住常见动态场景**。`createAgent.ts:178` 的 `allTools` 是创建时 `const`,`llm.bindTools(allTools)` 在 `:191` 一次绑定,`llmWithTools` 在 `:231` 每轮复用。集成方无法运行时增删工具(如:用户权限变化后收窄工具集、按业务阶段切换工具组、A/B 实验不同工具配置)。现状只能 `unmount` + 重建 agent,丢失对话历史与中间件状态。

2. **subagents 预声明固定,无法按需加载**。`subagents:[]` 在创建时生成 `use_<id>` 委派工具,运行时无法新增/移除子 agent。动态业务编排(如:运行时根据任务类型决定委派哪些子 agent)无法实现。

3. **llm 运行时不可切换,无法降级/升级模型**。模型实例创建时固定。运行时切换模型(如:配额耗尽切便宜模型、复杂任务切强模型、切换 provider DeepSeek→Claude)需重建 agent。

4. **memory 半动态,改了不生效**。`options.memory` 创建时固定,虽每轮经 `augmentPrompt` 注入,但集成方改 `options.memory` 变量不生效(中间件闭包捕获的是创建时的值)。需 `setMemory` 显式更新。

5. **机制已部分就绪,缺统一 reconfigure 通道**。`setData`/`setSkills` 已是动态(经 controller + `infoTick++`),但 tools/subagents/llm/memory 无对应通道。`createAgent` 已暴露 `allTools`(供 inspect),只需把它从 const 改可变 + 加 rebind,即可支持 tools 动态;subagents 本质是工具(委派工具),复用 tools 机制;llm 需 rebind + 重解析能力;memory 是最简(中间件变量可变)。

## What Changes

### 1. tools 动态化(P0,核心基础设施)

- `createAgent`:`allTools` 改 `let`,`llmWithTools` 改 `let` + `rebindTools()` 内部函数(重新 `llm.bindTools(allTools)`);暴露 `setTools(tools)` 给 createChatSdk 层
- `createChatSdk`:新增 `sdk.setTools(tools)` / `sdk.addTool(tool)` / `sdk.removeTool(name)`;`setTools` 只替换**用户工具**部分(内置工具由中间件贡献,不动);调用后 `infoTick++` 触发 inspect 刷新
- `inspect().tools` 改 getter 动态取最新 `allTools`(现状已是 `allTools.map(...)`,但 allTools 曾是 const;改 let 后自然动态)
- **注意**:`bindTools` 重新绑定有开销(构造 function 定义),但只在 setTools 时触发,非每轮;LLM 侧无感知(每轮仍用最新 `llmWithTools`)

### 2. subagents 动态化(P1,复用 tools 机制)

- `subagents` 中间件加 `SubagentsController`:`set(subagents)` / `add(config)` / `remove(id)`,内部重新生成 `use_<id>` 委派工具 → 触发 `setTools` 重新绑定
- `createChatSdk`:新增 `sdk.setSubagents(configs)` / `sdk.addSubagent(config)` / `sdk.removeSubagent(id)`
- 预声明 `subagents:[]` 仍支持(创建时初始化 controller),向后兼容

### 3. llm 动态化(P2,rebind + 重解析能力)

- `createAgent`:暴露 `setLlm(llm)` → 重新 `bindTools(allTools)` 更新 `llmWithTools` + 重解析 `resolveModelCaps`(影响 offload 阈值/压缩)
- `createChatSdk`:新增 `sdk.setLlm(llm | LLMConfig)`;`summaryLlm` 独立(不受 setLlm 影响,如需切也单独 setSummaryLlm)
- **注意**:新模型需支持 tool calling(否则工具失效);`maxTokens` 缺省按新模型 `maxOutputTokens` 推导

### 4. memory 动态化(P3,最简)

- `memory` 中间件:内部 `memoryText` 变量改 `let`,`setMemory(text)` 更新
- `createChatSdk`:新增 `sdk.setMemory(text)`;`inspect().memory` 已是 `options.memory`(改 getter 取中间件最新值)

### 5. 类型 + 导出

- `types/index.d.ts`:`ChatSdk` 接口加 `setTools/addTool/removeTool/setSubagents/addSubagent/removeSubagent/setLlm/setMemory`
- `src/core/index.ts`:无需新导出(都是实例方法)

## Impact

- **改造**:
  - `src/core/harness/createAgent.ts`:`allTools`/`llmWithTools` 改 `let` + `rebindTools()`;暴露 `setTools`/`setLlm`(经返回对象或 controller)
  - `src/core/harness/subagent.ts`:`SubagentsController` + controller 挂载(类比 `SkillsController`)
  - `src/core/harness/memory.ts`:`memoryText` 改 `let` + `setMemory`
  - `src/core/sdk/createChatSdk.ts`:新增 `sdk.setTools/addTool/removeTool/setSubagents/addSubagent/removeSubagent/setLlm/setMemory`;`inspect().tools`/`.memory` 动态化;`infoTick++` 触发刷新
- **新增**:4 个动态 API(set* / add* / remove*);`SubagentsController` 类型
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 4 条 Requirement(tools/subagents/llm/memory 动态)
- **向后兼容**:
  - 不调用 set* = 现状行为(创建时配置固定)
  - `setTools([])` = 清空用户工具(内置工具仍在);`setTools` 只管用户工具部分
  - `setLlm` 后旧模型实例被替换(GC);`summaryLlm` 不受影响
  - `setMemory('')` = 清空 memory
- **测试**:selftest 加 reconfigure 单元断言(tools rebind/subagents controller/memory set);e2e 加 `setTools`/`setSubagents`/`setLlm`/`setMemory` 后 `inspect()` 反映 + 工具实际生效

## Non-goals

- **不做** middleware 运行时热插拔(高风险,中间件是循环骨架持 state;用「条件中间件」替代 —— 中间件内部判断运行时条件跳过)
- **不做** capabilities 运行时切换(决定装载哪些内置中间件,热插拔高风险;用重建 agent 替代)
- **不做** systemPrompt base 运行时替换(走配套变更 `augmentSystem` 钩子动态注入段,而非改 base)
- **不做** 对话历史运行时编辑(那是另一独立范畴,如 `sdk.clearHistory`/`sdk.editMessage`)
- **不做** 跨会话持久化动态配置(set* 只影响当前 agent 实例,不落 storage;如需持久化由集成方自行存取 + 重启恢复)

## 与配套变更的关系

| 变更 | 管什么 | 依赖 |
|---|---|---|
| `add-augment-system-hook`(已提案) | system prompt 动态段注入(augmentSystem 钩子 + A4 数据段动态化) | 独立,无依赖 |
| `add-dynamic-reconfiguration`(本变更) | 资源动态加载/卸载(tools/subagents/llm/memory) | 独立,无依赖 |

两者可任意顺序实施,互不依赖。建议先做 `augment-system-hook`(更小、修 Bug、向后兼容清晰),再做本变更(涉及 createAgent 核心循环改造,影响面更大)。
