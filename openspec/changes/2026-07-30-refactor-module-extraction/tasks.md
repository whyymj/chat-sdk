# Tasks: refactor-module-extraction

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。
> 顺序:期一(P0 纯函数抽离 + subpath 开放,核心 + 价值最高)→ 期二(P1 状态机/桥接层抽离)→ 期三(P2 低频抽离,可选)→ 期四(测试同步)→ 期五(文档 + 门禁 + 归档)。
> 全程向后兼容:顶层 `.` 入口导出不变,运行时行为零变化。期一可独立交付。

## 期一 — P0 纯函数抽离 + subpath 开放(核心,可独立发布)

### 1.1 jsonUtils 抽离

- [ ] 新建 `src/core/tools/jsonUtils.ts`
- [ ] 从 `dataOps.ts` 逐字搬迁 18 个纯函数:`UNSAFE_KEYS`/`isUnsafePath`/`safeMerge`/`getByPath`/`setByPath`/`deleteByPath`/`deepClone`/`maybeParseValue`/`projectFields`/`limitDepth`/`safeStringify`/`hashValue`/`applyPatchToClone`/`applyPatchToLive`/`restoreLive`/`restoreInPlace`
- [ ] `EditOp` 类型从 `dataOps.ts` 移到 `jsonUtils.ts`(纯类型,避免反向依赖)
- [ ] `dataOps.ts` 改:从 `./jsonUtils` import 上述函数 + 类型;删除原函数体
- [ ] 验证 `dataOps.ts` 体积从 ~969 行降到 ~480 行

### 1.2 schemaUtils 抽离

- [ ] 新建 `src/core/tools/schemaUtils.ts`
- [ ] 从 `dataOps.ts` 逐字搬迁 6 个 schema 工具:`getSchemaTopKeys`/`isPathAllowed`/`unwrapSchema`/`getSchemaAtPath`/`projectBySchemaDeep`/`projectBySchema`
- [ ] `dataOps.ts` 改:从 `./schemaUtils` import 上述函数;删除原函数体

### 1.3 promptBuilder 抽离

- [ ] 新建 `src/core/sdk/promptBuilder.ts`
- [ ] 从 `createChatSdk.ts` 逐字搬迁:`DEFAULT_SYSTEM_PROMPT`(:286-294)/`buildDataPrompt`(:295-401)
- [ ] 新增 `buildSystemPrompt(options, dataConfig)` 统一入口:处理 `appendReliableWriteRules` 分支 + `---` 分割线
- [ ] `createChatSdk.ts` 改:从 `./promptBuilder` import;`buildCore` 内调 `buildSystemPrompt(options, finalDataConfig)` 替代散落拼接逻辑

### 1.4 导出同步

- [ ] `src/core/index.ts`:导出 `jsonUtils` 的所有纯函数 + `EditOp` 类型;导出 `schemaUtils` 的所有函数;导出 `promptBuilder` 的 `buildSystemPrompt`/`buildDataPrompt`/`DEFAULT_SYSTEM_PROMPT`
- [ ] `types/index.d.ts`:同步 `EditOp` 类型声明(若已存在则确认位置)
- [ ] 验证顶层 `page-agent-sdk` 导出不变(所有现有 import 路径零改动)

### 1.5 subpath exports 开放

- [ ] `package.json` `exports` 新增三个 subpath:
  - `"./storage"`: `{ "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" }`
  - `"./query"`: `{ "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" }`
  - `"./llm"`: `{ "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" }`
- [ ] 确认 `./storage` 对应导出:`createSessionStore`/`createMemoryBackend`/`createWebStorageBackend`/`isQuotaError`
- [ ] 确认 `./query` 对应导出:`jpEval`/`searchJson`/`runSandboxedScript` + jsonUtils 的纯函数
- [ ] 确认 `./llm` 对应导出:`createProxyLlm` + `ProxyLlmMode`/`ProxyLlmOptions` 类型

### 1.6 门禁(期一)

- [ ] `npm run test:types` 全过(import 路径正确)
- [ ] `npm test` 全过(运行时行为不变)
- [ ] `npm run build && npm run test:e2e` 全过(集成层不破坏)
- [ ] `npm run test:exports` 全过(导出对齐)
- [ ] `npm run test:size` 全过(体积不超阈值)

## 期二 — P1 状态机/桥接层抽离(叠加期一)

### 2.1 llmResolver 抽离

- [ ] 新建 `src/core/sdk/llmResolver.ts`
- [ ] 从 `createChatSdk.ts` 逐字搬迁:`isChatModel`(:422-425)/`buildSummaryLlmInvoke`(:520-567)
- [ ] 新增 `resolveLlm(options)` 统一入口:返回 `{ llm, modelCaps, summaryLlmInvoke }`(整合 :658-672 的 modelCaps 解析)
- [ ] `createChatSdk.ts` 改:从 `./llmResolver` import;`buildCore` 内调 `resolveLlm(options)`

### 2.2 conflictManager 抽离

- [ ] 新建 `src/core/sdk/conflictManager.ts`
- [ ] 定义 `ConflictManager` 接口:`{ pendingConflict: Ref<PendingConflict | null>, set(info), resolve(action) }`
- [ ] 新增 `createConflictManager()` 工厂:搬迁 `createChatSdk.ts` :628-660 的 `pendingConflict` ref + `setPendingConflict` + `resolveConflict` 逻辑
- [ ] `createChatSdk.ts` 改:`const conflictMgr = createConflictManager()`;`dataOps` 的 `onConflict` 接 `conflictMgr.set`;`sdk.pendingConflict`/`sdk.resolveConflict` 代理到 `conflictMgr`

### 2.3 skillStore 桥接层抽离

- [ ] 新建 `src/core/sdk/skillStore.ts`(注意:与 `backends/skillStore.ts` 区分,本文件是桥接层)
- [ ] 定义 `SkillStoreBridge` 接口:`{ loadUserSkills(), syncUserSkills(), store }`
- [ ] 新增 `createSkillStoreBridge(options, messages, setSkills)` 工厂:搬迁 `createChatSdk.ts` :911-961 的 `toPersistedSkill`/`toSkillSpec`/`loadUserSkillsFromStore`/`syncUserSkills`/`skillStore` 初始化
- [ ] `createChatSdk.ts` 改:`const skillBridge = createSkillStoreBridge(options, messages, setSkills)`;`resolveAndLoad`/`loadUserSkills` 代理到 `skillBridge`

### 2.4 contextIndex 抽离

- [ ] 新建 `src/core/composables/contextIndex.ts`
- [ ] 从 `useContextManager.ts` 逐字搬迁 6 个纯函数 + 常量:`STOP_WORDS`/`tokenize`/`estimateMessageTokens`/`estimateRoundTokens`/`indexSummarize`/`recallRounds`
- [ ] `useContextManager.ts` 改:从 `./contextIndex` import;体积从 ~321 行降到 ~170 行

### 2.5 导出 + 门禁(期二)

- [ ] `src/core/index.ts`:导出 `resolveLlm`/`createConflictManager`/`ConflictManager`/`createSkillStoreBridge`/`SkillStoreBridge`/`tokenize`/`indexSummarize`/`recallRounds` 等
- [ ] `types/index.d.ts`:同步 `ConflictManager`/`SkillStoreBridge` 类型
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e` + `npm run test:exports` + `npm run test:size` 全过

## 期三 — P2 低频抽离(可选,按需)

### 3.1 events 抽离

- [ ] 新建 `src/core/sdk/events.ts`
- [ ] 定义 `SdkEvents` 接口:`{ emit(event, payload), hook(handler), middleware }`
- [ ] 新增 `createSdkEvents(onEvent)` 工厂:搬迁 `createChatSdk.ts` :902-913 的 `listeners` Set + `emit` + `hook` + `createSdkEventMiddleware`(:589-624)
- [ ] `createChatSdk.ts` 改:`const events = createSdkEvents(options.onEvent)`;中间件装载用 `events.middleware`

### 3.2 optionsResolver 抽离

- [ ] 新建 `src/core/sdk/optionsResolver.ts`
- [ ] 从 `createChatSdk.ts` 逐字搬迁:`resolveStorage`(:407-416)/`resolveDialogConfig`(:417-420)
- [ ] 可选:整合能力开关解析(`caps?.xxx !== false` 逻辑)为 `resolveCapabilities(options)` 纯函数
- [ ] `createChatSdk.ts` 改:从 `./optionsResolver` import

### 3.3 门禁(期三)

- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e` + `npm run test:exports` + `npm run test:size` 全过

## 期四 — 测试同步

### 4.1 selftest 白盒单测(新增模块)

- [ ] 新建 `src/core/__tests__/modules/sec-30.ts`:jsonUtils 白盒单测
  - `deepClone` 深拷贝独立(改 clone 不影响原)
  - `getByPath`/`setByPath`/`deleteByPath` 正常 + 嵌套 + 不存在路径
  - `applyPatchToClone`/`applyPatchToLive` set/remove/merge/append 四种 op
  - `isUnsafePath` 原型污染防护(`__proto__`/`constructor`/`prototype`)
  - `safeStringify` 长度截断 + 循环引用处理
  - `hashValue` 相同值同 hash + 不同值不同 hash
  - 每个 pure function 至少 2 条断言(正常 + 边界)
- [ ] 新建 `src/core/__tests__/modules/sec-31.ts`:schemaUtils 白盒单测
  - `getSchemaTopKeys` 提取顶层 key
  - `isPathAllowed` 白名单匹配 + 不在白名单拒绝
  - `projectBySchemaDeep` 按 schema 投影(去掉非 schema 字段)
  - `getSchemaAtPath` 取嵌套 schema
- [ ] 新建 `src/core/__tests__/modules/sec-32.ts`:contextIndex + 工厂函数断言
  - `tokenize` 去停用词 + 小写化
  - `estimateMessageTokens` 合理估算(字符数/3-4)
  - `recallRounds` 关键词召回 top K
  - `buildSystemPrompt` 三分支:自定义 + appendRwr:true/false + 默认
  - `resolveLlm` LLMConfig 形式 + ChatModel 实例形式
  - `createConflictManager` set/resolve 状态机
  - `createSkillStoreBridge` memory 模式 store 为 null
- [ ] `src/core/__tests__/selftest.ts`:注册 sec-30/31/32;更新断言计数

### 4.2 e2e / exports-consistency

- [ ] `tests/exports-consistency.mjs`:加 subpath 导出可用性断言
  - `await import('page-agent-sdk/storage')` 含 `createSessionStore`
  - `await import('page-agent-sdk/query')` 含 `jpEval`/`searchJson`
  - `await import('page-agent-sdk/llm')` 含 `createProxyLlm`
- [ ] e2e 无需新增(纯重构无运行时行为变化)

### 4.3 断言计数同步

- [ ] `README.md` / `README.zh-CN.md`:更新 selftest 断言计数(中英同步)
- [ ] `CLAUDE.md`:更新测试矩阵 + 断言计数

## 期五 — 收口(文档 / 门禁 / 归档)

### 5.1 文档同步

- [ ] `doc/architecture.md`:补「模块抽离」章节,说明 jsonUtils/schemaUtils/promptBuilder/llmResolver/conflictManager/skillStoreBridge/contextIndex 分层 + 依赖方向图
- [ ] `doc/usage-guide.md`:补「按需引入」章节(subpath exports 用法 + 三个 subpath 示例)
- [ ] `README.md` / `README.zh-CN.md`:配置项速查 + 按需引入示例(中英同步)
- [ ] `CLAUDE.md`:目录结构更新(新增文件)+ 测试矩阵更新
- [ ] `skills/page-agent-sdk-integrate/references/api.md`:按需引入 + subpath 文档
- [ ] `skills/page-agent-sdk-integrate/references/advanced.md`:按需引入示例

### 5.2 最终门禁

- [ ] `npm run build` → `npm test`(全过)→ `npm run test:e2e`(全过)→ `npm run test:exports`(导出对齐)→ `npm run test:types`(类型正确)→ `npm run test:size`(体积不超阈值)→ `npm pack --dry-run`(核对不含 `.env`/`src`/`examples`/笔记)

### 5.3 归档

- [ ] `openspec/specs/page-agent-core.md`:合入增量 Requirement(2 条:纯函数模块独立可用 / subpath 按需引入)
- [ ] `openspec/changes/2026-07-30-refactor-module-extraction/` → 移入 `openspec/changes/archive/`
- [ ] `openspec/project.md`:更新「最近完成的 change」列表
- [ ] `doc/问题.md`:更新 #17 状态(标记 subpath 已加,多入口构建按真实 CDN 体积痛点再排期)
- [ ] `CHANGELOG.md`:新增版本条目(期一可独立发布为 minor,期二/三叠加为 patch 或合并一次 minor)

> 备注:期一(P0)是核心 + 价值最高,可独立交付。期二/三在期一基础上叠加。全程零破坏性(纯重构 + 新增 subpath,运行时行为不变)。期一完成后 `createChatSdk.ts` 体积从 1714 降到 ~1600(只抽 promptBuilder),期二完成后降到 ~900(抽 llmResolver/conflictManager/skillStoreBridge);`dataOps.ts` 期一完成后从 969 降到 ~480;`useContextManager.ts` 期二完成后从 321 降到 ~170。
