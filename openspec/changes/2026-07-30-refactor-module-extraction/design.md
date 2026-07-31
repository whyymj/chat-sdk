# Design: refactor-module-extraction

> 核心约束:**纯重构,运行时行为零变化**。抽离遵循三条原则:① 纯函数优先抽(零依赖、易白盒测、可对外开放);② 状态机抽工厂(有内部状态的抽成 `createXxx()` 工厂返回实例);③ 不跨层抽(不把 createAgent 内部往 createChatSdk 抽,不把 UI 往核心抽)。所有抽出的函数/类型仍从顶层 `page-agent-sdk` 导出,import 路径零改动。

## 1. 现状定位:三个巨型文件

**痛点① `createChatSdk.ts` 1751 行 / 37 imports**(上帝文件):

```
buildCore() 一个函数干 7 件事(行号为当前源码实际值,实施时以符号名为准 —— 行号随实现演进易过时):
├─ prompt 构建(DEFAULT_SYSTEM_PROMPT :297 + buildDataPrompt :306)
├─ LLM 解析(isChatModel :441 + buildSummaryLlmInvoke :539 + resolveModelCaps 调用 :681)
├─ 存储解析(resolveStorage :426 + resolveDialogConfig :436)
├─ 冲突管理(pendingConflict ref :649 + setPendingConflict :653 + resolveConflict :665)
├─ Skill 持久化桥接(toPersistedSkill :936 + toSkillSpec :942 + syncUserSkills :958 + loadUserSkillsFromStore :967)
├─ 事件系统(listeners :924 + emit + hook + createSdkEventMiddleware :609)
└─ 核心装配(中间件装载 + createAgent 调用 + sdk 返回对象)
```

**痛点② `dataOps.ts` 969 行**(混纯函数 + 工具装配):

```
零依赖纯函数(18 个,共 ~400 行):
├─ 路径操作:getByPath / setByPath / deleteByPath
├─ 克隆/序列化:deepClone / safeStringify / hashValue / maybeParseValue
├─ 投影/截断:projectFields / limitDepth
├─ 原型污染防护:UNSAFE_KEYS / isUnsafePath / safeMerge
├─ patch 应用:applyPatchToClone / applyPatchToLive / restoreLive / restoreInPlace
└─ schema 工具(6 个,~80 行):getSchemaTopKeys / isPathAllowed / unwrapSchema / getSchemaAtPath / projectBySchemaDeep / projectBySchema

工具装配(其余 ~490 行):createDataOps + filterByToolMode + schema 校验 + 工具定义
```

**痛点③ `useContextManager.ts` 321 行**(混响应式状态 + 纯函数索引):

```
纯函数索引逻辑(~150 行):
├─ STOP_WORDS / tokenize
├─ estimateMessageTokens / estimateRoundTokens
├─ indexSummarize(摘要生成)
└─ recallRounds(关键词召回)

响应式状态管理(~170 行):useContextManager + 滑动窗口 + 压缩触发
```

## 2. 解法:按职责切片,纯函数 + 工厂模式

### 2.1 纯函数抽离(P0,零风险)

**`tools/jsonUtils.ts`**(从 `dataOps.ts` 抽出):

```ts
export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export function isUnsafePath(path: string): boolean { ... }
export function safeMerge(target: Record<string, any>, src: unknown): void { ... }
export function getByPath(obj: unknown, path: string): unknown { ... }
export function setByPath(obj: unknown, path: string, value: unknown): void { ... }
export function deleteByPath(obj: unknown, path: string): boolean { ... }
export function deepClone<T>(v: T): T { ... }
export function maybeParseValue(v: unknown): { parsed?: unknown; parseError?: unknown } { ... }
export function projectFields(obj: unknown, fields: string[]): unknown { ... }
export function limitDepth(obj: unknown, depth: number): unknown { ... }
export function safeStringify(value: unknown, maxLen = Infinity): string { ... }
export function hashValue(value: unknown): string { ... }
export function applyPatchToClone(clone: any, op: EditOp, jsonPath: string, value: unknown): string | null { ... }
export function applyPatchToLive(bind: any, op: EditOp, jsonPath: string, value: unknown): void { ... }
export function restoreLive(bind: any, snapshotVal: unknown): void { ... }
export function restoreInPlace(live: Record<string, unknown> | unknown[], snapshotVal: unknown): void { ... }
```

> `EditOp` 类型从 `dataOps.ts` 移到 `jsonUtils.ts`(纯类型,移到 jsonUtils 避免反向依赖)。

**`tools/schemaUtils.ts`**(从 `dataOps.ts` 抽出):

```ts
import type { ZodType } from 'zod'
export function getSchemaTopKeys(schema: ZodType): string[] | null { ... }
export function isPathAllowed(jsonPath: string, schema: ZodType | null, allowKeys: string[] | null): boolean { ... }
export function unwrapSchema(schema: any): any { ... }
export function getSchemaAtPath(schema: ZodType, jsonPath: string): ZodType | null { ... }
export function projectBySchemaDeep(obj: unknown, schema: ZodType | null): unknown { ... }
export function projectBySchema(obj: unknown, allowKeys: string[] | null): unknown { ... }
```

> schemaUtils 依赖 zod 类型(纯类型依赖,无运行时依赖)。

**`dataOps.ts` 改造后**:

```ts
import { getByPath, setByPath, deepClone, applyPatchToLive, restoreLive, ... } from './jsonUtils'
import { getSchemaTopKeys, isPathAllowed, getSchemaAtPath, projectBySchemaDeep, ... } from './schemaUtils'
// 只剩:createDataOps(工具装配) + filterByToolMode + schema 校验逻辑 + 工具定义
```

### 2.2 提示词构建抽离(P0,高频改动点)

**`sdk/promptBuilder.ts`**(从 `createChatSdk.ts` 抽出):

```ts
import { extractSchemaHint, systemPromptHelpers } from '../presets'
import type { ChatSdkOptions, DataConfig } from './createChatSdk'

export const DEFAULT_SYSTEM_PROMPT = [ ... ].join('\n')

export function buildDataPrompt(data: DataConfig | undefined): string { ... }

// 新增统一入口:处理 appendReliableWriteRules 分支 + 分割线
export function buildSystemPrompt(options: ChatSdkOptions, dataConfig?: DataConfig): string {
  const userPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  const appendRwr = options.appendReliableWriteRules !== false
  if (!appendRwr || !userPrompt) return userPrompt
  return `${userPrompt}\n\n---\n\n${systemPromptHelpers.reliableWriteRules}`
}
```

**`createChatSdk.ts` 改造后**:

```ts
import { buildSystemPrompt } from './promptBuilder'
const baseSystemPrompt = buildSystemPrompt(options, finalDataConfig)
```

### 2.3 状态机/桥接层抽离(P1,工厂模式)

**`sdk/llmResolver.ts`**(从 `createChatSdk.ts` 抽出):

```ts
export function isChatModel(v: unknown): v is BaseChatModel { ... }
export function buildSummaryLlmInvoke(options: ChatSdkOptions): ((prompt: string) => Promise<string>) | undefined { ... }
export function resolveLlm(options: ChatSdkOptions): {
  llm: BaseChatModel
  modelCaps: ModelCaps
  summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined
} { ... }
```

**`sdk/conflictManager.ts`**(从 `createChatSdk.ts` 抽出):

```ts
export interface ConflictManager {
  pendingConflict: Ref<PendingConflict | null>
  set(info: ConflictInfo): Promise<ConflictResolution>
  resolve(action: ConflictResolution['action']): void
}
export function createConflictManager(): ConflictManager { ... }
```

**`sdk/skillStore.ts`**(桥接层,从 `createChatSdk.ts` 抽出):

```ts
// 注意:backends/skillStore.ts 是存储后端(已存在);本文件是 createChatSdk ↔ store 的桥接层
export interface SkillStoreBridge {
  loadUserSkills(): Promise<void>
  syncUserSkills(): void
  store: SkillStore | null
}
export function createSkillStoreBridge(
  options: ChatSdkOptions,
  messages: AgentMessage[],
  setSkills: (skills: SkillSpec[]) => void,
): SkillStoreBridge { ... }
```

**`composables/contextIndex.ts`**(从 `useContextManager.ts` 抽出):

```ts
export const STOP_WORDS = new Set([ ... ])
export function tokenize(text: string): string[] { ... }
export function estimateMessageTokens(m: AgentMessage): number { ... }
export function estimateRoundTokens(r: Round): number { ... }
export function indexSummarize(older: Round[], preserve?: Set<string>): string { ... }
export function recallRounds(older: Round[], query: string, topK: number): Round[] { ... }
```

### 2.4 对外开放 subpath(P0,配置变更)

`package.json` `exports` 新增:

```json
{
  ".": { ... },
  "./storage": { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
  "./query":   { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
  "./llm":     { "types": "./types/index.d.ts", "import": "./dist/page-agent-sdk.js" },
  "./style.css": "./dist/page-agent-sdk.css"
}
```

- 指向同一 dist + 同一 types(不动构建)
- 语义清晰:用户写 `from 'page-agent-sdk/storage'` 表明只用持久化层
- CDN 可按需入口(esm.sh 上 `page-agent-sdk/storage` 可独立缓存)
- 实际体积靠 bundler tree-shaking(已设 `sideEffects: ["**/*.css"]`)

## 3. 抽离后 `createChatSdk.ts` 目标形态

抽完 P0+P1 后,`buildCore` 主线变成:

```ts
function buildCore(options, agentId): AgentCore {
  // 1. 配置解析(各模块独立)
  const { llm, modelCaps, summaryLlmInvoke } = resolveLlm(options)
  const store = resolveStorage(options.storage)
  const dialogCfg = resolveDialogConfig(options)
  const baseSystemPrompt = buildSystemPrompt(options, finalDataConfig)

  // 2. 状态(工厂返回实例)
  const messages = reactive<AgentMessage[]>([])
  const conflictMgr = createConflictManager()
  const events = createSdkEvents(options.onEvent)  // P2

  // 3. 数据层
  const dataOps = useDataOps ? createDataOps(finalDataConfig, { onConflict: conflictMgr.set }) : []

  // 4. Skill 持久化桥接
  const skillBridge = createSkillStoreBridge(options, messages, setSkills)

  // 5. 中间件装配(清晰列出装载序)
  const middlewares = [todosMw, skillsMw, vfsMw, summarizationMw, memoryMw, ...]

  // 6. createAgent
  const agent = createAgent({ llm, tools, middlewares, ... })

  // 7. 返回 sdk 对象
  return { agent, messages, conflict: conflictMgr, events, skillBridge, ... }
}
```

主线只看装配顺序,细节都在各自模块里。体积从 1751 行降到 ~900 行。

## 4. 依赖方向(确保不循环)

```
createChatSdk.ts
  ├─> promptBuilder.ts  (无内部依赖)
  ├─> llmResolver.ts   (依赖 utils/modelCaps)
  ├─> conflictManager.ts (依赖 types)
  ├─> skillStore.ts    (依赖 backends/skillStore + types)
  └─> dataOps.ts
       ├─> jsonUtils.ts   (零依赖)
       └─> schemaUtils.ts (依赖 zod 类型)

useContextManager.ts
  └─> contextIndex.ts  (依赖 types)
```

所有箭头单向向下,无循环。jsonUtils / schemaUtils / contextIndex 在最底层(零或仅类型依赖)。

## 5. 测试策略

### 5.1 纯函数白盒单测(新增,高价值)

目前 dataOps 的 18 个纯函数是黑盒测(经工具调用间接覆盖),抽出后补白盒单测:

```ts
// sec-30: jsonUtils 白盒
assert(deepClone({a:[1,2]}).a !== original.a)  // 深拷贝独立
assert(getByPath({a:{b:1}}, 'a.b') === 1)
assert(setByPath({}, 'a.b.c', 1) 创建嵌套)
assert(applyPatchToClone(clone, 'set', 'a.b', 2) 返回 null 表示成功)
assert(isUnsafePath('__proto__.x') === true)  // 原型污染防护
// ... 每个 pure function 至少 2 条断言(正常 + 边界)

// sec-31: schemaUtils 白盒
assert(getSchemaTopKeys(z.object({a:z.string(), b:z.number()})) 深度等于 ['a','b'])
assert(isPathAllowed('a', schema, null) === true)
assert(projectBySchemaDeep({a:1, b:2, c:3}, schema) 去掉 c)

// sec-32: contextIndex 白盒
assert(tokenize('Hello World hello') 去停用词后等于 ['hello', 'world'])
assert(estimateMessageTokens({role:'user', content:'a'.repeat(10)}) 合理估算)
assert(recallRounds(older, 'keyword', 2) 返回 top 2 相关)
```

### 5.2 工厂函数断言

```ts
// promptBuilder
assert(buildSystemPrompt({systemPrompt:'X'}, data) 含 'X\n\n---\n\n' + reliableWriteRules)
assert(buildSystemPrompt({systemPrompt:'X', appendReliableWriteRules:false}, data) === 'X')
assert(buildSystemPrompt({}, data) === DEFAULT_SYSTEM_PROMPT)

// llmResolver
assert(resolveLlm({llm:{apiKey,model}}) 返回 ChatOpenAI 实例 + modelCaps)
assert(resolveLlm({llm: chatModelInstance}) 直接用实例)

// conflictManager
const mgr = createConflictManager()
assert(mgr.pendingConflict.value === null)
await mgr.set(info); assert(mgr.pendingConflict.value !== null)
mgr.resolve('keep_external'); assert(mgr.pendingConflict.value === null)

// skillStoreBridge
assert(createSkillStoreBridge({skillsStorage:'memory'}, ...) store 为 null)
```

### 5.3 e2e 无需新增

subpath exports 是配置变更,无运行时行为变化。`exports-consistency.mjs` 加 subpath 导出可用性断言:

```js
assert(await import('page-agent-sdk/storage') 含 createSessionStore)
assert(await import('page-agent-sdk/query') 含 jpEval/searchJson)
assert(await import('page-agent-sdk/llm') 含 createProxyLlm)
```

## 6. 与 2026-07-31 系列 change 的顺序协调

本变更是**基础设施**(纯重构),与同批 8 个新 change 有同区域文件交集。完整顺序表见 `proposal.md`「与 2026-07-31 系列 change 的顺序协调」。此处只列**实施本变更时必须注意的协同点**:

1. **`deleteByPath` 搬迁的 sparse-array 修复**:本变更把 `deleteByPath` 从 dataOps 搬到 jsonUtils。`fix-dataops-write-correctness` 指出 `deleteByPath` 对数组元素用 `delete arr[i]`(产生稀疏数组)应改 `splice`。**实施本变更时**:若 fix-dataops 已先实施 → 直接搬修复版;若未实施 → 搬迁时一并应用 splice 修复(避免把 bug 搬进 jsonUtils),并在搬迁 commit 标注"含 fix-dataops 的 deleteByPath 修复"。修复点:`if (Array.isArray(cur) && /^\d+$/.test(last)) cur.splice(Number(last), 1); else delete cur[last]`。

2. **jsonUtils/schemaUtils 是后续新函数的归宿**:本变更建好两个文件后,`harden-optimistic-lock` 的 `cyrb53`、`evolve-default-toolset` 的 `diffObjects` 落入 jsonUtils;`expose-schema-constraints` 的 `describeSchemaNode` 落入 schemaUtils(复用本变更抽出的 `unwrapSchema`)。本变更只需建文件 + 搬现有函数,无需预留接口。

3. **`buildSystemPrompt` 是 prompt 单一出口**:本变更新增 `buildSystemPrompt(options, dataConfig)` 统一入口。`fix-introspection-consistency` 的 `getEffectiveSystemPrompt()` 直接代理到它(prompt 拼装收敛为单一真相源)。本变更把 `buildSystemPrompt` 设计为纯函数(入参 options + dataConfig,无闭包依赖),便于后续 `getEffectiveSystemPrompt` 复用。

4. **装配段抽离与 `declarative-middleware-ordering`**:本变更(期二/三)抽 conflictManager/skillStoreBridge/events,改 createChatSdk 装配段。`declarative-middleware-ordering` 把中间件数组改为 priority 声明式排序。两者都动装配段 → **declarative 必须后于本变更**(本变更先理清装配,declarative 再声明式化)。

## 权衡

- **为何不做多入口构建**:当前 bundler tree-shaking 已能 shake 掉未用 named export(已设 `sideEffects`)。多入口构建要改 vite.config + 拆 types + 管共享 chunk,复杂度不划算。CDN 场景 subpath 指向同一文件至少语义清晰 + 可独立缓存。等真有 CDN 体积痛点再做。
- **为何 subpath 指向同一 dist 而非独立 chunk**:独立 chunk 要多入口构建。同一 dist + bundler tree-shaking 已能覆盖主流场景。subpath 的价值是**语义清晰 + CDN 入口独立 + 未来切多入口时零迁移**。
- **为何纯函数优先抽**:零依赖、零风险、易白盒测、可对外开放。dataOps 的 18 个纯函数目前是黑盒测,抽出后补白盒单测,测试质量提升明显。
- **为何状态机抽工厂而非抽纯函数**:conflictManager / skillStoreBridge 有内部状态,抽成 `createXxx()` 工厂返回实例,buildCore 持有实例,生命周期清晰。
- **为何不抽 createAgent 内部**:createAgent.ts 569 行尚可接受,且是 ReAct 循环骨架,改动风险高。抽离收益不抵风险。
- **为何 EditOp 类型移到 jsonUtils**:applyPatchToClone/Live 需要 EditOp 类型,若留 dataOps 会导致 jsonUtils 反向依赖 dataOps(循环)。EditOp 是纯类型,移到 jsonUtils 合理。

## 风险

- **import 路径遗漏**:抽离后 dataOps.ts / createChatSdk.ts / useContextManager.ts 需补 import。漏补 → 编译错。靠 `npm run test:types` 捕获。
- **类型导出遗漏**:抽出的类型(如 `EditOp`、`ConflictManager`、`SkillStoreBridge`)需在 `types/index.d.ts` + `src/core/index.ts` 同步导出。靠 `npm run test:exports` 捕获。
- **运行时行为变化**:纯重构原则 —— 只移动代码,不改逻辑。每个函数体逐字搬迁,不重构内部。靠 `npm test` + `npm run test:e2e` 全过保证。
- **subpath 指向同一 dist 的体积问题**:CDN 原生 ESM 场景 `import` 仍下全量文件。靠 tree-shaking 在 bundler 侧解决;真有痛点再做多入口构建。本变更不解决 CDN 体积,只解决语义 + 入口独立。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/tools/jsonUtils.ts` | 新增(从 dataOps.ts 抽出 18 个纯函数 + EditOp 类型) |
| `src/core/tools/schemaUtils.ts` | 新增(从 dataOps.ts 抽出 6 个 schema 工具) |
| `src/core/tools/dataOps.ts` | 改:从 jsonUtils/schemaUtils import,体积砍一半 |
| `src/core/sdk/promptBuilder.ts` | 新增(DEFAULT_SYSTEM_PROMPT + buildDataPrompt + buildSystemPrompt) |
| `src/core/sdk/llmResolver.ts` | 新增(isChatModel + buildSummaryLlmInvoke + resolveLlm) |
| `src/core/sdk/conflictManager.ts` | 新增(createConflictManager 工厂) |
| `src/core/sdk/skillStore.ts` | 新增(createSkillStoreBridge 桥接层) |
| `src/core/composables/contextIndex.ts` | 新增(从 useContextManager 抽出 6 个纯函数) |
| `src/core/composables/useContextManager.ts` | 改:从 contextIndex import,体积砍 ~45% |
| `src/core/sdk/createChatSdk.ts` | 改:从各模块 import,体积砍 ~40% |
| `src/core/index.ts` | 改:导出新模块的 export(jsonUtils/schemaUtils/promptBuilder 等) |
| `types/index.d.ts` | 改:同步新类型(EditOp/ConflictManager/SkillStoreBridge) |
| `package.json` | 改:exports 加 ./storage / ./query / ./llm |
| `src/core/__tests__/modules/sec-30.ts` | 新增:jsonUtils 白盒单测 |
| `src/core/__tests__/modules/sec-31.ts` | 新增:schemaUtils 白盒单测 |
| `src/core/__tests__/modules/sec-32.ts` | 新增:contextIndex + 工厂函数断言 |
| `src/core/__tests__/selftest.ts` | 改:注册 sec-30/31/32 |
| `tests/exports-consistency.mjs` | 改:加 subpath 导出可用性断言 |
| `doc/architecture.md` | 改:补「模块抽离」章节 |
| `doc/usage-guide.md` | 改:补「按需引入」章节 |
| `README.md` / `README.zh-CN.md` | 改:按需引入示例(中英同步) |
| `CLAUDE.md` | 改:目录结构 + 测试矩阵更新 |
| `skills/page-agent-sdk-integrate/references/` | 改:按需引入 + subpath 文档 |
