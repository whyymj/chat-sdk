# Tasks: add-dynamic-reconfiguration

> 状态:**已完成并归档**。关联:本目录 `proposal.md` / `design.md`。
> 顺序:期一(tools 动态化,核心基础设施)→ 期二(subagents 动态化,复用 tools)→ 期三(llm 动态化)→ 期四(memory 动态化)→ 期五(测试同步)→ 期六(文档 + 门禁 + 归档)。
> 全程向后兼容:不调用 set* = 现状行为。期一可独立交付(价值最高)。

## 期一 — tools 动态化(P0,核心基础设施)

- [x] `src/core/harness/createAgent.ts`:`allTools` 改 `let`(`:178`);`llmWithTools` 改 `let`(`:191`);新增 `rebindTools()` 内部函数(重新 `llm.bindTools(allTools)`);`:231` `streamer = caller ?? llmWithTools` 取最新 let
- [x] `createAgent.ts`:返回对象加 `setTools(userTools: StructuredToolInterface[])` —— 重算 `allTools = [...middlewares.flatMap(m => m.tools || []), ...userTools]` + `rebindTools()`
- [x] `src/core/sdk/createChatSdk.ts`:`userToolsRef` 可变数组;新增 `sdk.setTools(tools)` / `sdk.addTool(tool)` / `sdk.removeTool(name)`;调 `core.agent.setTools(userToolsRef)` + `infoTick++`
- [x] `inspect().tools`(`:1080`)确认动态取最新 `allTools`(改 let 后自然动态;验证)
- [x] selftest(新模块 sec-28 或加 sec-19):setTools 后 allTools 反映新工具;addTool/removeTool 增删;setTools([]) 清空用户工具(内置仍在)。runner 注册 + 断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`(inspect.mjs tools 反映)

## 期二 — subagents 动态化(P1,复用 tools)

- [x] `src/core/harness/subagent.ts`:新增 `SubagentsController` 接口(`set/add/remove/get`);`createSubagentsMiddleware` 内部 `subagents`/`subagentTools` 改 `let`;`onReconfigure` 回调参数(触发 createAgent rebind);controller 不可枚举挂载(类比 SkillsController)
- [x] `createAgent.ts`:`setTools` 时 `middlewares.flatMap(m => m.tools)` 重算 —— subagents 中间件 tools 动态变化时自动反映(验证)
- [x] `createChatSdk.ts`:`subagentsController` 引用;新增 `sdk.setSubagents(configs)` / `sdk.addSubagent(config)` / `sdk.removeSubagent(id)`;调 `subagentsController.set(...)`(内部触发 rebind)+ `infoTick++`;未配 subagents 时 controller 为 null,setter warn 不抛错
- [x] `inspect().subagent`(`:1086-1090`)改动态取 `subagentsController?.get()`(反映运行时增删)
- [x] selftest:subagentsController.set 后委派工具增删;add/remove;未配 subagents 时 setter warn。断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` 全过

## 期三 — llm 动态化(P2,rebind + 重解析能力)

- [x] `createAgent.ts`:`llm` 改 `let`(`:184`);新增 `setLlm(newLlm)` —— 替换 `llm` + `rebindTools()` + `onLlmChange` 回调(通知 createChatSdk 重解析能力)
- [x] `createChatSdk.ts`:`currentLlm` 引用;新增 `sdk.setLlm(llm: BaseChatModel | LLMConfig)` —— 若 LLMConfig 构造 ChatOpenAI;调 `core.agent.setLlm(newLlm)` + 重解析 `modelCaps = resolveModelCaps(...)` + `infoTick++`;`summaryLlm` 不受影响(独立,如需切单独 API,本变更不含)
- [x] `inspect().model`(`:1078`)改动态取 `currentLlm.model`
- [x] `setLlm` 时校验新模型支持 tool calling(`bindTools` 存在);不支持时 warn(工具调用会失效)
- [x] selftest:setLlm 后 llmWithTools 用新 llm 重新绑定;LLMConfig 形式构造 ChatOpenAI。断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` 全过

## 期四 — memory 动态化(P3,最简)

- [x] `src/core/harness/memory.ts`:`memoryText` 改 `let`;新增 `MemoryController`(`set/get`);controller 不可枚举挂载
- [x] `createChatSdk.ts`:`memoryController` 引用;新增 `sdk.setMemory(text: string)`;调 `memoryController.set(text)` + `infoTick++`
- [x] `inspect().memory`(`:1083`)改 `memoryController?.get() ?? options.memory`
- [x] selftest:setMemory 后 augmentPrompt 返新值;setMemory('') 跳过(空串 falsy)。断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` 全过

## 期五 — e2e 同步

- [x] `tests/e2e/inspect.mjs`:`setTools` 后 `inspect().tools` 反映新工具集;`setSubagents` 后 `inspect().subagent` 反映;`setLlm` 后 `inspect().model` 反映;`setMemory` 后 `inspect().memory` 反映
- [x] `tests/e2e/custom-injection.mjs`:`setTools` 增删后实际工具调用生效(FAKE_LLM 模拟调新工具);`setMemory` 后 systemPrompt 含新 memory 段
- [x] 断言计数同步(README / CLAUDE.md 中英文 + 测试矩阵)

## 期六 — 收口(文档 / 门禁 / 归档)

- [x] `doc/system-prompt.md`:补注 memory 段现可运行时 setMemory 动态(配套 augmentSystem 变更已动态化数据段;本变更动态化 memory 段)
- [x] `CLAUDE.md`:架构要点 / SDK 用法补 `setTools/setSubagents/setLlm/setMemory`;Agent 身份职责分工提及「运行时资源动态加载/卸载」
- [x] `README.md` / `README.zh-CN.md`:配置项速查 + 便捷 API 补 8 个 set*/add*/remove* 方法(中英同步)
- [x] `skills/page-agent-sdk-integrate/references/api.md` + `options.md` + `quickstart.md`:动态 API 文档
- [x] 门禁:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:exports` → `npm run test:types` → `npm run test:size` → `npm pack --dry-run` 全过
- [x] 归档:specs 增量(4 条)合入 `openspec/specs/page-agent-core.md`;change 移入 `openspec/changes/archive/`

> 备注:期一(tools 动态化)是核心 + 价值最高,可独立交付。期二/三/四在期一基础上叠加。期一+期二一起交付即覆盖「动态工具 + 动态子 agent」主流场景。全程零破坏性(不调用 set* = 现状)。
