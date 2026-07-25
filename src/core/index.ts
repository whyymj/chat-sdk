/**
 * page-agent-sdk 通用 SDK 入口(框架无关)
 *
 * 只导出通用核心 —— createChatSdk(命令式入口)/ createAgent(harness)/ 中间件契约类型 /
 * window 操作类型 / vfs / 通用消息类型。不含任何业务定制或旧链路,可整体迁移到任意项目复用。
 */
// zod:随 SDK 暴露(IIFE 全量模式下消费者从 ChatSdk.z 取用,构造 windowProps schema)
export { z } from 'zod'
// SDK 命令式入口
export { createChatSdk } from './sdk/createChatSdk'
export type { ChatSdkOptions, ChatSdk, LLMConfig, PendingConflict } from './sdk/createChatSdk'
export { resolveContextOptions, type ContextPreset, CONTEXT_PRESETS } from './sdk/contextPreset'
export { defineTool } from './sdk/defineTool'
export { presets, systemPromptHelpers } from './presets'
export { connectMcp, extractText } from './mcp/client'
export type { McpServerConfig, McpTransport, McpConnection } from './mcp/client'
// harness 核心 + 中间件契约
export { createAgent, detectGarbledToolCall } from './harness/createAgent'
export type { CreateAgentOptions, DebugLog } from './harness/createAgent'
export type { Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate } from './harness/middleware'
export { createSubagentMiddleware, createSubagentsMiddleware } from './harness/subagent'
export type { SubagentOptions, SubagentLlmConfig, SubagentConfig } from './harness/subagent'
export { createVerifyMiddleware, createWriteBackCheck } from './harness/verify'
export type { VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions } from './harness/verify'
export { createApprovalMiddleware } from './harness/approval'
export type { ApprovalOptions } from './harness/approval'
export { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from './harness/humanConfirm'
export { createCheckpointManager, createCheckpointMiddleware } from './harness/checkpoint'
export type { CheckpointManager, CheckpointMeta, CheckpointDeps } from './harness/checkpoint'
export { defineSkill } from './harness/skills'
export type { SkillSpec } from './harness/skills'
// window 操作类型(属性注册表 + 增量编辑 + 快照)
export type { WindowPropSpec, WindowOpsOptions, WindowOpsController, WindowAuditEntry, WindowSnapshotEntry, ConflictInfo, ConflictResolution } from './tools/windowOps'
// 内置工具集(可独立导出 + 手动注入,配合 capabilities.windowOps/fetch 关闭默认自动装配)
export { createWindowOps } from './tools/windowOps'
export { jpEval, searchJson, runSandboxedScript } from './tools/windowQuery'
export type { JpNode, SearchHit, SearchMode, EvalResult } from './tools/windowQuery'
export { toolError, zodError, jsonParseError, formatZodIssues } from './tools/toolError'
export type { ToolErrorInput } from './tools/toolError'
export { fetchDocTools } from './tools/fetchDoc'
export { fetchTools, defineWindowToolset, selectBuiltinTools } from './toolsets'
export { createUsageHintsMiddleware } from './harness/usageHints'
export type { PermissionRule, PermissionOp } from './harness/permissions'
// 虚拟工作区
export { createVfs } from './backends/vfs'
// 持久化存储(IndexedDB + 多 agent 隔离 + 全局配额/LRU 淘汰)
export { createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError } from './backends/storage'
export type { StorageConfig, StorageBackendType, SessionStore, SessionMeta, SessionSnapshot, StorageEvent, StorageBackend } from './backends/storage'
// 通用消息 / 上下文类型
export type { AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, SdkEvent, SdkEventHandler, ToolStep } from './types'
export type { AgentInfo, ToolInfo, SkillInfo, WindowPropInfo, SubagentInfo } from './types'
export type { ContextManagerOptions, CompressionStats } from './composables/useContextManager'
export { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from './utils/modelCaps'
export type { ModelCaps } from './utils/modelCaps'
// UI 模块(组件 + composable,供 headless 自建 UI 复用)
export { default as ChatDialog } from './components/ChatDialog.vue'
export { default as MessageContent } from './components/MessageContent.vue'
export { default as CodePreview } from './components/CodePreview.vue'
export { useChat } from './composables/useChat'
