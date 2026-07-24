# Change: add-verify-middleware

> 对应 `doc/evolution-roadmap.md` #5(Verify 自检中间件,P2)。
> 是 roadmap 剩余 4 项(#2/#4/#5/#6)中**唯一价值实 + 循环改动最小**的一项,且其引入的 `beforeReturn` 钩子点正是 #2(Plan/问答)所需"循环可挂起"的轻量前身 —— 先做 #5 等于半价给 #2 铺路。

## Why

1. **写后无自检,对错靠肉眼**。page-agent 核心动作是写宿主 `window`(`set/edit/delete_window_prop`)。agent 写完即返回,不验证写入是否生效 / 是否符合预期。对一个会改宿主页状态的 agent,这是可信度缺口,不是体验补强。
2. **现有钩子无法"回灌继续"**。`afterAgent` 在 `return` 之后触发,无法把"验证未通过"的反馈作为新消息注入、驱动 agent 自纠。系统需要一个"agent 准备结束时,可拦截并要求它继续改"的机制。
3. **前置已就绪**。#5 的对抗式验证依赖 #1 子 agent —— 已实现完成,零额外机制即可接入。

## What Changes

1. **新中间件钩子点 `beforeReturn`**:agent 即将返回最终结果前(`createAgent` 主循环 `if (!response.toolCalls.length)` 收口处)执行;钩子可返回"反馈",系统将其作为新 user 消息注入并**继续循环**(非 return),驱动 agent 自纠。**纯增量插入,不重构循环骨架**。
2. **`createVerifyMiddleware({ check, maxAttempts? })` 中间件模板**:把领域 `check` 函数包成 `beforeReturn` 钩子。
3. **自纠上限兜底**:`maxVerifyAttempts`(默认 2),超限强制 return,防死循环烧 token。
4. **内置 domain 辅助 `createWriteBackCheck()`**(可选):写后读回验证 —— 检测当轮是否有写 window 操作,读回被改属性确认生效。集成方也可完全自定义 `check`。
5. **对抗式验证**(可选,`adversarial: true`):verify 中间件内部 spawn 一个"找茬"子 agent 审查结果,复用 #1 子 agent。
6. **配置入口**:`createPageAgent({ verify: { enabled?, check?, maxAttempts?, adversarial? } })` + `capabilities.verify`(默认关闭,向后兼容)。

## Impact

- **新增**:`harness/verify.ts`(`createVerifyMiddleware` + `createWriteBackCheck`)、中间件 `beforeReturn` 钩子契约、`runBeforeReturn` 执行器。
- **改造**:`createAgent.ts` 主循环(第 310 行收口处插入钩子点,**增量非重构**)、`state.ts`(`verifyAttempts` + `maxVerifyAttempts`)、`middleware.ts`(契约加 `beforeReturn`)。
- **影响规范**:`specs/page-agent-core.md` 增量(`beforeReturn` 钩子语义 + Verify 自检 Requirement)。
- **向后兼容**:不传 `verify` / `capabilities.verify: false` = 完全现状行为;`beforeReturn` 钩子为可选,旧中间件不受影响。
- **演进铺垫**:本 change 引入的 `beforeReturn` 钩子点 = "循环中途停下 → 注入 → 继续"的骨架,是后续 #2(Plan/问答 pause/resume)的轻量前身。做完 #5,#2 只需把"同步取反馈"升级为"await UI 异步取反馈"。

## Non-goals

- **不做** Plan mode / ask_user 的完整交互(#2,留后续 change,复用本项的钩子点)。
- **不做** 通用且智能的"结果对错判断"——通用 check 高度领域相关且不可靠,框架只提供钩子 + 模板,具体判断由集成方 `check` 定义;内置 `createWriteBackCheck` 仅做"读回确认写入生效"的机械验证,不做语义判断。
- **不做** Prompt caching(#6,默认 provider 自动 cache,SDK 层价值薄)与任务系统 DAG 增强(#4,LLM 维护 DAG 不可靠)。
