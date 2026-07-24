/**
 * page-agent 通用 SDK 入口(框架无关)
 *
 * 只导出通用核心 —— createPageAgent(命令式入口)/ createAgent(harness)/ 中间件契约类型 /
 * window 操作类型 / vfs / 通用消息类型。不含任何业务定制或旧链路,可整体迁移到任意项目复用。
 */
// zod:随 SDK 暴露(IIFE 全量模式下消费者从 PageAgent.z 取用,构造 windowProps schema)
export { z } from 'zod'
// SDK 命令式入口
export { createPageAgent } from './sdk/createPageAgent'
export type { PageAgentOptions, PageAgent, LLMConfig } from './sdk/createPageAgent'
export { defineTool, defineToolset } from './sdk/defineTool'
export { presets } from './presets'
export { connectMcp, extractText } from './mcp/client'
export type { McpServerConfig, McpTransport, McpConnection } from './mcp/client'
// harness 核心 + 中间件契约
export { createAgent } from './harness/createAgent'
export type { CreateAgentOptions, DebugLog } from './harness/createAgent'
export type { Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate } from './harness/middleware'
export { createSubagentMiddleware } from './harness/subagent'
export type { SubagentOptions, SubagentLlmConfig } from './harness/subagent'
export { createVerifyMiddleware, createWriteBackCheck } from './harness/verify'
export type { VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions } from './harness/verify'
export { defineSkill } from './harness/skills'
export type { SkillSpec } from './harness/skills'
// window 操作类型(属性注册表 + 增量编辑 + 快照)
export type { WindowPropSpec, WindowAuditEntry, WindowSnapshotEntry } from './tools/windowOps'
export type { PermissionRule, PermissionOp } from './harness/permissions'
// 虚拟工作区
export { createVfs } from './backends/vfs'
// 持久化存储(IndexedDB + 多 agent 隔离 + 全局配额/LRU 淘汰)
export { createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError } from './backends/storage'
export type { StorageConfig, StorageBackendType, SessionStore, SessionMeta, SessionSnapshot, StorageEvent, StorageBackend } from './backends/storage'
// 通用消息 / 上下文类型
export type { AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, ToolStep } from './types'
export type { AgentInfo, ToolInfo, SkillInfo, WindowPropInfo, SubagentInfo, Toolset } from './types'
export type { ContextManagerOptions, CompressionStats } from './composables/useContextManager'
