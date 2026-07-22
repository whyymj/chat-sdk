# Change: refactor-to-page-agent-sdk

## Why
现有 `zhuanti-agent` 是 Vue3 库模式 AI 对话框,深度绑定"什么值得买专题"业务,缺乏"操作所在页面"的能力。目标是重构为一个**通用、框架无关的 JS SDK**(`page-agent`,名字待定):以对话框挂载到任意页面,Agent 通过自定义 tool 直接读写宿主页面 `window` 对象、GET 抓取文档,并具备 Deep Agents 风格的 planning / skills / 内存工作区 / context 管理能力。

直接使用 Deep Agents(`deepagentsjs`)有已知阻塞:[issue #292](https://github.com/langchain-ai/deepagentsjs/issues/292) —— LangGraph 依赖 `node:async_hooks`,barrel 含 `node:child_process`/`path` 具名 import,Vite 浏览器构建硬失败;即便用 `deepagents/browser` 入口或 alias stub 绕过,也会把 `@langchain/langgraph` + `langchain` 整包 + `langsmith` 拉进依赖,与本项目"只用浏览器子包、不碰 langchain 整包"的约定冲突。而 Deep Agents 的本质只是 LangGraph `createAgent` + 中间件栈之上的精选配置 —— 现有项目的手写 ReAct 循环正是等价起点。故**自研一套架构对齐 Deep Agents 的轻量 harness**,只依赖已验证浏览器可用的 `@langchain/openai` + `@langchain/core`,零打包风险、体积小、完全可控。

## What Changes
1. **自研 harness 核心**:把手写 ReAct 循环(`src/composables/useAgent.ts`)改造成支持中间件契约(`beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent`)的可插拔骨架。
2. **内存虚拟工作区(vfs)**:替代真实文件系统,提供 `vfs_read/write/edit/ls/glob/grep` 工具,作为 agent 工作记忆。
3. **window 操作工具集(属性注册表 + schema 校验,无人工审批)**:基于**属性注册表**模型,集成方声明可操作属性(`{ path, description, schema }`);所有读写只经 tool 执行,`set/delete` 强制范围检查(仅注册表内)+ JSON 格式校验;`list_window_props`/`describe_window_prop` 提供属性说明文档供 Agent 发现格式。带审计日志。
4. **GET 文档工具**:`fetch_document`,含 CORS 约束处理。
5. **Skills 系统**:`defineSkill` + 渐进式披露(索引进 system prompt,`load_skill` 按需加载全文)。
6. **Planning**:`write_todos` 工具(整表替换)+ todos state + system prompt 注入。
7. **Memory**:AGENTS.md 风格持久指令注入。
8. **Context 管理升级**:复用 `useContextManager`,触发单位由轮数改 token 估算,大工具结果外存到 vfs(预览+引用)替代硬截断。
9. **Permissions 接口**:声明式 scope 白名单(first-match-wins),本期默认不启用,保留收紧口子。
10. **框架无关 SDK 入口**:`createPageAgent().mount()`,内部 Vue 打包进 SDK。
11. **删除**:子 agent(`subAgent.ts`)、专题业务身份、本地文档库(`readDocument`/`documentStore`)。

## Impact
- **新增**:`openspec/`、`src/harness/`、`src/backends/`、`src/tools/{windowOps,fetchDoc}.ts`、`src/sdk/`、`src/config.ts`。
- **改造**:`src/composables/useAgent.ts`(抽成 harness 核心)、`useChat.ts`(接 typed 事件)、`useContextManager.ts`(token 触发 + 外存)、`src/index.ts`、`types/index.d.ts`、`vite.config.ts`(vue 打包、external 调整)、`src/App.vue`/`ChatDialog.vue`(去业务化)。
- **删除**:`src/tools/{subAgent,readDocument,documentStore}.ts` 及业务文案。
- **评估保留**:`conversationIndex`/`useConversationIndex`/`ConversationIndex.vue`(历史召回,与 skills/memory 重叠,Phase 5 定夺)。
- **影响规范**:`specs/page-agent-core.md`(新增能力 requirement)。
