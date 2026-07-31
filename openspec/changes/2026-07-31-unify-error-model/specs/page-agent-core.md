# Specification Delta: page-agent-core

> 本文件为 change `unify-error-model` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 三档错误模型与按档路由

系统对错误采用显式三档分类(`AgentError.severity`):**recoverable**(可回灌 LLM 自纠,如工具校验失败 / 工具执行错 / 乐观锁冲突)→ 转 ToolMessage 或 feedback 回灌,不中断 agent;**fatal**(不可恢复,如 LLM 配置错 / 持久化致命错 / 中间件 invariant 违反)→ `emit('error')` 并中断当前 agent 调用;**observable**(副作用错,如 emit 回调抛 / afterAgent 清理错 / 非关键 IO)→ 记 trace + warn,不中断。错误路由经纯函数 `routeError` 决定(`recoverable→feedback` / `fatal→abort` / `observable→log`),各层(工具 `coreExecTool` / 模型调用 / `afterAgent` / `emit` 回调)按档处理。默认未分类的 Error 视为 fatal(暴露问题优于静默吞);中间件抛 `AgentError(severity='recoverable')` 表示"回灌 feedback 不中断"。工具层 `toolError` 标注为 recoverable(协议不变,仅加 severity)。

`onEvent('error')` 事件 payload 携带结构化字段 `{ message, severity?, code?, context? }`(向后兼容,旧监听器读 `message` 不破),供集成方按 severity 分类监控(recoverable 不告警 / fatal 告警 / observable 统计)。重试判定(`isRetryable`)与 severity 正交(可重试性基于 HTTP 状态/网络,与错误严重度独立判定)。
