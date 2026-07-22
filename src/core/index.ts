/**
 * page-agent 通用 SDK 入口(框架无关)
 *
 * 只导出通用核心 —— createPageAgent(命令式入口)/ createAgent(harness)/ 中间件契约类型 /
 * window 操作类型 / vfs / 通用消息类型。不含任何业务定制或旧链路,可整体迁移到任意项目复用。
 */
// SDK 命令式入口
export { createPageAgent } from './sdk/createPageAgent'
export type { PageAgentOptions, PageAgent, LLMConfig } from './sdk/createPageAgent'
export { defineTool } from './sdk/defineTool'
// harness 核心 + 中间件契约
export { createAgent } from './harness/createAgent'
export type { CreateAgentOptions, DebugLog } from './harness/createAgent'
export type { Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate } from './harness/middleware'
export { defineSkill } from './harness/skills'
export type { SkillSpec } from './harness/skills'
// window 操作类型(属性注册表 + 增量编辑 + 快照)
export type { WindowPropSpec, WindowAuditEntry, WindowSnapshotEntry } from './tools/windowOps'
export type { PermissionRule, PermissionOp } from './harness/permissions'
// 虚拟工作区
export { createVfs } from './backends/vfs'
// 通用消息 / 上下文类型
export type { AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, ToolStep } from './types'
export type { ContextManagerOptions, CompressionStats } from './composables/useContextManager'
