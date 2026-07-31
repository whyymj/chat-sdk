# Design: unify-error-model

> 核心约束:**显式化已有的隐式三档,不改 `toolError` 协议**。当前各 catch 点其实已隐含三档语义(回灌 / 中断 / 吞),只是无统一类型与契约。本变更把"错误该不该中断/回灌/外发"做成显式 `AgentError.severity`,各层按档路由,集成方拿结构化错误契约。默认 Error = fatal(向后兼容),中间件显式抛 recoverable 才"回灌"。

## 1. 现状定位:三套风格

| 层 | 现状 | 隐式档位 |
|---|---|---|
| 工具层(`toolError`) | 结构化 `{code,message,hint}` 作为工具返回内容 | recoverable(回灌 LLM) |
| `coreExecTool` catch(`createAgent.ts:306`) | `{content:'工具执行出错',status:'error'}` → ToolMessage | recoverable |
| `coreModelCall`(`withRetry`) | 可重试错抛(retry),abort 保留 partial | fatal(经 retry 过滤) |
| `afterAgent` catch(`:519`) | `console.warn` 吞 | observable(但无 trace/外发) |
| `emit` 回调 catch(`createChatSdk.ts:928`) | `catch{}` 静默吞 | observable(但完全静默) |
| 中间件 `wrapToolCall`/`wrapModelCall` | 混用 throw / 返回 feedback / 吞 | 不一致 |

**问题**:档位隐式、不一致;集成方 `onEvent('error')` 只在部分路径发,且无 severity/code。

## 2. 解法

### 2.1 `AgentError` 类型

```ts
// types/index.ts
export type ErrorSeverity = 'recoverable' | 'fatal' | 'observable'

export interface AgentError {
  severity: ErrorSeverity
  message: string
  code?: string          // 结构化错误码(复用 toolError 的 code 体系,如 SCHEMA_INVALID)
  context?: unknown      // 附加(jsonPath / args / cause)
}

// 便捷工厂
export const agentError = (
  severity: ErrorSeverity, message: string, code?: string, context?: unknown
): AgentError => ({ severity, message, code, context })

// 路由纯函数(可单测):决定错误如何被处理
export type ErrorRouting = 'feedback' | 'abort' | 'log'
export function routeError(err: AgentError): ErrorRouting {
  if (err.severity === 'recoverable') return 'feedback'   // 转 ToolMessage/feedback 回灌
  if (err.severity === 'fatal') return 'abort'            // emit error + 中断
  return 'log'                                            // observable:warn + trace,不中断
}
```

### 2.2 各层按档路由

**agent 层**(`createAgent.ts`):

```ts
// coreExecTool catch(已是 recoverable 语义,显式化)
catch (err) {
  const ae = asAgentError(err, 'recoverable')  // 默认工具执行错 = recoverable
  return { content: `工具执行出错:${ae.message}`, status: 'error' }  // → ToolMessage 回灌
}

// afterAgent catch(:519,改 observable 为显式 trace + 可外发)
try { await runAfterAgent(...) }
catch (err) {
  const ae = asAgentError(err, 'observable')
  log('error', { stage: 'afterAgent', ...ae })   // 写 trace(不再仅 console.warn)
  // 不中断(observable)
}

// 模型调用/中间件 invariant 抛默认 Error → fatal:emit('error') + 中断
```

**中间件层**:契约文档化 —— 中间件抛 `AgentError(severity='recoverable')` → `wrapToolCall` 捕获后转 feedback 回灌(不中断);抛普通 Error → fatal(中断)。`asAgentError(err, defaultSeverity)` 把任意 err 归一化为 `AgentError`(普通 Error 默认 fatal)。

**createChatSdk `emit`**(`:925-930`):单监听器抛错 → `asAgentError(err,'observable')` → 记 trace,不影响其他监听器(已是 try/catch,加 trace)。

### 2.3 `onEvent('error')` 结构化

```ts
// SdkEvent error 扩展(向后兼容)
{ type: 'error', message: string, severity?: ErrorSeverity, code?: string, context?: unknown }
```

集成方可据 `severity` 分类(recoverable 不告警 / fatal 告警 / observable 统计)。旧监听器只读 `message` 不受影响。

## 3. 测试策略

### 3.1 selftest 白盒

```ts
// routeError 纯函数
assert(routeError({severity:'recoverable',message:'x'}) === 'feedback')
assert(routeError({severity:'fatal',message:'x'}) === 'abort')
assert(routeError({severity:'observable',message:'x'}) === 'log')
// asAgentError 归一化
assert(asAgentError(new Error('boom'),'fatal').severity === 'fatal')
assert(asAgentError({severity:'recoverable',message:'x'},'fatal').severity === 'recoverable')  // 已是 AgentError 不覆盖
// toolError 标注 recoverable
assert(toolError({code:'X',message:'y'}).severity === 'recoverable')  // 若 toolError 加 severity
```

### 3.2 e2e

- `onEvent('error')` 收到 `{severity, code, message}`(经构造的 fatal 场景,如 LLM apiKey 缺失)。
- 中间件抛 recoverable → 回灌 feedback 不中断(mock 验证)。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e` + 断言计数同步。

## 权衡

- **为何不强行让所有错误是 `AgentError` 实例**:用结构化对象 + `asAgentError` 归一化(普通 Error 默认 fatal),向后兼容现有 throw 代码;无需大改所有 catch 点。
- **为何 default Error = fatal 而非 observable**:保守默认 —— 未显式分类的错误视为需中断(暴露问题),优于静默吞(隐藏问题)。 observable 必须显式声明。
- **为何 `routeError` 是纯函数**:错误路由逻辑易白盒测、可被各 catch 点复用、与 agent 状态解耦。
- **为何不改 `retry`**:重试基于可重试性(网络/429/5xx,`isRetryable`),与 severity 正交 —— 一个 fatal 的 429 仍可重试(重试失败后才 emit fatal)。两套判定独立,不混淆。
- **为何 `onEvent('error')` 加字段而非新事件**:向后兼容(旧监听器读 message 不破);新字段 optional。

## 风险

- **错误被误分类**:中间件/工具开发者误把 recoverable 标 fatal(中断 agent)或反之。靠文档 + selftest 路由断言 + code review。
- **`onEvent('error')` payload 扩展**:加 optional 字段,旧监听器不破;但若有集成方断言 error event "只有 message 字段",会失败(概率极低)。
- **跨层一致性**:agent 层 / 中间件层 / sdk 层都要按档路由,改动面广;分期(期一 agent+tool,期二中间件+event)控制风险。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/types/index.ts` | 新增 `ErrorSeverity` / `AgentError` / `ErrorRouting`;`SdkEvent.error` 扩展 severity/code/context |
| `src/core/harness/createAgent.ts` | `asAgentError` / `routeError`;catch 点(:306/:519 等)按档路由 |
| `src/core/harness/middleware.ts` | 中间件错误契约文档化(抛 recoverable = 回灌) |
| `src/core/tools/toolError.ts` | `toolError` 标注 `severity:'recoverable'` |
| `src/core/sdk/createChatSdk.ts` | `emit` 回调 observable 处理 + 记 trace |
| `src/core/__tests__/modules/` | `routeError`/`asAgentError` 白盒 + 中间件 recoverable 断言 |
| `tests/e2e/`(events / custom-injection) | `onEvent('error')` 结构化字段断言 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 错误模型文档 + 断言计数 |
