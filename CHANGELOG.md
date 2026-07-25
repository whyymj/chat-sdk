# Changelog

本变更日志基于 git commit 历史整理,遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 风格,版本号对应 npm 发布版本。

## [1.3.8] - 2026-07-25

### Added
- 导出一致性检查(`tests/exports-consistency.mjs`):静态分析对比 `src/core/index.ts` 与 `types/index.d.ts` 导出名集合,防 d.ts 脱节
- 类型测试基线(`tests/types.test-d.ts` + `tsconfig.test.json` + `test:types`):tsc --noEmit 验证 types 导出齐全 + 关键类型正确
- 补全 `types/index.d.ts` 缺失的 27 个导出(resolveContextOptions/ContextPreset/CONTEXT_PRESETS、connectMcp/extractText/McpTransport/McpConnection、Middleware/ModelRequest/ModelResponse/ToolCallContext/StateUpdate、createSubagentsMiddleware/SubagentOptions/SubagentLlmConfig、createVfs、ContextManagerOptions/CompressionStats、resolveModelCaps/estimateTokens/offloadThresholdChars/offloadPassThroughChars/ModelCaps 等)

### Fixed
- `types/index.d.ts` AgentInfo 后多余 `}` 致 tsc 报 TS1128(由类型测试基线首次跑发现)

## [1.3.7] - 2026-07-25

### Changed
- e2e 测试按模块拆分:单文件 `tests/e2e-integration.mjs` → `tests/e2e/*.mjs` 11 个主题模块 + runner 汇总
- 修正 `createAssert` 解构 bug(解构 pass/fail 取当时值不随 assert 递增,改用 ctx 引用末尾读 getter)

## [1.3.6] - 2026-07-25

### Added
- e2e 扩充至 120 项,覆盖各 API/配置项/功能模块/场景:导出项完整(39+ 函数/组件)、inspect 初始状态、storage 对象配置、presets 三预设、windowProps 8 种 schema + 嵌套、动态注册与 inspect 同步、shareContext 开关、工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson)、source=builtin、mount 边界、hook 多监听器、llm 配置

## [1.3.5] - 2026-07-25

### Added
- e2e 扩充至 86 项:自定义 tools/middleware/skills/memory 注入、inspect 反映配置(id/model/subagent/verify/mcp)、switchSession(开/未开)、restoreLastCheckpoint/listCheckpoints、导出项可用、配置项可传、shareContext 共享、storage 后端、presets

## [1.3.4] - 2026-07-25

### Added
- e2e 扩充至 48 项:inspect().tools 反映 windowOps 开关 + 工具集完整性、inspect().middleware 反映 capabilities、预声明 subagents、默认 systemPrompt 含能力概述、自定义 + reliableWriteRules 拼接、onEvent + hook 联动

## [1.3.3] - 2026-07-24

### Fixed
- 修复 `createChatSdk` 顶层 `addWindowProp`/`removeWindowProp`/`listWindowProps` 作用域 bug(引用 buildCore 内部变量致运行时 ReferenceError)

## [1.3.2] - 2026-07-24

### Added
- e2e 集成测试(`tests/e2e-integration.mjs`):14 项,验证 createChatSdk 顶层 API(默认 systemPrompt/动态注册/inspect/hook)

## [1.3.1] - 2026-07-24

### Added
- `inspect().systemPrompt` 字段(供调试/验证默认提示词)
- `DEFAULT_SYSTEM_PROMPT`:未传 systemPrompt 时使用内置默认(含身份/能力概述/reliableWriteRules)

## [1.3.0] - 2026-07-24

### Added
- 运行时动态注册 `windowProps`:`sdk.addWindowProp`/`removeWindowProp`/`listWindowProps`(懒加载组件场景)
- 压缩不丢信息保障(A/B/C/D):压缩注入注册表快照、写工具结果附 path 列表、preserveLastToolResults 可配、导出 `systemPromptHelpers.reliableWriteRules`
- `usageHints` 补 `list_window_props`/`describe_window_prop`/`get_window_prop` 用法提示
- `examples/dynamic-demo/`:懒加载组件 + 动态注册 + onEvent 示例

## [1.2.0] - 2026-07-23

### Added
- `onEvent` 事件回调:订阅常用时机替代轮询(window_prop_change/message_update/tool_call/tool_result/text/round_start/done/error)
- `sdk.hook()` 实例方法:运行时动态订阅 SDK 事件(可多个监听器、可取消),与构造时 onEvent 互补
- 服务端(Node.js)兼容:mount/unmount 的 window/document 访问加 typeof 守卫

## [1.1.1] - 2026-07-22

### Changed
- skills 含入 npm 包 files(使用者可从 `node_modules/page-agent-sdk/skills/` 安装)

### Fixed
- release skill 改为维护者私有 —— 从公开 npm 包移除,仅留仓库 `.claude/skills/`

## [1.1.0] - 2026-07-22

### Added
- 两个项目 skill:`page-agent-sdk-integrate`(公开分发,集成 SDK)、`page-agent-sdk-release`(维护者自用,发布流程)
- 项目结构规范化:根目录 demo html 整理进各 `examples/<demo>/index.html`
- CLAUDE.md 补充完整发布流程 checklist(改代码→中英文文档→bump→build/test→推 gitee→推 github→发 npm→验证)
