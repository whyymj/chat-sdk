# Specification Delta: page-agent-core

> 本文件为 change `refactor-module-extraction` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 通用工具模块独立可用(jsonUtils / schemaUtils / contextIndex)

系统将 `dataOps.ts` 中零依赖的通用 JSON 操作纯函数(路径操作 / 克隆序列化 / 投影截断 / 原型污染防护 / patch 应用,共 ~18 个)抽离为独立模块 `tools/jsonUtils.ts`;将 schema 白名单投影逻辑(6 个函数)抽离为 `tools/schemaUtils.ts`;将 `useContextManager.ts` 中的纯函数索引逻辑(分词 / 估算 / 摘要 / 召回,共 6 个)抽离为 `composables/contextIndex.ts`。抽出后的函数仍从顶层 `page-agent-sdk` 导出(现有 import 路径零改动),`dataOps.ts` / `useContextManager.ts` 改为从新模块 import。该抽离为纯重构,运行时行为零变化;抽出后的纯函数支持白盒单测(此前只能经工具调用间接黑盒测)。`dataOps.ts` 体积从 ~969 行降到 ~480 行,`useContextManager.ts` 从 ~321 行降到 ~170 行。

## Requirement: 按需引入 subpath exports(./storage / ./query / ./llm)

系统在 `package.json` `exports` 中新增三个 subpath 入口:`./storage`(指向持久化存储模块:`createSessionStore` / `createMemoryBackend` / `createWebStorageBackend` / `isQuotaError`)、`./query`(指向 JSON 查询/沙箱模块:`jpEval` / `searchJson` / `runSandboxedScript` + jsonUtils 纯函数)、`./llm`(指向代理连接模块:`createProxyLlm` + `ProxyLlmMode` / `ProxyLlmOptions` 类型)。三个 subpath 均指向同一 dist 文件 + 同一 types 文件(不动构建),实际体积靠 bundler tree-shaking(已设 `sideEffects: ["**/*.css"]`)。该机制提供语义清晰的按需入口:用户写 `from 'page-agent-sdk/storage'` 表明只用持久化层;CDN 场景(esm.sh)可按需入口独立缓存。顶层 `.` 入口导出不变(向后兼容),subpath 是新增入口。未来切多入口构建时用户 import 路径零迁移。
