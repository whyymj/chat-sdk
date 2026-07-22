# Tasks: refactor-to-page-agent-sdk

> 状态:**实现完成 + 自测通过(33/33)+ 归档**。端到端 LLM 对话验证待用户。

- [x] **Phase 0 — OpenSpec 与脚手架**
  - [x] 落地 `openspec/project.md` + 本 change 文件
  - [x] 调整 `vite.config.ts`(vue 打包进、external 调整,自研无需 Node alias stub)
  - [x] 新建 `src/harness/`、`src/backends/`、`src/sdk/` 骨架
- [x] **Phase 1 — harness 核心 + 中间件契约**
  - [x] `src/harness/state.ts`:AgentState schema
  - [x] `src/harness/middleware.ts`:Middleware 接口 + 执行器(正序/逆序/洋葱)
  - [x] `src/harness/createAgent.ts`:ReAct 循环抽成可挂中间件的核心
- [x] **Phase 2 — 能力中间件**
  - [x] `src/harness/todos.ts`:`write_todos`(整表替换)+ augmentPrompt + 并行拒绝
  - [x] `src/harness/skills.ts`:`defineSkill` + 索引注入 + `load_skill`
  - [x] `src/harness/memory.ts`:AGENTS.md 注入
  - [x] `src/harness/permissions.ts`:scope 白名单 first-match-wins
  - [x] `src/harness/summarization.ts`:`compressInput` 钩子接入新 harness(复用 useContextManager)
- [x] **Phase 3 — 内存工作区与核心工具**
  - [x] `src/backends/vfs.ts`:`vfs_read/write/edit/ls/glob/grep` + vfs 中间件
  - [x] `src/tools/windowOps.ts`:属性注册表 + `list/describe/get/set/delete_window_prop` + zod 校验 + 审计 + 祖先读
  - [x] `src/tools/fetchDoc.ts`:`fetch_document` + CORS 错误处理
  - [x] 内置工具在 `createPageAgent` 注册
- [x] **Phase 4 — SDK 入口与 UI 去业务化**
  - [x] `src/sdk/createPageAgent.ts` / `defineTool.ts`
  - [x] `src/index.ts` 导出 + `types/index.d.ts` 同步
  - [x] `src/App.vue` 改为双栏 demo(左 JSON 页面 + 右对话框)
- [x] **Phase 5 — 清理(方案 A:渐进保留)**
  - [x] `subAgent.ts` 标 deprecated
  - [x] 旧链路(`useAgent`/`readDocument`/`documentStore`/`codeArtifact`/`conversationIndex`)保留双导出 + CLAUDE.md 标注遗留
- [x] **Phase 6 — 验证**
  - [x] `npm run build` 通过(91 modules,产物 ~471KB,无 `node:*` 具名 import)
  - [x] `tsc --strict` 通过(harness + 工具 + sdk)
  - [x] dev 编译通过(@ `localhost:3001`)
  - [x] `demo/plain.html` 框架无关集成示例
  - [x] **自测 `npm test`:33 passed, 0 failed**(windowOps/vfs/todos/skills/permissions/memory/执行器)
  - [ ] 端到端 LLM 对话验证(需用户接入 LLM 在浏览器跑双栏 demo)
