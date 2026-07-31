/**
 * page-agent-sdk 通用 SDK 入口(框架无关)
 *
 * 只导出通用核心 —— createChatSdk(命令式入口)/ createAgent(harness)/ 中间件契约类型 /
 * 数据操作类型 / vfs / 通用消息类型。不含任何业务定制或旧链路,可整体迁移到任意项目复用。
 */
// zod:随 SDK 暴露(IIFE 全量模式下消费者从 ChatSdk.z 取用,构造 data schema)
export { z } from 'zod'
// 代理连接模块(防 apiKey 泄露:proxy 代理模式 / direct 直连模式)
export { createProxyLlm } from './llm/proxyLlm'
export type { ProxyLlmMode, ProxyLlmOptions } from './llm/proxyLlm'
// SDK 命令式入口
export { createChatSdk } from './sdk/createChatSdk'
export type { ChatSdkOptions, ChatSdk, LLMConfig, PendingConflict, DialogConfig, SystemAugmentContext } from './sdk/createChatSdk'
// system prompt 构建(refactor-module-extraction 从 createChatSdk 抽离;buildSystemPrompt 为纯函数,供 fix-introspection-consistency 的 getEffectiveSystemPrompt 复用)
export { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from './sdk/promptBuilder'
export { resolveContextOptions, type ContextPreset, CONTEXT_PRESETS } from './sdk/contextPreset'
export { defineTool } from './sdk/defineTool'
export { presets, systemPromptHelpers, extractSchemaHint } from './presets'
export { connectMcp, extractText } from './mcp/client'
export type { McpServerConfig, McpTransport, McpConnection } from './mcp/client'
// harness 核心 + 中间件契约
export { createAgent, detectGarbledToolCall } from './harness/createAgent'
export type { CreateAgentOptions, DebugLog } from './harness/createAgent'
export type { Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate } from './harness/middleware'
export { createSubagentMiddleware, createSubagentsMiddleware } from './harness/subagent'
export type { SubagentOptions, SubagentLlmConfig, SubagentConfig, SubagentsController } from './harness/subagent'
export { createVerifyMiddleware, createWriteBackCheck } from './harness/verify'
export type { VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions } from './harness/verify'
export { createMemoryMiddleware } from './harness/memory'
export type { MemorySource } from './harness/memory'
export { createApprovalMiddleware } from './harness/approval'
export type { ApprovalOptions } from './harness/approval'
export { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from './harness/humanConfirm'
export { createCheckpointManager, createCheckpointMiddleware } from './harness/checkpoint'
export type { CheckpointManager, CheckpointMeta, CheckpointDeps } from './harness/checkpoint'
export { defineSkill } from './harness/skills'
export type { SkillSpec } from './harness/skills'
// 数据操作类型(单主对象 + 增量编辑 + 快照)
export type { DataConfig, DataOpsOptions, DataOpsController, DataAuditEntry, DataSnapshotEntry, ConflictInfo, ConflictResolution, DataInterceptors, ToolMode } from './tools/dataOps'
export type { SkillsController } from './harness/skills'
// 内置工具集(可独立导出 + 手动注入,配合 capabilities.dataOps/fetch 关闭默认自动装配)
export { createDataOps, filterByToolMode } from './tools/dataOps'
export { jpEval, searchJson, runSandboxedScript } from './tools/dataSlotQuery'
export type { JpNode, SearchHit, SearchMode, EvalResult } from './tools/dataSlotQuery'
// 通用 JSON 操作纯函数(refactor-module-extraction 从 dataOps 抽离;零依赖、白盒可测,经 ./query subpath 按需引入)
export {
  UNSAFE_KEYS, isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath,
  deepClone, maybeParseValue, projectFields, limitDepth, safeStringify, hashValue,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace,
} from './tools/jsonUtils'
export type { EditOp } from './tools/jsonUtils'
// schema 白名单投影纯函数(refactor-module-extraction 从 dataOps 抽离;expose-schema-constraints 的 describeSchemaNode 归宿)
export { getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema } from './tools/schemaUtils'
export { toolError, zodError, jsonParseError, formatZodIssues } from './tools/toolError'
export type { ToolErrorInput } from './tools/toolError'
export { fetchDocTools } from './tools/fetchDoc'
export { fetchTools, defineDataToolset, selectBuiltinTools } from './toolsets'
export { createUsageHintsMiddleware } from './harness/usageHints'
export type { PermissionRule, PermissionOp } from './harness/permissions'
// 虚拟工作区
export { createVfs } from './backends/vfs'
// 持久化存储(IndexedDB + 多 agent 隔离 + 全局配额/LRU 淘汰)
export { createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError } from './backends/storage'
export type { StorageConfig, StorageBackendType, SessionStore, SessionMeta, SessionSnapshot, StorageEvent, StorageBackend } from './backends/storage'
export { createSkillStore } from './backends/skillStore'
export type { SkillStore, SkillStoreConfig, PersistedSkill } from './backends/skillStore'
// 通用消息 / 上下文类型
export type { AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, SdkEvent, SdkEventHandler, TokenUsage, ToolStep } from './types'
export type { AgentInfo, ToolInfo, SkillInfo, DataInfo, SubagentInfo } from './types'
export type { ContextManagerOptions, CompressionStats } from './composables/useContextManager'
export { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from './utils/modelCaps'
export type { ModelCaps } from './utils/modelCaps'
export { copyText } from './utils/clipboard'
// UI 模块(组件 + composable,供 headless 自建 UI 复用)
export { default as ChatDialog } from './components/ChatDialog.vue'
export { default as MessageContent } from './components/MessageContent.vue'
export { default as CodePreview } from './components/CodePreview.vue'
export { default as SkillPanel } from './components/SkillPanel.vue'
export { useChat } from './composables/useChat'
