# Change: refactor-module-extraction

> 配套:本变更管**内部可维护性抽离**(纯函数/状态机/桥接层从巨型文件拆出)+ **对外开放 subpath**(P0 三个独立模块)。与已归档的 `add-dynamic-reconfiguration` / `add-augment-system-hook` 正交,不依赖也不冲突。可独立交付,期一(P0)即可独立发布。

## Why

1. **`createChatSdk.ts` 膨胀到 1714 行 / 36 imports,成为「上帝文件」**。一个 `buildCore` 函数干了 7 件事:prompt 构建 / LLM 解析 / 存储解析 / 冲突管理 / Skill 持久化桥接 / 事件系统 / 核心装配。任何一处改动(prompt 调整、LLM 配置扩展、skill 管理变更)都要在 1714 行里定位 + 改动,review 困难、合并冲突高发。

2. **`dataOps.ts` 969 行混了两类东西**:通用 JSON/Schema 工具函数(18 个零依赖纯函数)+ dataOps 工具装配(schema 校验 + 工具定义)。前者是通用工具,跟工具本身耦合度为零,却混在同一文件,导致改工具装配可能误碰纯函数,反之亦然。纯函数目前只能黑盒测(经工具调用间接覆盖),无法白盒单测。

3. **`useContextManager.ts` 321 行混了响应式状态管理 + 纯函数索引逻辑**(分词/估算/摘要/召回)。纯函数无状态、易单测,却跟响应式状态混在一起,只能通过 e2e 间接测。

4. **已有独立模块未对外开放 subpath**。`./storage`(createSessionStore + 后端工厂,零 vue 零 langchain 依赖)、`./query`(jpEval/searchJson/runSandboxedScript,零依赖纯逻辑)、`./llm`(createProxyLlm,防 apiKey 泄露,2.11 新增)都是已独立、有通用复用价值的模块,但 `package.json` 只有 `.` 和 `./style.css` 两个 exports,CDN / 原生 ESM 场景无法按需引入。

5. **高频改动点散落核心装配逻辑中**。prompt 是每加一个能力就要改的高频点;LLM 配置是每加一个 provider/参数就要改的高频点。两者散在 `createChatSdk.ts` 里,改动污染核心装配主线,review 时难以聚焦。

## What Changes

### 1. P0 — 纯函数抽离(高收益,低风险)

#### 1.1 `tools/jsonUtils.ts`(从 `dataOps.ts` 抽出,~400 行)

零依赖纯函数(共 ~18 个)移入新文件:
- 路径操作:`getByPath` / `setByPath` / `deleteByPath`
- 克隆/序列化:`deepClone` / `safeStringify` / `hashValue` / `maybeParseValue`
- 投影/截断:`projectFields` / `limitDepth`
- 原型污染防护:`UNSAFE_KEYS` / `isUnsafePath` / `safeMerge`
- patch 应用:`applyPatchToClone` / `applyPatchToLive` / `restoreLive` / `restoreInPlace`

`dataOps.ts` 只剩工具装配 + schema 校验,体积砍一半。`dataOps.ts` 从 `./jsonUtils` import。

#### 1.2 `tools/schemaUtils.ts`(从 `dataOps.ts` 抽出,~80 行)

schema 白名单投影逻辑(护城河核心):
- `getSchemaTopKeys` / `isPathAllowed` / `unwrapSchema` / `getSchemaAtPath` / `projectBySchemaDeep` / `projectBySchema`

`dataOps.ts` 从 `./schemaUtils` import。

#### 1.3 `sdk/promptBuilder.ts`(从 `createChatSdk.ts` 抽出,~120 行)

- `DEFAULT_SYSTEM_PROMPT` / `buildDataPrompt()` / `extractSchemaHint` 调用 / `reliableWriteRules` 拼接逻辑
- 新增 `buildSystemPrompt(options, dataConfig)` 统一入口(处理 `appendReliableWriteRules` 分支 + 分割线)

`createChatSdk.ts` 从 `./promptBuilder` import,`buildCore` 只调 `buildSystemPrompt(options, finalDataConfig)`。

### 2. P0 — 对外开放 subpath(轻量,1-2 小时)

`package.json` `exports` 新增三个 subpath,指向同一 dist 文件 + 同一 types(不动构建):

```json
"./storage": { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
"./query":   { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
"./llm":     { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
```

语义清晰 + CDN 可按需入口。实际体积靠 bundler tree-shaking(已设 `sideEffects: ["**/*.css"]`)。

### 3. P1 — 状态机/桥接层抽离(中收益)

#### 3.1 `sdk/llmResolver.ts`(从 `createChatSdk.ts` 抽出,~80 行)

- `isChatModel()` / `buildSummaryLlmInvoke()` / `resolveModelCaps` 调用 / `LLMConfig` → `ChatOpenAI` 实例化
- 新增 `resolveLlm(options)` 统一入口,返回 `{ llm, modelCaps, summaryLlmInvoke }`

#### 3.2 `sdk/conflictManager.ts`(从 `createChatSdk.ts` 抽出,~50 行)

- `createConflictManager()` 工厂,返回 `{ pendingConflict, setPendingConflict, resolveConflict }`
- `buildCore` 持有实例;`dataOps` 的 `onConflict` 接 `conflictMgr.set`

#### 3.3 `sdk/skillStore.ts`(桥接层,从 `createChatSdk.ts` 抽出,~60 行)

- `toPersistedSkill` / `toSkillSpec` / `loadUserSkillsFromStore` / `syncUserSkills` / skillStore 初始化
- 注意:`backends/skillStore.ts`(存储后端)已存在,本抽离是 **createChatSdk ↔ store 的桥接层**
- 新增 `createSkillStoreBridge(options, messages)` 工厂

#### 3.4 `composables/contextIndex.ts`(从 `useContextManager.ts` 抽出,~150 行)

纯函数索引逻辑:
- `tokenize` / `STOP_WORDS` / `estimateMessageTokens` / `estimateRoundTokens` / `indexSummarize` / `recallRounds`

`useContextManager.ts` 只剩状态管理 + 滑动窗口,从 `./contextIndex` import。

### 4. P2 — 低频抽离(可选,按需)

#### 4.1 `sdk/events.ts`(~50 行)

`createSdkEvents()` 工厂返回 `{ emit, hook, middleware }`,集中事件系统逻辑。

#### 4.2 `sdk/optionsResolver.ts`(~40 行)

`resolveStorage()` / `resolveDialogConfig()` / 能力开关解析。

### 5. 测试同步

- **selftest**:jsonUtils / schemaUtils 纯函数补白盒单测(目前是黑盒);promptBuilder / llmResolver / conflictManager / skillStoreBridge / contextIndex 补单元断言
- **e2e**:无需新增(subpath exports 是配置变更,无运行时行为变化);`exports-consistency.mjs` 加 subpath 导出可用性断言
- **断言计数同步**:README / CLAUDE.md 中英文 + 测试矩阵

### 6. 文档同步

- `doc/architecture.md`:补「模块抽离」章节,说明 jsonUtils/schemaUtils/promptBuilder 等分层
- `doc/usage-guide.md`:补「按需引入」章节(subpath exports 用法)
- `README.md` / `README.zh-CN.md`:配置项速查 + 按需引入示例(中英同步)
- `CLAUDE.md`:目录结构 + 测试矩阵更新
- `skills/page-agent-sdk-integrate/references/`:按需引入 + subpath 文档

## Impact

- **改造**:
  - `src/core/tools/dataOps.ts`:抽出 ~18 个纯函数到 `jsonUtils.ts` + `schemaUtils.ts`,体积砍一半(~969 → ~480 行)
  - `src/core/sdk/createChatSdk.ts`:抽出 promptBuilder / llmResolver / conflictManager / skillStoreBridge,体积砍 ~40%(~1714 → ~1000 行)
  - `src/core/composables/useContextManager.ts`:抽出 contextIndex 纯函数,体积砍 ~45%(~321 → ~170 行)
- **新增**:`tools/jsonUtils.ts` / `tools/schemaUtils.ts` / `sdk/promptBuilder.ts` / `sdk/llmResolver.ts` / `sdk/conflictManager.ts` / `sdk/skillStore.ts` / `composables/contextIndex.ts`(P2 可选 `sdk/events.ts` / `sdk/optionsResolver.ts`)
- **对外开放**:`package.json` `exports` 加 `./storage` / `./query` / `./llm` 三个 subpath
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 2 条 Requirement(纯函数模块独立可用 / subpath 按需引入)
- **向后兼容**:
  - 顶层 `.` 入口导出不变(所有现有 import 路径零改动)
  - 抽出的函数/类型仍从顶层 `page-agent-sdk` 导出(只是源文件位置变了)
  - subpath 是新增入口,不删 `.` 入口
  - 运行时行为零变化(纯重构,无逻辑改动)
- **测试**:selftest 加纯函数白盒单测 + 工厂函数断言;e2e 不新增(subpath 经 exports-consistency 覆盖);断言计数同步

## Non-goals

- **不做** 多入口构建(`vite.config.ts` 多 entry 产出独立 chunk)—— 当前 bundler tree-shaking 已够用,多入口构建复杂度不划算,等真有 CDN 体积痛点再做
- **不做** 独立包 monorepo(`@page-agent-sdk/core` / `@page-agent-sdk/ui` 拆包)—— 小项目不值,维护成本翻倍
- **不做** `./harness` / `./tools` subpath 开放 —— 这两个带 vue / langchain tool 依赖,开放需先决策 vue 是否 external,留待真有「做变体 agent」诉求时再排期
- **不做** `createAgent` 内部逻辑抽离 —— `createAgent.ts` 562 行尚可接受,且是循环骨架,改动风险高
- **不做** UI 组件(`ChatDialog`/`MessageContent`)抽离 —— 跟 SDK 强绑定,单独抽无价值
- **不做** `backends/` 目录重构 —— `vfs.ts` / `storage.ts` 已独立,无需动
- **不做** 类型定义文件拆分 —— `types/index.d.ts` 单文件维护,subpath 共用同一 types
- **不做** `harness/state.ts` 的 `VfsFile`/`Todo` 类型迁移 —— 收益低,除非做 `./storage` 独立包

## 分期交付

| 期 | 内容 | 价值 | 风险 | 可独立发布 |
|---|---|---|---|---|
| 期一(P0) | jsonUtils + schemaUtils + promptBuilder 抽离 + subpath 开放 | 高 | 低 | ✅ |
| 期二(P1) | llmResolver + conflictManager + skillStoreBridge + contextIndex 抽离 | 中 | 低 | ✅(叠加期一) |
| 期三(P2) | events + optionsResolver 抽离(可选) | 低 | 低 | ✅(叠加期二) |

期一是核心 + 价值最高,可独立交付。期二/三在期一基础上叠加。全程零破坏性(纯重构 + 新增 subpath,运行时行为不变)。
