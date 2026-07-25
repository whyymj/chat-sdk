/* 类型测试:验证 types/index.d.ts 导出齐全 + 关键类型正确(tsc --noEmit -p tsconfig.test.json) */
import {
  createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers,
  resolveContextOptions, CONTEXT_PRESETS, connectMcp, extractText, createAgent,
  createSubagentMiddleware, createSubagentsMiddleware,
  createVerifyMiddleware, createWriteBackCheck,
  createApprovalMiddleware, createHumanConfirmTool, createHumanConfirmMiddleware,
  createCheckpointManager, createCheckpointMiddleware, createUsageHintsMiddleware, createVfs,
  createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError,
  createWindowOps, fetchDocTools, fetchTools, defineWindowToolset, selectBuiltinTools,
  jpEval, searchJson, runSandboxedScript,
  toolError, zodError, jsonParseError, formatZodIssues,
  resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars,
  ChatDialog, MessageContent, CodePreview, useChat,
} from '../types/index'
import type {
  ChatSdk, ChatSdkOptions, LLMConfig, AgentInfo, ToolInfo, SkillInfo, WindowPropInfo, SubagentInfo,
  AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, SdkEvent, SdkEventHandler, ToolStep,
  Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate,
  VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions,
  SubagentOptions, SubagentLlmConfig, SubagentConfig,
  ApprovalOptions, CheckpointManager, CheckpointMeta, CheckpointDeps,
  SkillSpec, WindowPropSpec, WindowOpsOptions, WindowOpsController, WindowAuditEntry, WindowSnapshotEntry,
  JpNode, SearchHit, SearchMode, EvalResult, ToolErrorInput,
  McpServerConfig, McpTransport, McpConnection,
  ContextPreset, ContextManagerOptions, CompressionStats,
  ModelCaps, StorageConfig, StorageBackendType, SessionStore, SessionMeta, SessionSnapshot, StorageEvent, StorageBackend,
  CreateAgentOptions, DebugLog, PermissionRule, PermissionOp,
} from '../types/index'

// 值导出存在(拼错/缺失则 tsc 报错)
export const _v = {
  createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers,
  resolveContextOptions, CONTEXT_PRESETS, connectMcp, extractText, createAgent,
  createSubagentMiddleware, createSubagentsMiddleware,
  createVerifyMiddleware, createWriteBackCheck, createApprovalMiddleware,
  createHumanConfirmTool, createHumanConfirmMiddleware,
  createCheckpointManager, createCheckpointMiddleware, createUsageHintsMiddleware, createVfs,
  createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError,
  createWindowOps, fetchDocTools, fetchTools, defineWindowToolset, selectBuiltinTools,
  jpEval, searchJson, runSandboxedScript, toolError, zodError, jsonParseError, formatZodIssues,
  resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars,
  ChatDialog, MessageContent, CodePreview, useChat,
}

// 类型导出存在(拼错/缺失则 tsc 报错)
export type _T = {
  a: ChatSdk; b: ChatSdkOptions; c: LLMConfig; d: AgentInfo; e: ToolInfo; f: SkillInfo;
  g: WindowPropInfo; h: SubagentInfo; i: AgentMessage; j: AgentConfig; k: AgentState;
  l: StreamEvent; m: StreamHandler; n: SdkEvent; o: SdkEventHandler; p: ToolStep;
  q: Middleware; r: ModelRequest; s: ModelResponse; t: ToolCallContext; u: StateUpdate;
  v: VerifyCheck; w: VerifyCheckContext; x: VerifyCheckResult; y: VerifyMiddlewareOptions; z2: WriteBackCheckOptions;
  a2: SubagentOptions; b2: SubagentLlmConfig; c2: SubagentConfig;
  d2: ApprovalOptions; e2: CheckpointManager; f2: CheckpointMeta; g2: CheckpointDeps;
  h2: SkillSpec; i2: WindowPropSpec; j2: WindowOpsOptions; k2: WindowOpsController;
  l2: WindowAuditEntry; m2: WindowSnapshotEntry;
  n2: JpNode; o2: SearchHit; p2: SearchMode; q2: EvalResult; r2: ToolErrorInput;
  s2: McpServerConfig; t2: McpTransport; u2: McpConnection;
  v2: ContextPreset; w2: ContextManagerOptions; x2: CompressionStats;
  y2: ModelCaps;
  z3: StorageConfig; a3: StorageBackendType; b3: SessionStore; c3: SessionMeta; d3: SessionSnapshot; e3: StorageEvent; f3: StorageBackend;
  g3: CreateAgentOptions; h3: DebugLog; i3: PermissionRule; j3: PermissionOp;
}

// presets 含三个键(缺则 tsc 报错)
export const _p1: keyof typeof presets = 'pageBuilder'
export const _p2: keyof typeof presets = 'researcher'
export const _p3: keyof typeof presets = 'minimal'

// systemPromptHelpers.reliableWriteRules 是 string
export const _r: string = systemPromptHelpers.reliableWriteRules

// createChatSdk 返回类型兼容 ChatSdk
export const _sdk: ChatSdk = null as any as ReturnType<typeof createChatSdk>

// AgentInfo 含关键字段
export const _ai: Pick<AgentInfo, 'id' | 'model' | 'systemPrompt' | 'tools' | 'skills' | 'windowProps' | 'memory' | 'middleware' | 'todos' | 'subagent' | 'verify' | 'mcp' | 'lastCompression' | 'checkpoints'> = null as any

// ContextPreset 是字面量联合
export const _cp: ContextPreset = 'auto'
export const _cp2: ContextPreset = 'conservative'
export const _cp3: ContextPreset = 'aggressive'

// McpTransport 是字面量联合
export const _mt: McpTransport = 'http'
export const _mt2: McpTransport = 'sse'
export const _mt3: McpTransport = 'websocket'

// StorageBackendType 是字面量联合
export const _sbt: StorageBackendType = 'indexed'
export const _sbt2: StorageBackendType = 'memory'
