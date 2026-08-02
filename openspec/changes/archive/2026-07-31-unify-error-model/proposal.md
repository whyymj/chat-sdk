# Change: unify-error-model

> 配套:本变更统一错误处理的三套并存风格 —— ① 工具层 `toolError` 结构化错误(回灌 LLM);② 中间件层混用 throw / 返回 feedback / `catch{}` 吞;③ agent 层 `afterAgent` 与 `emit` 回调 `console.warn` 吞掉。引入显式三档错误模型(`recoverable` / `fatal` / `observable`),各层按档路由,给集成方稳定的错误契约。与 `observability-structured-tracing`(D,可观测性)协同:错误分类是结构化 trace 的前提。跨 `createAgent.ts` + 各中间件 + `types`,建议在 refactor 之后。

## Why

1. **错误处理三套风格,无统一契约**。
   - 工具层:`toolError({code,message,hint})` 结构化,作为工具返回内容回灌 LLM(语义=可恢复)—— 这套设计良好。
   - 中间件层:`wrapToolCall`/`wrapModelCall` 内部错误有时 throw、有时返回 feedback 字符串、有时 `catch{}` 静默吞 —— 行为不一致,集成方无法预期。
   - agent 层:`afterAgent` 清理错被 `console.warn` 吞(`createAgent.ts:519`)、`emit` 回调错被 `catch{}` 吞(`createChatSdk.ts:928`)—— 可观测性弱,生产排障难。
2. **"这个错误该不该中断 agent / 该不该回灌 LLM / 该不该外发"无明确定义**。靠每个 catch 点各自判断,新增中间件/工具时易误判(把可恢复错抛成致命中断,或把致命错吞掉)。
3. **集成方无稳定错误契约**。`onEvent('error')` 只在部分路径触发;集成方想做错误监控/分类上报,拿不到结构化错误信息。

## What Changes

### 1. 引入三档错误模型

- 新增 `AgentError`(`types/`):`{ severity: 'recoverable'|'fatal'|'observable', code?, message, context? }`。
  - **recoverable**:可回灌 LLM 自纠(工具校验失败、工具执行错、乐观锁冲突)→ 转 ToolMessage/feedback,不中断 agent。
  - **fatal**:不可恢复(LLM 配置错、持久化致命错、中间件 invariant 违反)→ `emit('error')` + 中断当前 agent 调用。
  - **observable**:副作用错(emit 回调抛、afterAgent 清理错、非关键 IO)→ warn + 写 trace,不中断。
- 工具层 `toolError` 隐式 = recoverable(已是,显式标注 severity,协议不变)。

### 2. 各层按档路由

- **agent 层**(`createAgent.ts`):`coreExecTool` catch → recoverable(转 ToolMessage,已如此);`afterAgent`/`emit` 回调 catch → observable(显式记 trace + warn,不再静默);模型调用/中间件 invariant → fatal(emit error + 中断)。
- **中间件层**:中间件抛 `AgentError(severity='recoverable')` 表示"回灌 feedback";抛默认 Error = fatal。`wrapToolCall`/`wrapModelCall` 捕获后按 severity 路由。
- **createChatSdk**:`emit` 回调与 `onEvent` 统一经 observable 档处理(单监听器抛错 → observable,不影响其他)。

### 3. 错误外发结构化

- `onEvent('error')` 扩展为携带 `{ severity, code?, message, context? }`(向后兼容:原 `message` 字段保留)。
- 集成方可据 severity 做分类监控(recoverable 不告警 / fatal 告警 / observable 统计)。

## Impact

- **改造**:`src/core/types/index.ts`(新增 `AgentError` / `ErrorSeverity`)、`src/core/harness/createAgent.ts`(catch 点按档路由 + emit 结构化)、`src/core/sdk/createChatSdk.ts`(`emit` 回调 observable 处理)、`src/core/harness/middleware.ts`(中间件错误契约文档化)、`src/core/tools/toolError.ts`(`toolError` 标注 recoverable)。
- **行为变化**:`onEvent('error')` payload 扩展(加 severity/code,旧字段保留 → 向后兼容);原本静默吞的错误(emit 回调、afterAgent)现在写 trace + 可选外发(集成方可见)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(三档错误模型)。
- **测试**:selftest 补 `AgentError` 路由逻辑(纯函数 `routeError(err)` 白盒)+ 中间件 recoverable→feedback 断言;e2e 补 `onEvent('error')` 结构化字段。断言计数同步。

## Non-goals

- **不改** `toolError` 的结构化协议 —— 它已是 recoverable 的良好载体,只加 severity 标注。
- **不引入** 重试策略变化 —— 重试(`retry.ts`)仍按可重试性(网络/429/5xx)判定,与错误 severity 正交(recoverable 不等于可重试)。
- **不强行** 让所有中间件抛 `AgentError` —— 默认 Error 视为 fatal;中间件想"回灌"才显式抛 recoverable。向后兼容现有中间件代码。
- **不改** abort 语义 —— abort 保留 partial、不重试,独立于错误模型。
- **不统一** 所有 catch 点为单一 handler —— 各层(catch in coreExecTool / afterAgent / emit)语义不同,按档路由即可,不强行合并。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `AgentError` 类型 + agent 层按档路由 + `toolError` 标注 recoverable | 中(错误路径,需 e2e) | ✅ patch |
| 期二 | 中间件错误契约 + `onEvent('error')` 结构化 payload | 中 | ✅ minor(叠加,payload 扩展) |

期一 patch(内部路由,行为基本不变);期二 minor(event payload 扩展,向后兼容)。建议与 `observability-structured-tracing` 协同推进(错误分类支撑 trace)。
