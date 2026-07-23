# page-agent 项目

## 概述
`page-agent`(包名待定)是一个**框架无关的 JS SDK**,以对话框形态挂载到任意网页,内置一个基于 ReAct 模式的 Tool-Calling Agent。Agent 通过自定义 tool 直接读写/调用宿主页面 `window` 对象上的属性(基于**属性注册表 + schema 校验**)、GET 抓取文档,并具备 planning / skills / 内存工作区 / context 管理能力。

本项目由 `zhuanti-agent`(Vue3 库模式、深度绑定"什么值得买专题"业务)重构而来,目标是剥离业务身份、补齐"操作所在页面"能力,并自研一套架构对齐 Deep Agents 的轻量 harness。

## 设计原则
- **纯浏览器运行**:无 Node 文件系统依赖;不引入 `langchain` 整包 / LangGraph(规避 [deepagentsjs#292](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。
- **架构对齐 Deep Agents**:ReAct 循环 + 可插拔中间件 + 内存 backend,自研实现;仅依赖浏览器可用的 `@langchain/openai` + `@langchain/core`。
- **框架无关**:对外暴露命令式 API(`createPageAgent`),内部 Vue 打包进 SDK,使用者无需安装/了解 Vue。
- **安全边界在 tool 层**:window 操作经属性注册表 + schema 校验(无人工审批,但强约束范围与格式)。

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
- `changes/generalize-page-agent/`:通用化抽离。**Phase 1/2/3/4/6 已实现**(provider / headless / capabilities / MCP / presets);Phase 5 DataSource 暂缓。待浏览器实测 MCP 后可归档。详见 `tasks.md`。

## 最近完成的 change(已归档)
- `changes/archive/refactor-to-page-agent-sdk/`:重构为框架无关页面内 Agent SDK(实现完成,自测 33/33,规范已合入 `openspec/specs/page-agent-core.md`)。
