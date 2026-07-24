# Tasks: add-verify-middleware

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`;`doc/evolution-roadmap.md` #5。
> 顺序:期一(循环钩子点,纯机制,可独立验证)→ 期二(中间件模板)→ 期三(内置 domain check)→ 期四(对抗验证)→ 收口。

## 期一 — 循环钩子点(核心机制,零领域依赖)

- [x] `state.ts`:`HarnessState` 加 `verifyAttempts: number`;`createInitialState` 初始化 `0`
- [x] `middleware.ts`:`Middleware` 契约加可选 `beforeReturn?: BeforeReturnHook`;定义 `BeforeReturnContext` / 返回类型(`string | null`)
- [x] `middleware.ts`:`runBeforeReturn(middlewares, ctx)` 执行器(正序遍历,拼接所有非 null feedback,全 null 返回 null)
- [x] `createAgent.ts`:`CreateAgentOptions` 加 `maxVerifyAttempts?: number`(默认 `0` = 关闭自纠,纯放行;>0 启用)
- [x] `createAgent.ts`:第 310 行 `if (!response.toolCalls.length)` 收口处插入 `beforeReturn` 钩子点(见 design §1);`canRetry` 判定 + `verifyAttempts++` + push `HumanMessage` + `continue`
- [x] 自测 `selftest.ts`:`runBeforeReturn` 纯函数 6 项(拼接 / 全 null / 部分 null / 无钩子 / 异步 + `verifyAttempts` 初始化)。**stream 自纠循环 + `maxVerifyAttempts` 上限兜底属运行时行为(依 LLM),按 subagent/mcp 惯例手动验证**。门禁 `tsc` + `npm test` 全过(127/127)
- [x] code-review 修复(APPROVE,0 CRITICAL/HIGH):**MEDIUM-1** 预算检查前置(`maxVerifyAttempts>0 && verifyAttempts<maxVerifyAttempts` 在 `runBeforeReturn` 前,避免预算耗尽仍跑钩子 / adversarial 烧 token)+ **MEDIUM-2** `lastFinalContent` 缓存(自纠耗尽 rounds 兜底优先返回有效最终答,非误导文案)+ **LOW-4** design 类型同步(`BaseMessage[]`);LOW-1/2/3/5 评估接受现状(行为正确 / 与现有执行器一致 / 成本不抵)。design §1 已同步为最终实现版;重跑门禁 tsc+test 全过(127/127)

## 期二 — `createVerifyMiddleware` 模板

- [x] 新 `src/core/harness/verify.ts`:导出 `createVerifyMiddleware({ check, maxAttempts?, adversarial? })`(adversarial 字段期二接受但 no-op,期四实现)
- [x] `check` 接口类型(`VerifyCheck` / `VerifyCheckContext` / `VerifyCheckResult`);`ok=true` 放行,`ok=false` 返回 `feedback`。⚠️ 实施校正:`VerifyCheckContext.messages` 用 `BaseMessage[]`(非 design 原写 `AgentMessage[]`——与 beforeReturn 底层一致,期三 createWriteBackCheck 据此找 ToolMessage;design §3 已同步)
- [x] verify 中间件把 `check` 包成 `beforeReturn` 钩子
- [x] `createPageAgent.ts`:`PageAgentOptions.verify?` + `capabilities.verify`(默认 false);`useVerify = caps.verify===true && verify.enabled!==false && verify.check`;装载 `permissions` 之后;`maxVerifyAttempts: useVerify ? (verify.maxAttempts ?? 2) : 0` 透传 createAgent
- [x] 类型 + `.d.ts`:`VerifyCheck`/`VerifyCheckContext`/`VerifyCheckResult`/`VerifyMiddlewareOptions`;`index.ts` 导出 `createVerifyMiddleware`。注:`VerifyOptions` 未单独导出,内联于 `PageAgentOptions.verify`(design §6 一致)
- [x] 自测:5 项(check ok / fail+feedback / 无 feedback / 异步 + name)。门禁 tsc + test 全过(132/132)
- [x] code-review(APPROVE,0 CRITICAL/HIGH):**MEDIUM-1** adversarial 未实现加 warn + **MEDIUM-2** "传 verify.check 忘 capabilities.verify" 误用加 warn + **MEDIUM-3** 移除 `VerifyMiddlewareOptions.maxAttempts` 死字段(预算只经 createAgent `maxVerifyAttempts`) + **LOW-1** useVerify 加 `maxAttempts>0` 判定(防 maxAttempts:0 装载不运行)+ **LOW-2** `AgentInfo` 加 `verify` 装载状态(getInfo 暴露,同步源码 `types/index.ts` + `.d.ts`)。重跑门禁 tsc+test+build 全过

## 期三 — 内置 domain check `createWriteBackCheck()`

- [x] `verify.ts`:导出 `createWriteBackCheck(opts?)` —— 从最近一轮 **tool_call 的 args**(set/edit/delete_window_prop)提取 path,读回 + schema 校验。注:从 args 提取(非 tool_result 文本解析,更可靠);区分 delete(读回空=成功)/ set·edit(读回应有值 + 符合 schema)
- [x] 读回前 `await nextTick()`(Vue reactive 异步);读回为空 / 不符合 schema / delete 后仍有值 → `feedback`
- [x] `createPageAgent`:`verify.check` 省略时默认 `createWriteBackCheck({ schemas: windowProps 映射 })`;`useVerify` 去掉 `&& check`(check 现可选)
- [x] `index.ts` + `.d.ts` 导出 `createWriteBackCheck` + `WriteBackCheckOptions`
- [x] 自测:6 项(无写 / set 符合 / set 空 / set 不符 / delete 空 / delete 有值)。门禁 tsc + test 全过(138/138)
- [x] code-review(WARN→修后 PASS):**HIGH** `extractWrites` 扫描范围扩大到整个会话所有写(非仅最近一轮;按 path 去重保留最后操作,覆盖「写→读→答」序列)+ **MEDIUM** 关联 ToolMessage 判断写是否被合法拒绝(校验失败/范围拒绝),被拒则跳过不误报 + **LOW** 移除不必要 `nextTick`(windowOps 写入同步,消除 verify.ts 运行时 vue 依赖,回归 type-only import)+ 补 edit/被拒写/写读答序列 3 项测试(6→9 项,138→141)。LOW(capabilities.verify 无 check 的行为变化)接受为期三设计意图,期五文档补

## 期四 — 对抗式验证(check 通过后 spawn 找茬子 agent,refute 姿态)

- [x] `verify.ts`:`runAdversarial`(createAgent 构造**无工具纯审查**子 agent,refute 姿态;verdict 命中 `isAdversarialClean` → 放行,否则回灌)+ `extractLastTurn` + `isAdversarialClean`(导出)。⚠️ 实施校正:不复用 `runSubagent`(其为 spawn 工具设计,签名重 allTools/forward;对抗验证无需,用 createAgent 直接更简);子 agent 无工具(复查 window 交 createWriteBackCheck)
- [x] `createVerifyMiddleware.beforeReturn`:check 不通过 → feedback;check 通过 + adversarial → `runAdversarial` 再审(突破自审 confirmation bias)
- [x] `createPageAgent`:`verify.adversarial: true` → 透传 `{ llm: options.llm }` 给 verify 中间件;移除期二的 adversarial warn(现已实现)
- [x] 默认 `adversarial: undefined`(token 成本,显式开启);check 通过后才跑(避免 factual 快速失败浪费子 agent)
- [x] 自测:`isAdversarialClean` verdict 判定 5 项(`runAdversarial` 整体依 LLM,手动验证)。门禁 tsc + test + build 全过(146/146)

## 期五 — 收口(文档 / 门禁 / 归档)

- [x] `CLAUDE.md`:架构要点加「Verify 自检中间件」小节 + 中间件契约加 `beforeReturn` + 内置顺序加 verify + 目录树 verify.ts + SDK 用法示例 + 自测 146 项
- [x] `doc/usage-guide.md`:6.10 Verify 小节(用法 / 内置 check / 自定义 check「具体可操作 feedback」指引 / 对抗验证)+ 配置项 + 核心概念表
- [x] `doc/evolution-roadmap.md`:标 #5 已实现 + 补注 beforeReturn 是 #2 前身
- [x] 门禁:`tsc` + `test`(146/146)+ `build`(ESM/UMD/IIFE)全过
- [x] 归档:specs 增量(5 条,修正版反映实际实现)合入 `openspec/specs/page-agent-core.md`(顺手更新自测条 51→146);change 移入 archive

> 备注:期一可独立交付(纯循环机制,无 verify 概念)—— 若想最小步推进,期一单独成一个可验证里程碑,期二三四增量叠加。全程向后兼容:不传 `verify` / `capabilities.verify: false` = 现状。
