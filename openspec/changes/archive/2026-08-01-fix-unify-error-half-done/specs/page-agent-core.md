# Specification Delta: page-agent-core

> 修正 change `unify-error-model` 合入的"三档错误模型"Requirement(纠过头描述,对齐缩水后的实际边界)。

## Requirement: 三档错误模型(修正:内置 catch 简化硬编码 + routeError 供扩展)

错误采用显式三档 `AgentError.severity`(recoverable / fatal / observable)。**内置 catch 点用简化硬编码路由**(非动态消费 routeError):`coreExecTool` 工具执行错 = recoverable(转 ToolMessage 回灌 LLM,不中断);`afterAgent` 清理错 / `emit` 回调错 = observable(warn 不中断);`invoke` 致命错 = fatal(emit('error') + 中断)。各 catch 点用 `asAgentError(err, defaultSeverity)` 归一化提取 message/severity。

`routeError` 纯函数(据 severity 返回 feedback/abort/log)**框架内置 catch 点当前未消费**——它作为公共工具导出:① 供集成方自定义中间件 catch 按 severity 决策;② 为未来 `wrapToolCall` 实现"中间件抛 `AgentError(recoverable)`→feedback 自动路由"预留扩展口(届时在执行器接通,catch 点/接口零改动)。`onEvent('error')` payload 携带 `{ message, severity?, code?, context? }`(向后兼容)。重试判定(`isRetryable`)与 severity 正交。

**未来扩展点(未实现,留口)**:`wrapToolCall` 执行器 catch `AgentError` → `routeError` 决定 feedback/abort/log,实现中间件 recoverable→feedback 自动回灌(无需求驱动前不补全,避免 YAGNI;结构已预留,补全时改动面仅执行器 + 测试)。
