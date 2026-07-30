# Tasks: add-augment-system-hook

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。
> 顺序:期一(类型,零运行时依赖)→ 期二(A4 动态化,修 Bug)→ 期三(augmentSystem 钩子)→ 期四(测试同步)→ 期五(文档 + 门禁 + 归档)。
> 全程向后兼容:不配 `augmentSystem` = 现状;A4 仅从 const 变每轮动态、输出等价。

## 期一 — 类型(SystemAugmentContext + 选项)

- [x] `createChatSdk.ts`:`ChatSdkOptions` 加 `augmentSystem?: (ctx: SystemAugmentContext) => string | undefined`;定义 `export interface SystemAugmentContext { state: HarnessState; data?: DataConfig }`(import `HarnessState` from `harness/state`,`DataConfig` 已 import)
- [x] `types/index.d.ts`:镜像 `SystemAugmentContext` + `ChatSdkOptions.augmentSystem?`(参考 systemPrompt / memory 字段写法);微调 `systemPrompt` 注释为「base + 可操作数据段(随 data 动态);不含 todos/skills/memory/augmentSystem 等运行态 augmentPrompt 段」
- [x] 门禁:`npm run test:types` 全过

## 期二 — A4 数据段动态化(修 setData 不同步 Bug)

- [x] `createChatSdk.ts:671`:拆 `const baseSystemPrompt = basePrompt`(去掉 `+ buildDataPrompt(finalDataConfig)`)
- [x] 新增 `dataHintMw: { name: 'dataHint', augmentPrompt: () => buildDataPrompt(liveData()) }`;插中间件数组最前(usageHints 866 前);仅 `finalDataConfig` 存在时装载
- [x] `createChatSdk.ts:1207`:`createAgent` 传 `systemPrompt: baseSystemPrompt`
- [x] `createChatSdk.ts:1079`:`getInfo().systemPrompt` 改 `baseSystemPrompt + buildDataPrompt(liveData()) + augmentSystem 段`(动态重算,保 inspect 兼容 + setData 同步 + augmentSystem 可观测)
- [x] selftest(`src/core/__tests__/modules/`,加 sec-19 或新模块):dataHint 有 data → 含 schema hint;无 data → undefined。runner 注册 + 断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`(systemprompt.mjs 不断、inspect 含 dataHint)

## 期三 — augmentSystem 钩子中间件

- [x] `createChatSdk.ts`:新增 `augmentSystemMw: { name: 'augmentSystem', augmentPrompt: (state) => options.augmentSystem?.({ state, data: liveData() }) }`;回调包 try/catch(异常降级跳过 + debug 日志);插 subagents(905)后、`options.middleware`(906)前;仅 `options.augmentSystem` 存在时装载
- [x] selftest:augmentSystemMw 回调被调用且收到 `{ state, data }`;返回值作为段;返回 undefined 跳过;`data` 随 liveData 变(controller.set 后)。断言计数同步
- [x] 门禁:`npm run test:types` + `npm test` 全过

## 期四 — e2e 同步

- [x] `tests/e2e/inspect.mjs`:`inspect().middleware` 含 `dataHint`(配 data 时)/ 含 `augmentSystem`(配 augmentSystem 时);无 data 时不含 dataHint
- [x] `tests/e2e/dynamic-register.mjs`:**关键新断言** —— `setData` 换 schema 后,`inspect().systemPrompt` 反映新 description(验证 A4 动态化已修 Bug)
- [x] `tests/e2e/custom-injection.mjs`:augmentSystem 注入内容可观测
- [x] 断言计数同步(README / CLAUDE.md 中英文 + 测试矩阵)

## 期五 — 收口(文档 / 门禁 / 归档)

- [x] `doc/system-prompt.md`:A4 从「块 A」改标「块 B 首段(dataHint 中间件)」;新增 B7 `augmentSystem` 段;**删除 §5③ setData 不同步 Bug 段**(已修);更新两 mermaid 流程图 + 各段详解表
- [x] `CLAUDE.md`:架构要点 / SDK 用法补 `augmentSystem`;Agent 身份职责分工提及「动态组件说明走 augmentSystem」
- [x] `README.md` / `README.zh-CN.md`:配置项速查补 `augmentSystem`(中英同步)
- [x] 门禁:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:exports` → `npm run test:types` → `npm run test:size` → `npm pack --dry-run` 全过
- [x] 归档:specs 增量(2 条)合入 `openspec/specs/page-agent-core.md`;change 移入 `openspec/changes/archive/`

> 备注:期二(A4 动态化)可独立交付 —— 它修了一个已标记 Bug,即使不要 augmentSystem 钩子也值得做。期三在期二基础上叠加便捷钩子。全程零破坏性。
