import { DefineComponent, Ref } from 'vue';
export { z } from 'zod';

export interface ToolStep {
  name: string;
  args?: any;
  result?: string;
  status: 'running' | 'done' | 'error';
  /** 子 agent 工具步骤(spawn 委派时展示子进度) */
  children?: ToolStep[];
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  reasoning?: string;
  steps?: ToolStep[];
}

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AgentState {
  messages: AgentMessage[];
  loading: boolean;
  error: string | null;
}

export type StreamEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error' }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result'; name: string; args?: any; result?: string; status?: 'done' | 'error' }
  | { type: 'done'; content: string };

export type StreamHandler = (event: StreamEvent) => void;

/**
 * SDK 事件(供 createChatSdk({ onEvent }) 订阅常用时机)。
 * 复用 StreamEvent(round_start/reasoning/text/tool_call/tool_result/subagent/done;approval_request 不外发)
 * + 额外时机:data_change / message_update / error。
 */
export type SdkEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error' }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result'; name: string; args?: any; result?: string; status?: 'done' | 'error' }
  | { type: 'done'; content: string }
  | { type: 'data_change'; operation: 'set' | 'edit' | 'delete' | 'restore'; value?: unknown }
  | { type: 'message_update'; count: number }
  | { type: 'conflict'; conflict: PendingConflict }
  | { type: 'error'; message: string };

export type SdkEventHandler = (event: SdkEvent) => void;

/** 调试日志(与 harness/createAgent 的 DebugLog 一致) */
export interface DebugLog {
  timestamp: number;
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware';
  data: any;
}

export interface ChatDialogProps {
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>;
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  title?: string;
  placeholder?: string;
  debugLogs?: DebugLog[];
  getInfo?: () => AgentInfo;
}

export interface ToolInfo { name: string; description: string; schema?: unknown; source?: string }
export interface SkillInfo { name: string; description: string }
export interface DataInfo { description?: string; schema?: unknown }
export interface SubagentInfo {
  enabled: boolean;
  maxDepth: number;
  maxParallel: number;
  allowedTools: string[];
}
/** 预声明子 agent 配置(同主配置子集 + id/description;缺省继承主 agent) */
export interface SubagentConfig {
  /** 唯一标识;生成委派工具名 use_<id>(须合法工具名) */
  id: string;
  /** 一句话说明(进主 systemPrompt 索引 + 作委派工具描述) */
  description: string;
  llm?: LLMConfig | ChatModelLike;
  systemPrompt?: string;
  tools?: any[];
  skills?: SkillSpec[];
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number;
}
export interface AgentInfo {
  id: string;
  model?: string;
  /** 当前生效的 systemPrompt(默认或用户传入;仅 base 段,不含中间件 augmentPrompt,便于调试/验证默认提示词) */
  systemPrompt: string;
  tools: ToolInfo[];
  skills: SkillInfo[];
  data?: DataInfo;
  memory: string;
  middleware: string[];
  todos: { content: string; status: string }[];
  subagent: SubagentInfo;
  verify?: { enabled: boolean; maxAttempts: number; adversarial: boolean };
  mcp?: { servers: { name: string; url: string; toolCount: number }[] };
  /** 最近一次跨轮压缩统计(未触发过 → undefined) */
  lastCompression?: {
    triggered: boolean; roundsTotal: number; roundsSummarized: number; roundsRecalled: number;
    originalMessages: number; compressedMessages: number; strategy: string;
  };
  /** 会话级 checkpoint 装载状态(未开启 → undefined) */
  checkpoints?: { enabled: boolean; auto: boolean; list: CheckpointMeta[] };
}
export interface McpServerConfig { transport: 'http' | 'sse' | 'websocket'; url: string; name?: string; requestInit?: any; }

export declare const ChatDialog: DefineComponent<ChatDialogProps>;
export declare const MessageContent: DefineComponent<any>;
export declare const CodePreview: DefineComponent<any>;
export declare function useChat(opts?: any): any;

// ===== 框架无关 SDK(页面内 Agent)=====
export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number;
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number;
}
/** LangChain BaseChatModel 的结构形状(provider 抽离:llm 可传任意 provider 实例) */
export type ChatModelLike = {
  invoke: (input: any, options?: any) => Promise<any>;
  stream: (input: any, options?: any) => Promise<any>;
  bindTools: (tools: any[]) => any;
};

export interface DataConfig {
  /** 值的 zod schema(写入时校验);字段的 .describe() 自动提取注入 systemPrompt「可操作数据」段 */
  schema: any;
  /** 数据源:reactive/普通对象,工具直接读写 bind(reactive 写后响应式刷新;不挂 window) */
  bind: any;
  /** 数据说明,供 Agent 理解用途;不传则自动生成 */
  description?: string;
}
/** createDataOps 选项(审计回调 / 快照上限 / 乐观锁) */
export interface DataOpsOptions {
  onAudit?: (entry: { op: string; value?: any; detail?: string; timestamp: number }) => void;
  maxSnapshots?: number;
  /** 乐观锁冲突人工介入回调(详见 ConflictInfo/ConflictResolution);不传则冲突时返回 VERSION_CONFLICT 错误 */
  onConflict?: (conflict: ConflictInfo) => Promise<ConflictResolution>;
  /**
   * 自动乐观锁(默认 true):写入时若 LLM 未显式传 expectedHash,自动用「LLM 最后一次 read/get 读到的 hash」作基准比对。
   * LLM 无需手动传 expectedHash 即可享受乐观锁保护;冲突走 onConflict(无 onConflict 则返回 VERSION_CONFLICT)。
   * LLM 未读过直接写(无基准记录)时跳过锁(等同不校验)。设 false 回退「不传 expectedHash = 不校验」的旧行为。
   */
  autoLock?: boolean;
  /** 读写拦截器:read/write 透传给数据工具(脱敏/转换/审计/拒绝 LLM 读写) */
  interceptors?: DataInterceptors;
}

/** 数据读写拦截器(集成方可脱敏/转换/审计/拒绝 LLM 的读写) */
export interface DataInterceptors {
  /** LLM 读时拦截:原始值 → 改写后返回给 LLM(如脱敏/派生);抛错则返回 READ_INTERCEPT 错误 */
  read?: (value: any) => any;
  /** LLM 写时拦截:欲写值 + 当前值 → 改写后的值,或 { error } 拒绝;抛错则拒绝 */
  write?: (payload: any, current: any) => any | { error: string };
}

/** 工具呈现模式:simple=主推 read/write 但保留高级能力(默认)| advanced=全暴露| minimal=只 read/write */
export type ToolMode = 'simple' | 'advanced' | 'minimal';

/** 数据操作控制器(运行时替换配置;createDataOps 返回的工具数组上以不可枚举属性 `controller` 挂载) */
export interface DataOpsController {
  /** 读取当前配置 */
  get(): DataConfig;
  /** 替换主数据配置(如页面切换、schema 变更);清空快照栈与乐观锁缓存 */
  set(config: DataConfig): void;
  /** 仅替换 bind 引用;清空快照栈与乐观锁缓存 */
  update(bind: any): void;
}

export interface PermissionRule {
  operations: ('read' | 'write')[];
  scopes: string[];
  mode: 'allow' | 'deny';
}

export interface SkillSpec {
  name: string;
  /** 一句话说明(进索引,兼顾「是什么」+「何时用」) */
  description: string;
  /** 文档源(http(s):// 远程 md,或 vfs://path / 裸路径;SDK 代劳 fetch+vfs);与 getContent 二选一,doc 优先 */
  doc?: string;
  getContent?: () => string | Promise<string>;
}

// ===== Verify 自检中间件 =====
/** verify check 上下文:与 beforeReturn 底层一致(messages 含 system 头 + agent 最新回复 + 历史 tool_result) */
export interface VerifyCheckContext {
  messages: any[];
  state: any;
}
export interface VerifyCheckResult {
  ok: boolean;
  /** ok=false 时的修正指引(回灌给 agent 触发自纠) */
  feedback?: string;
}
/** 领域校验函数:ok=true 放行,ok=false 用 feedback 回灌自纠 */
export type VerifyCheck = (ctx: VerifyCheckContext) => Promise<VerifyCheckResult> | VerifyCheckResult;
export interface VerifyMiddlewareOptions {
  check: VerifyCheck;
  /** 对抗式验证:check 通过后 spawn 找茬子 agent 审查;verdict 无问题放行,否则回灌 */
  adversarial?: { llm: any; tools?: any[] };
}
/** createWriteBackCheck 选项 */
export interface WriteBackCheckOptions {
  /** name → zod schema(由 createChatSdk 从 data 构造注入,键 '' 代表主数据);省略则只校验「读回非空」 */
  schemas?: Record<string, any>;
  /**
   * 读回的根对象。优先于 `window`。
   * - 单对象 data 模式:传 bind 对象(或 getter `() => liveData()?.bind`,适配 sdk.setData 运行时替换)
   * - 旧 windowProps 模式:省略则用 `window`(默认 globalThis.window)
   */
  root?: unknown | (() => unknown);
  /** 读 window 的根对象(旧 windowProps 模式;data 模式应传 root)。默认 globalThis.window */
  window?: unknown;
}

// ===== 人工确认(approval)=====
/** 人工确认中间件选项:工具调用前需用户「允许/拒绝」 */
export interface ApprovalOptions {
  /** 需确认的工具名列表;不传 confirm 且不传 tools → 所有工具都确认 */
  tools?: string[];
  /** 自定义判定(优先于 tools);返回 true 需确认 */
  confirm?: (name: string, args: any) => boolean;
  /** 超时毫秒(用户未响应自动拒绝);0 = 不超时(默认) */
  timeoutMs?: number;
  /** 是否装载 request_human_confirmation 主动确认工具(传 approval 时默认 true;false 关闭) */
  humanConfirmTool?: boolean;
}
export declare function createApprovalMiddleware(opts?: ApprovalOptions): any;
export declare function createHumanConfirmTool(): any;
export declare function createHumanConfirmMiddleware(): any;
export declare const HUMAN_CONFIRM_TOOL_NAME: string;
export interface CheckpointMeta {
  id: number;
  label?: string;
  timestamp: number;
  messageCount: number;
}
export interface CheckpointManager {
  save(label?: string): number;
  list(): CheckpointMeta[];
  restore(id?: number): boolean;
  canRestore(): boolean;
}
export declare function createCheckpointManager(deps: any): CheckpointManager;
export declare function createCheckpointMiddleware(mgr: CheckpointManager): any;

// ===== 持久化存储 =====
export type StorageBackendType = 'indexed' | 'session' | 'local' | 'memory';
export interface StorageConfig {
  backend?: StorageBackendType;
  enabled?: boolean;
  dbName?: string;
  maxBytes?: number;
  maxBytesPerSession?: number;
  evictionWatermark?: number;
  debounceMs?: number;
}
export interface SessionMeta {
  agentId: string;
  sessionId: string;
  createdAt: number;
  lastAccessed: number;
  bytes: number;
  title?: string;
}
export interface SessionSnapshot {
  messages: AgentMessage[];
  vfs: Record<string, { content: string; mimeType?: string; updatedAt: number }>;
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
  memory: string;
}
export type StorageEvent =
  | { type: 'degraded'; reason: string }
  | { type: 'quota'; sessionBytes: number; limit: number }
  | { type: 'evicted'; agentId: string; sessionId: string; bytes: number }
  | { type: 'flush' };
export interface StorageBackend {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  scan(prefix: string, cb: (key: string, value: unknown) => boolean | void): Promise<void>;
  clearPrefix(prefix: string): Promise<void>;
}
export interface SessionStore {
  ready: Promise<boolean>;
  listSessions(agentId: string): Promise<SessionMeta[]>;
  load(agentId: string, sessionId: string): Promise<SessionSnapshot | undefined>;
  save(agentId: string, sessionId: string, snap: Partial<SessionSnapshot>): Promise<void>;
  flush(): Promise<void>;
  deleteSession(agentId: string, sessionId: string): Promise<void>;
  createSession(agentId: string, title?: string, sessionId?: string): Promise<string>;
  onEvent(cb: (e: StorageEvent) => void): void;
  dispose(): void;
}
export interface SessionOptions {
  id?: string;
  autoResume?: boolean;
  title?: string;
}

export interface ChatSdkOptions {
  container?: string | HTMLElement;
  /** UI:'default'(内置 ChatDialog)/ false(headless 不渲染,自建 UI) */
  ui?: boolean | 'default';
  llm: LLMConfig | ChatModelLike;
  /** agent 实例 id(多 agent 共存隔离;不传则随机生成并告警,刷新后无法恢复) */
  id?: string;
  /** 持久化:默认关闭;赋值后端字符串('indexed'/'session'/'local'/'memory')或配置对象开启;false 关闭 */
  storage?: StorageBackendType | StorageConfig | false;
  /** 会话控制 */
  session?: SessionOptions;
  /** 共享上下文:默认 false;true 时同 id 复用同一核心(messages/agent/工作区) */
  shareContext?: boolean;
  systemPrompt?: string;
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 false;不传 systemPrompt 用默认 prompt 时已内置,此项无效) */
  appendReliableWriteRules?: boolean;
  tools?: any[];
  skills?: SkillSpec[];
  memory?: string;
  data?: DataConfig;
  permissions?: PermissionRule[];
  /** 自定义中间件(注入到内置中间件之后;可拦截/观察模型调用、工具、prompt) */
  middleware?: any[];
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number };
  /** 每个数据对象最多保留快照数(默认 20) */
  maxSnapshots?: number;
  /** 自动乐观锁(默认 true):写入时若 LLM 未传 expectedHash,自动用其最后 get 读到的 hash 比对;设 false 回退「不传 = 不校验」 */
  autoLock?: boolean;
  /** 工具呈现模式:simple(默认,主推 read/write 但保留 query/search/eval/snapshot)| advanced(全暴露)| minimal(只 read/write) */
  toolMode?: 'simple' | 'advanced' | 'minimal';
  /** 读写拦截器:read/write 透传给数据工具(脱敏/转换/审计/拒绝 LLM 读写);input/output 在 agent IO 入口/出口预处理 */
  interceptors?: {
    read?: (value: any) => any;
    write?: (payload: any, current: any) => any | { error: string };
    /** agent 接收输入时拦截:send/stream 的 user message 预处理(可改写/审计) */
    input?: (input: any) => any;
    /** agent 产出输出时拦截:返回前 postprocess(可改写最终回复) */
    output?: (json: any) => any;
  };
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number;
  debug?: boolean;
  maxToolRounds?: number;
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number;
  /** 同轮工具并发上限(默认 1 串行) */
  maxParallelTools?: number;
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number;
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number;
  /** 子 agent 委派(默认开启;{ enabled: false } 关闭) */
  capabilities?: { dataOps?: boolean; fetch?: boolean; planning?: boolean; skills?: boolean; vfs?: boolean; summarization?: boolean; memory?: boolean; subagent?: boolean; verify?: boolean };
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | ChatModelLike; maxDepth?: number; maxParallel?: number };
  /** 预声明子 agent 列表:每个用同主配置方式声明,自动生成 use_<id> 委派工具(与 spawn_agent 共存) */
  subagents?: SubagentConfig[];
  /** 自检:agent 返回前跑 check,不通过则 feedback 回灌自纠(默认关闭;需 capabilities.verify:true)。check 省略时默认 createWriteBackCheck 写后读回验证 */
  verify?: { enabled?: boolean; check?: VerifyCheck; maxAttempts?: number; adversarial?: boolean };
  /** 人工确认:工具调用前弹确认框,用户「允许/拒绝」后才执行(默认关闭,不传 = 不装) */
  approval?: ApprovalOptions;
  /** 会话级 checkpoint 回滚(回到上次正常时)。默认关闭;传 true 或 { maxCheckpoints?, auto? } 开启 */
  checkpoint?: boolean | { maxCheckpoints?: number; auto?: boolean };
  /** MCP server 列表(连远程 server 动态注入其 tools;浏览器仅 http/sse/websocket) */
  mcp?: McpServerConfig[];
  /** 上下文压缩配置(false 关闭;默认 LLM 摘要,失败回退索引摘要) */
  contextOptions?: any;
  /** 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive;提供合理默认,contextOptions 细参可覆盖 */
  contextPreset?: 'auto' | 'conservative' | 'aggressive';
  /** 摘要压缩专用 LLM(BaseChatModel 实例或 LLMConfig);不传则默认用主 agent 模型(llm) */
  summaryLlm?: any;
  /** 摘要 LLM 温度(默认 0.3) */
  summaryTemperature?: number;
  /** 摘要 LLM 输出上限(默认 1024) */
  summaryMaxTokens?: number;
  /** 摘要 LLM 超时毫秒(默认 15000;超时回退索引摘要) */
  summaryTimeoutMs?: number;
  /**
   * SDK 事件回调:订阅常用时机(数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * UI 与 headless 模式均生效;用于外部联动(宿主页面响应式刷新、埋点、日志),替代轮询。
   * approval_request 不外发(UI 已处理)。
   */
  onEvent?: SdkEventHandler;
  /** 流式输出(默认 true);false 时等整段回复再显示 */
  streaming?: boolean;
  title?: string;
  placeholder?: string;
}

export interface ChatSdk {
  mount(): Promise<void>;
  /** 响应式消息数组(headless 模式自建 UI 读) */
  messages: AgentMessage[];
  unmount(): void;
  send(message: string): Promise<string>;
  switchSession(sessionId?: string): Promise<string>;
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos) */
  inspect(): AgentInfo;
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint,无可用返回 false */
  restoreLastCheckpoint(): boolean;
  /** 列出可用 checkpoint(回退点);需开启 checkpoint,未开启返回空数组 */
  listCheckpoints(): CheckpointMeta[];
  /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
  hook(handler: SdkEventHandler): () => void;
  /** 运行时替换主数据配置(如页面切换、schema 变更);立即对数据工具生效,无需重建 agent。需开启 dataOps */
  setData(config: DataConfig): void;
  /** 读取当前主数据配置;dataOps 关闭时返回 undefined */
  getData(): DataConfig | undefined;
  /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 自建 UI */
  pendingConflict: Ref<PendingConflict | null>;
  /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
  resolveConflict(action: ConflictResolution['action']): void;
}

/** 乐观锁冲突挂起(dataOps 写入时 expectedHash 不匹配,挂起等用户决定) */
export interface PendingConflict {
  id: number;
  op: 'set' | 'edit' | 'delete';
  agentValue?: unknown;
  currentValue: unknown;
  currentHash: string;
  expectedHash: string;
  snapshotId: number;
  resolve: (r: ConflictResolution) => void;
}

/** 冲突解决决定:保留外部修改 / 强制覆盖 / 回退到写前快照 */
export type ConflictResolution =
  | { action: 'keep_external' }
  | { action: 'overwrite' }
  | { action: 'restore' };

/** 乐观锁冲突信息(dataOps onConflict 回调参数) */
export interface ConflictInfo {
  op: 'set' | 'edit' | 'delete';
  agentValue?: unknown;
  currentValue: unknown;
  currentHash: string;
  expectedHash: string;
  snapshotId: number;
}

export declare function createChatSdk(options: ChatSdkOptions): ChatSdk;
export declare function defineTool(opts: {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => unknown | Promise<unknown>;
}): any;
export declare function createDataOps(config: DataConfig, opts?: DataOpsOptions): any[];
export declare function filterByToolMode(tools: any[], mode?: 'simple' | 'advanced' | 'minimal'): any[];
export declare function selectBuiltinTools(caps: { dataOps?: boolean; fetch?: boolean } | undefined, dataOps: any[], fetchDocs: any[]): any[];
export declare function createUsageHintsMiddleware(caps: { planning?: boolean; dataOps?: boolean; subagent?: boolean } | undefined, hasDataOps: boolean, toolMode?: 'simple' | 'advanced' | 'minimal'): any;
export declare const fetchDocTools: any[];
export declare const fetchTools: any[];
export declare function defineDataToolset(config: DataConfig, opts?: DataOpsOptions): any[];
export declare function defineSkill(spec: SkillSpec): SkillSpec;
export declare function createAgent(options: any): any;
/** 检测模型把工具调用写成文本(伪 XML/标签)而非标准 tool_calls 的异常格式;主循环据此回灌 feedback 自纠 */
export declare function detectGarbledToolCall(content: string): boolean;
export declare function createSubagentMiddleware(opts: any): any;
export declare function createVerifyMiddleware(opts: VerifyMiddlewareOptions): any;
export declare function createWriteBackCheck(opts?: WriteBackCheckOptions): VerifyCheck;
export declare const presets: Record<string, any>;
/** systemPrompt 辅助片段(标准化最佳实践,拼进 systemPrompt 降低写错门槛) */
export declare const systemPromptHelpers: {
  /** 可靠写入规则:改前先读、动态先 list、字段以 describe 为准、写错看校验错误重试、优先增量 patch */
  readonly reliableWriteRules: string;
};
/** 从 zod schema 提取字段说明(io 契约注入 systemPrompt 用);非 object schema 用 description 兜底 */
export declare function extractSchemaHint(schema: any): string;
export declare function createSessionStore(config?: StorageConfig): SessionStore;
export declare function createMemoryBackend(): StorageBackend;
export declare function createWebStorageBackend(storage: Storage): StorageBackend;
export declare function isQuotaError(err: unknown): boolean;

// ============ 大 JSON 查询/搜索/沙箱脚本(dataSlotQuery)============
export interface JpNode {
  /** 相对属性根的点号路径(数组索引用数字,如 components.0.text) */
  path: string;
  /** 匹配元素值 */
  value: unknown;
  /** 父为数组时的索引(便于后续 edit_data_slot 的 jsonPath 定位) */
  index?: number;
}
export interface SearchHit {
  path: string;
  key?: string;
  value: string;
  score?: number;
}
export type SearchMode = 'substring' | 'regex' | 'fuzzy';
export interface EvalResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  elapsedMs: number;
}
/** JSONPath 查询(只读,无副作用);expr 子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..* */
export declare function jpEval(root: unknown, expr: string): JpNode[];
/** 在 JSON 子树内搜索文本(substring/regex/fuzzy) */
export declare function searchJson(
  root: unknown,
  query: string,
  opts?: { mode?: SearchMode; fuzzyThreshold?: number; matchKey?: boolean; limit?: number },
): SearchHit[];
/** Web Worker 沙箱执行自定义 JS(无 window/document,禁 fetch/XHR/WebSocket/importScripts,超时可终止) */
export declare function runSandboxedScript(data: unknown, script: string, timeoutMs?: number): Promise<EvalResult>;

// ============ 工具报错(结构化 ERROR:{json},供 LLM 排查)============
export interface ToolErrorInput {
  /** 机器可读错误码(大写蛇形,如 NOT_REGISTERED / SCHEMA_INVALID / JSON_PARSE / PATH_UNSAFE / NOT_OBJECT / PATCH_FAILED / JSONPATH_SYNTAX / REGEX_INVALID / SCRIPT_TIMEOUT / SCRIPT_ERROR / NOT_FOUND / NO_MATCH / AMBIGUOUS_MATCH) */
  code: string;
  /** 人类可读:具体发生了什么 */
  message: string;
  /** 建议的修复动作(可操作) */
  hint?: string;
  /** 相关属性路径 */
  path?: string;
  /** 额外结构化细节(zod issues / 匹配位置 / 实际值等) */
  details?: unknown;
}
/** 格式化工具错误为 `ERROR: {json}` 字符串(单行 JSON,前缀 ERROR) */
export declare function toolError(e: ToolErrorInput): string;
/** zod 校验失败 → toolError(提取 issues 为 details) */
export declare function zodError(path: string, issues: unknown[]): string;
/** JSON 解析失败 → toolError(带原解析错误 + 预览) */
export declare function jsonParseError(path: string | undefined, raw: string, err: unknown): string;
/** 提取 zod issues 为结构化 details(每条 path/expected/received/message) */
export declare function formatZodIssues(issues: unknown[]): unknown[];

// === 与 src/core/index.ts 导出对齐(消费者类型完整;复杂内部类型用宽松声明,消费者主要消费工厂返回值) ===
// 上下文压缩预设
export declare function resolveContextOptions(options: any, modelContextWindow: number): any;
export type ContextPreset = 'auto' | 'conservative' | 'aggressive';
export declare const CONTEXT_PRESETS: Record<string, any>;

// MCP
export declare function connectMcp(config: any): Promise<any>;
export declare function extractText(result: any): string;
export type McpTransport = 'http' | 'sse' | 'websocket';
export interface McpConnection { [k: string]: any }

// harness / 中间件
export interface CreateAgentOptions { [k: string]: any }
export interface Middleware { name: string; [k: string]: any }
export interface ModelRequest { [k: string]: any }
export interface ModelResponse { [k: string]: any }
export interface ToolCallContext { [k: string]: any }
export interface StateUpdate { [k: string]: any }

// 子 agent
export declare function createSubagentsMiddleware(opts: any): any;
export interface SubagentOptions { [k: string]: any }
export interface SubagentLlmConfig { [k: string]: any }

// checkpoint / dataOps / permissions
export interface CheckpointDeps { [k: string]: any }
export interface DataAuditEntry { [k: string]: any }
export interface DataSnapshotEntry { [k: string]: any }
export type PermissionOp = string;

// vfs
export declare function createVfs(opts?: any): any;

// 上下文管理
export interface ContextManagerOptions { [k: string]: any }
export interface CompressionStats { [k: string]: any }

// 模型能力 / token 估算 / offload 阈值
export declare function resolveModelCaps(model: string): any;
export declare function estimateTokens(text: string): number;
export declare function offloadThresholdChars(contextWindow: number): number;
export declare function offloadPassThroughChars(contextWindow: number): number;
export interface ModelCaps { [k: string]: any }

// 剪贴板复制(clipboard API + execCommand 降级,兼容非 secure context / 旧浏览器)
export declare function copyText(text: string): Promise<boolean>;
