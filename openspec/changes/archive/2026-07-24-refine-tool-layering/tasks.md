# Tasks: refine-tool-layering

> 状态:**已完成(待归档)**。关联:本目录 `proposal.md` / `design.md`;`doc/待确认问题.md` #1#2#6#12#3。

## 期一 — 内置工具可关 + 工具集导出(#1 #2 #6)

- [x] `createPageAgent.ts`:`capabilities` 加 `windowOps?: boolean` / `fetch?: boolean`(默认 `true`);内置工具筛选经纯函数 `selectBuiltinTools(caps, windowOps, fetchDoc)`(放 `toolsets.ts`,可单测)
- [x] 确认连锁行为:关 `windowOps` 时子 agent 只读白名单同步筛除(design §1,符合语义,文档说明)
- [x] `index.ts` + `types/index.d.ts`:导出 `createWindowOps` / `WindowOpsOptions` / `fetchDocTools`
- [x] `fetchTools` 静态 toolset 预设 + `defineWindowToolset(props)` 工厂(均放 `toolsets.ts`;window 不预构造,因依赖 props)
- [x] 自测:`selectBuiltinTools` 筛选 6 项(默认全装 / windowOps:false / fetch:false / 都关)+ `fetchTools`/`defineWindowToolset` 结构。⚠️ 实施校正:selftest 不能 import `createPageAgent`(会拉 `.vue` SFC,tsx 编译不了),故把筛选逻辑抽为纯函数 `selectBuiltinTools` 单测,而非测 `inspect()`

## 期二 — 默认 maxTokens + 能力用法提示(#12 #3)

- [x] `createAgent.ts`:`maxTokens` 默认 `8192` → `16384`
- [x] `createUsageHintsMiddleware(caps, hasWindowOps)`(纯 augmentPrompt,按 caps 注入 planning/snapshot/spawn 用法)抽到独立 `harness/usageHints.ts`(可单测,避免 createPageAgent 的 .vue 污染);`createPageAgent` 装载栈最前
- [x] `subagent.ts`:默认 systemPrompt 补「你只有只读工具(读 window / 抓文档),给出简洁结论」
- [x] 自测:`usageHints` 注入 5 项(全开三提示 / planning 关无 write_todos / 无 window 无 snapshot / 全关 undefined / name)

## 期三 — 收口(文档 / 门禁 / 归档)

- [x] `CLAUDE.md`:能力开关加 `windowOps`/`fetch`(含子 agent 连锁说明)+ 目录补 `toolsets.ts`/`usageHints.ts` + 中间件顺序补 usageHints/subagent + 工具集手动注入段 + maxTokens 16384 + 自测 157 项
- [x] `doc/usage-guide.md`:示例 `capabilities` 加 `windowOps`/`fetch` + FAQ 补 + maxTokens 默认 16384(×2 处)
- [x] 门禁:`tsc` + `test`(157/157)+ `build`(ESM/UMD 388KB/IIFE 1.59MB)全过
- [x] `/opsx:archive refine-tool-layering`(specs 增量 3 条合入主 specs)

> 全程向后兼容:`capabilities` 默认全开 = 现状行为。新增导出:`createWindowOps` / `fetchDocTools` / `fetchTools` / `defineWindowToolset` / `selectBuiltinTools` / `createUsageHintsMiddleware`。
