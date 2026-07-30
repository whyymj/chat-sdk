# page-agent-sdk 项目

## 概述
`page-agent-sdk` 是一个**框架无关的 JS SDK**,以对话框形态挂载到任意网页,内置一个基于 ReAct 模式的 Tool-Calling Agent。Agent 通过自定义 tool 直接读写/调用宿主页面 `window` 对象上的属性(基于**属性注册表 + schema 校验**)、GET 抓取文档,并具备 planning / skills / 内存工作区 / context 管理能力。

本项目由 `zhuanti-agent`(Vue3 库模式、深度绑定"什么值得买专题"业务)重构而来,目标是剥离业务身份、补齐"操作所在页面"能力,并自研一套架构对齐 Deep Agents 的轻量 harness。

## 设计原则
- **纯浏览器运行**:无 Node 文件系统依赖;不引入 `langchain` 整包 / LangGraph(规避 [deepagentsjs#292](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。
- **架构对齐 Deep Agents**:ReAct 循环 + 可插拔中间件 + 内存 backend,自研实现;仅依赖浏览器可用的 `@langchain/openai` + `@langchain/core`。
- **框架无关**:对外暴露命令式 API(`createChatSdk`),内部 Vue 打包进 SDK,使用者无需安装/了解 Vue。
- **安全边界在 tool 层**:数据槽操作经属性注册表 + schema 校验(无人工审批,但强约束范围与格式)。

## 技术栈
- Vue 3.5(**打包进 SDK**,非 peer)、Vite 8 库模式、TypeScript
- LangChain 浏览器子包:`@langchain/openai` + `@langchain/core`(external + peerDep)
- `marked` + `highlight.js`(打包进 SDK)
- `zod`(schema 校验,external + peerDep)

## OpenSpec 工作流
1. **提 change**:在 `openspec/changes/<id>/` 下写 `proposal.md`(Why/What/Impact)、`design.md`(技术决策)、`tasks.md`(实施清单)、`specs/<capability>.md`(增量 requirement)。
2. **实施**:按 `tasks.md` 勾选推进;实现须满足 `specs/` 的 requirement。
3. **归档**:实现完成后将 `specs/` 增量合入 `openspec/specs/`(系统真相源),change 移入 `openspec/changes/archive/`。

## 进行中的 change
- `2026-07-30-refactor-module-extraction/`:模块抽离重构(可维护性)—— ① 纯函数抽离(`dataOps.ts` 18 个纯函数 → `tools/jsonUtils.ts` + 6 个 schema 工具 → `tools/schemaUtils.ts`;`useContextManager.ts` 6 个纯函数 → `composables/contextIndex.ts`);② 高频改动点抽离(`createChatSdk.ts` → `sdk/promptBuilder.ts` / `sdk/llmResolver.ts` / `sdk/conflictManager.ts` / `sdk/skillStore.ts` 桥接层);③ 对外开放 subpath(`./storage` / `./query` / `./llm`)。纯重构,运行时行为零变化;顶层 `.` 入口导出不变。分期:期一(P0 纯函数 + subpath,可独立发布)→ 期二(P1 状态机/桥接层)→ 期三(P2 低频可选)→ 期四(测试同步)→ 期五(文档 + 门禁 + 归档)。

## 最近完成的 change(已归档)
- `archive/2026-07-30-add-dynamic-reconfiguration/`:运行时资源动态加载/卸载 —— `sdk.setTools/addTool/removeTool`(用户工具动态,核心基础设施)/ `sdk.setSubagents/addSubagent/removeSubagent`(复用 tools 机制)/ `sdk.setLlm`(模型切换 + 重解析能力)/ `sdk.setMemory`(memory 动态)。复用 `let + rebind + infoTick` 模式(类比 setData/setSkills),全程向后兼容。自测 524/524,e2e 210/210。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-augment-system-hook/`:动态 system prompt 注入钩子 `augmentSystem(ctx)`(集成方按运行时状态注入部分 schema / 组件说明)+ A4「可操作数据」段改为每轮随 data 动态(修 `setData()` 不同步 Bug,经 `dataHint` 中间件)。复用 augmentPrompt 中间件机制,不污染 `HarnessState`。规范已合入 `openspec/specs/page-agent-core.md`。自测 495/495,e2e 189/189。
- `archive/2026-07-24-add-verify-middleware/`:Verify 自检中间件(`beforeReturn` 钩子点 + `createVerifyMiddleware` + `createWriteBackCheck` 写后读回 + 对抗验证)。对应 `doc/evolution-roadmap.md` #5。自测 146/146,规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-23-generalize-chat-sdk/`:通用化(provider 抽离 / headless / capabilities / MCP / presets)。
- `archive/refactor-to-chat-sdk-sdk/`:重构为框架无关页面内 Agent SDK(规范已合入 `openspec/specs/page-agent-core.md`)。
