/* 类型测试:验证 types/index.d.ts 导出齐全 + 关键类型正确(tsc --noEmit -p tsconfig.test.json) */
import {
  createChatSdk, z, defineTool, defineSkill, presets, systemPromptHelpers,
  resolveContextOptions, CONTEXT_PRESETS, connectMcp, extractText, createAgent,
  createSubagentMiddleware, createSubagentsMiddleware,
  createVerifyMiddleware, createWriteBackCheck,
  createApprovalMiddleware, createHumanConfirmTool, createHumanConfirmMiddleware,
  createCheckpointManager, createCheckpointMiddleware, createUsageHintsMiddleware, createVfs,
  createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError,
  createDataOps, fetchDocTools, fetchTools, defineDataToolset, selectBuiltinTools,
  jpEval, searchJson, runSandboxedScript,
  toolError, zodError, jsonParseError, formatZodIssues,
  resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars,
  ChatDialog, MessageContent, CodePreview, useChat,
} from '../types/index'
import type {
  ChatSdk, ChatSdkOptions, LLMConfig, AgentInfo, ToolInfo, SkillInfo, DataInfo, SubagentInfo,
  AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, SdkEvent, SdkEventHandler, ToolStep,
  Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate,
  VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions,
  SubagentOptions, SubagentLlmConfig, SubagentConfig,
  ApprovalOptions, CheckpointManager, CheckpointMeta, CheckpointDeps,
  SkillSpec, DataConfig, DataOpsOptions, DataOpsController, DataAuditEntry, DataSnapshotEntry,
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
  createDataOps, fetchDocTools, fetchTools, defineDataToolset, selectBuiltinTools,
  jpEval, searchJson, runSandboxedScript, toolError, zodError, jsonParseError, formatZodIssues,
  resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars,
  ChatDialog, MessageContent, CodePreview, useChat,
}

// 类型导出存在(拼错/缺失则 tsc 报错)
export type _T = {
  a: ChatSdk; b: ChatSdkOptions; c: LLMConfig; d: AgentInfo; e: ToolInfo; f: SkillInfo;
  g: DataInfo; h: SubagentInfo; i: AgentMessage; j: AgentConfig; k: AgentState;
  l: StreamEvent; m: StreamHandler; n: SdkEvent; o: SdkEventHandler; p: ToolStep;
  q: Middleware; r: ModelRequest; s: ModelResponse; t: ToolCallContext; u: StateUpdate;
  v: VerifyCheck; w: VerifyCheckContext; x: VerifyCheckResult; y: VerifyMiddlewareOptions; z2: WriteBackCheckOptions;
  a2: SubagentOptions; b2: SubagentLlmConfig; c2: SubagentConfig;
  d2: ApprovalOptions; e2: CheckpointManager; f2: CheckpointMeta; g2: CheckpointDeps;
  h2: SkillSpec; i2: DataConfig; j2: DataOpsOptions; k2: DataOpsController;
  l2: DataAuditEntry; m2: DataSnapshotEntry;
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
export const _ai: Pick<AgentInfo, 'id' | 'model' | 'systemPrompt' | 'tools' | 'skills' | 'data' | 'memory' | 'middleware' | 'todos' | 'subagent' | 'verify' | 'mcp' | 'lastCompression' | 'checkpoints'> = null as any

// ContextPreset 是字面量联合
export const _cp: ContextPreset = 'auto'
export const _cp2: ContextPreset = 'conservative'
export const _cp3: ContextPreset = 'aggressive'
export const _cp4: ContextPreset = 'complex'  // 防漂移:曾漏 'complex'(types/index.d.ts:983),test:types 字段级断言锁死

// McpTransport 是字面量联合
export const _mt: McpTransport = 'http'
export const _mt2: McpTransport = 'sse'
export const _mt3: McpTransport = 'websocket'

// StorageBackendType 是字面量联合
export const _sbt: StorageBackendType = 'indexed'
export const _sbt2: StorageBackendType = 'memory'

// ===== 字段级抽样(防 types 漂移:p2-architecture-refactor 子项 5)=====
// 历史教训:2.21.0 前发生过 AgentCore 缺 10 方法 / onAudit 签名漂移 / capabilities 缺开关等,
// 仅靠「导出名集合」(tests/exports-consistency.mjs)和「类型名存在」(上方 _T)都抓不到 ——
// 名字都在、字段错。此处补字段级 Pick / Extract 断言:tsc 类型层直接校验 types/index.d.ts 真实字段,
// 任一方法/字段/事件字面量漂移即编译失败。

// 1. ChatSdk 全方法/属性完整性(防 AgentCore 接口方法漂移 —— 2.21.0 修复的直接坑源)
export const _sdkMethods: Pick<ChatSdk,
  | 'mount' | 'messages' | 'unmount' | 'hide' | 'show'
  | 'send' | 'switchSession' | 'stream' | 'inspect'
  | 'getMission' | 'setMission' | 'restoreLastCheckpoint' | 'listCheckpoints' | 'batch'
  | 'hook' | 'setData' | 'getData'
  | 'setSkills' | 'addSkill' | 'removeSkill' | 'listUserSkills' | 'getUserSkill' | 'invalidateSkillCache'
  | 'exportData' | 'importData' | 'usage' | 'pendingConflict' | 'resolveConflict'
  | 'setTools' | 'addTool' | 'removeTool' | 'setLlm' | 'setMemory' | 'refreshMemory'
  | 'setSubagents' | 'addSubagent' | 'removeSubagent'
> = null as any

// 2. SubagentConfig 字段完整性(预声明子 agent 配置;防 id/description/writablePaths 等漂移)
export const _subFields: Pick<SubagentConfig,
  'id' | 'description' | 'llm' | 'systemPrompt' | 'tools' | 'skills'
  | 'temperature' | 'maxTokens' | 'maxToolRounds' | 'writablePaths'
> = null as any

// 3. SdkEvent 关键分支字段(防事件 type 字面量 / payload 字段漂移;trace 分支若被删 → Extract 得 never → 访问 spans 报错)
type _DataChangeEvt = Extract<SdkEvent, { type: 'data_change' }>
export const _dce: 'set' | 'edit' | 'delete' | 'restore' = null as any as _DataChangeEvt['operation']
type _ErrorEvt = Extract<SdkEvent, { type: 'error' }>
export const _ee: 'recoverable' | 'fatal' | 'observable' | undefined = null as any as _ErrorEvt['severity']
type _UsageEvt = Extract<SdkEvent, { type: 'usage' }>
export const _ue: number = null as any as _UsageEvt['round']
type _TraceEvt = Extract<SdkEvent, { type: 'trace' }>
export const _te: unknown[] = null as any as _TraceEvt['spans']

// 4. ChatSdkOptions 关键字段(防 automation/actions/capabilities/tokenBudget 等新增配置项漏入 types)
export const _optFields: Pick<ChatSdkOptions,
  'tokenBudget' | 'timeBudgetMs' | 'actions' | 'capabilities' | 'onAudit' | 'toolMode'
  | 'interceptors' | 'augmentSystem' | 'appendReliableWriteRules' | 'skillStorage' | 'schemaHint'
> = null as any

// 5. capabilities 17 开关名完整性(防开关名漂移/缺漏;与 src/core/capabilities.ts CAPABILITIES 注册表呼应)
export const _capKeys: Pick<NonNullable<ChatSdkOptions['capabilities']>,
  'dataOps' | 'fetch' | 'planning' | 'missionAnchor' | 'workingMemory' | 'skills' | 'vfs'
  | 'summarization' | 'memory' | 'subagent' | 'inspectEnv' | 'verify' | 'domInspect'
  | 'draftWrite' | 'tracing' | 'todoDeps' | 'automation'
> = null as any
