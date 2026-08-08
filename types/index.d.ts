import { DefineComponent, Ref } from 'vue';
export { z } from 'zod';

// 代理连接模块(防 apiKey 泄露:proxy 代理模式 / direct 直连模式)
export type ProxyLlmMode = 'proxy' | 'direct';
export interface ProxyLlmOptions {
  mode: ProxyLlmMode;
  baseUrl?: string;
  userToken?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  refreshToken?: () => Promise<string>;
  headers?: Record<string, string>;
}
export declare function createProxyLlm(opts: ProxyLlmOptions): import('@langchain/core/language_models/chat_models').BaseChatModel;

export interface ToolStep {
  name: string;
  args?: any;
  result?: string;
  status: 'running' | 'done' | 'error';
  /** 工具执行耗时(毫秒,tool_result 时回填) */
  durationMs?: number;
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
  | { type: 'session_restored'; sessionId: string; rounds: number }
  | { type: 'usage'; round: number; usage: TokenUsage; cumulative: TokenUsage }
  | { type: 'error'; message: string; severity?: 'recoverable' | 'fatal' | 'observable'; code?: string; context?: unknown }
  | { type: 'trace'; spans: TraceSpan[]; metrics: TraceMetrics };

/** token 用量(OpenAI 协议字段名) */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
/** 批处理单任务结果(sdk.batch 返回;ok=true 含 reply,ok=false 含 error) */
export interface BatchResult {
  /** 任务在入参数组中的下标 */
  index: number;
  /** 任务文本 */
  task: string;
  /** 成功时的 agent 回复 */
  reply?: string;
  /** 失败时的错误信息 */
  error?: string;
  /** 是否成功 */
  ok: boolean;
}
/** 批处理进度回调 payload(sdk.batch 的 onProgress 每任务完成调一次) */
export interface BatchProgress {
  done: number;
  total: number;
  task: string;
  ok: boolean;
}

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
  /** 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新) */
  subagents?: { id: string; description: string }[];
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
  /** 子 agent 可写路径前缀白名单(给子 agent 写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁)。subagent-writable Phase 2 */
  writablePaths?: string[];
}
export interface AgentInfo {
  id: string;
  /** 当前会话 id(switchSession/onClear 后实时反映) */
  sessionId: string;
  model?: string;
  /** 当前生效的 systemPrompt(默认或用户传入;仅 base 段,不含中间件 augmentPrompt,便于调试/验证默认提示词) */
  systemPrompt: string;
  tools: ToolInfo[];
  skills: SkillInfo[];
  data?: DataInfo;
  /** 当前上下文压缩预设(默认 auto;complex 为多步复杂任务/大 JSON 场景) */
  contextPreset: 'auto' | 'conservative' | 'aggressive' | 'complex';
  memory: string;
  middleware: string[];
  todos: { id: string; content: string; status: string }[];
  /** 规划阶段防死循环状态(maxPlanRevisions 预算;planning 关闭时 inPlanning 恒 false) */
  planPhase?: { inPlanning: boolean; rounds: number; limit: number };
  /** 当前任务目标锚点(mission 中间件;未开启/未 capture → undefined) */
  mission?: Mission;
  /** 宿主动作元信息(actions 注册;集成方 save_draft/publish 等) */
  actions?: Record<string, { description: string; hasParams: boolean }>;
  /** 跨压缩工作记忆(workingMemory 中间件;pin 最近 read/query/search 定位 path + read hash,≤10 LRU) */
  workingMemory?: WorkingMemory;
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
  /** 结构化追踪(revive-observability-tracing;capabilities.tracing 开时填充,否则 undefined) */
  trace?: { spans: TraceSpan[]; metrics: TraceMetrics };
  /** 上下文构成快照(context-inspector;每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  context?: ContextSnapshot;
}
/** 上下文分类(context-inspector) */
export interface ContextCategory {
  key: string;
  label: string;
  tokens: number;
  pct: number;
  msgCount: number;
}
/** 上下文构成快照(context-inspector;每轮 wrapModelCall 覆盖,不累积) */
export interface ContextSnapshot {
  totalTokens: number;
  contextWindow?: number;
  /** totalTokens / contextWindow(无窗口为 0) */
  occupancy: number;
  /** 压缩触发阈值占比 */
  thresholdRatio: number;
  /** 分类明细(按 tokens 降序) */
  categories: ContextCategory[];
  /** 最近一次压缩统计(复用 state.lastCompression) */
  compression?: { triggered: boolean; roundsTotal: number; roundsSummarized: number; roundsRecalled: number; originalMessages: number; compressedMessages: number; strategy: string };
}
/** analyzeContext 选项(context-inspector) */
export interface AnalyzeContextOptions {
  contextWindow?: number;
  thresholdRatio?: number;
}
/** 对「实际发给 LLM 的消息」分类切分 + token 估算(纯函数,零 LLM 成本) */
export declare function analyzeContext(messages: import('@langchain/core/messages').BaseMessage[], opts?: AnalyzeContextOptions): ContextSnapshot;
/** 上下文检查中间件选项(context-inspector) */
export interface ContextInspectorOptions {
  contextWindow?: number;
  thresholdRatio?: number;
}
/** 上下文检查中间件(context-inspector;getSnapshot 读最近快照) */
export interface ContextInspectorMiddleware {
  name: string;
  getSnapshot(): ContextSnapshot | undefined;
}
/** 创建上下文检查中间件(capabilities.contextInspector 默认开) */
export declare function createContextInspectorMiddleware(opts?: ContextInspectorOptions): ContextInspectorMiddleware;
export interface McpServerConfig { transport: 'http' | 'sse' | 'websocket'; url: string; name?: string; requestInit?: any; }

export declare const ChatDialog: DefineComponent<ChatDialogProps>;
export declare const MessageContent: DefineComponent<any>;
export declare const CodePreview: DefineComponent<any>;
export declare const SkillPanel: DefineComponent<any>;
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
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking: { thinking: { type: 'enabled' } }) */
  extraBody?: Record<string, any>;
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并 */
  extraConfig?: Record<string, any>;
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

export interface SkillsController {
  /** 运行时替换整个 skill 列表(同名 skill 覆盖更新;清缓存) */
  set(skills: SkillSpec[]): void;
  /** 读取当前 skill 列表(反映运行时 setSkills 替换) */
  get(): SkillSpec[];
  /** 清指定 skill 的全文缓存(不传清全部);下次 load_skill 重新取最新 */
  invalidateCache(name?: string): void;
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
  /** 加载时执行脚本,结果注入全文(skill-external-scripts);code/url 二选一,默认 sandbox,失败不缓存 */
  exec?: SkillExecSpec;
  /** 附带可调工具工厂;load_skill 后注入工具池(命名空间 <skill>__<tool>,走 dedupeTools);与 exec 正交 */
  tools?: SkillToolFactory[];
}
/** skill 执行钩子:code(内联 JS)/url(远程,仅 sandbox)二选一;context 默认 sandbox,host 需 skillHostScript */
export interface SkillExecSpec {
  code?: string;
  url?: string;
  context?: 'sandbox' | 'host';
  inject?: 'append' | 'prepend';
}
/** skill 附带工具工厂(返回单个/数组工具,可异步;ctx.signal 运行时中止信号) */
export type SkillToolFactory = () => any | any[] | Promise<any | any[]>;

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
export interface Checkpoint extends CheckpointMeta {
  messages: AgentMessage[];
  windowVals: Record<string, unknown>;
  vfs: Record<string, { content: string; mimeType?: string; updatedAt: number }>;
  todos: { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }[];
}
export interface CheckpointManager {
  save(label?: string): number;
  list(): CheckpointMeta[];
  restore(id?: number): boolean;
  canRestore(): boolean;
  /** 导出栈快照(深拷贝,可序列化;供 automation 断点续跑持久化,刷新/崩溃后恢复 restoreLastCheckpoint 能力) */
  exportStack(): Checkpoint[];
  /** 灌入栈快照(刷新/崩溃恢复时重建 checkpoint 栈;重置 nextId 防后续 save id 冲突) */
  importStack(cps: unknown[]): void;
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
/** Skill 独立持久化存储配置(与 storage 选项分离) */
export interface SkillStoreConfig {
  /** 存储 id(命名空间)。手动指定同一 id 即可跨页面/跨 agent 复用同一套用户 skill;不传默认按 agentId 隔离 */
  id?: string;
  /** 后端类型,默认 'indexed'(大容量、跨刷新);'local' 跨页持久;'session' 刷新保留关页清;'memory' 纯内存降级 */
  backend?: StorageBackendType;
  /** DB 命名空间,默认 'chat-sdk'(与 SessionStore 同库,不同 key 前缀) */
  dbName?: string;
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
  todos: { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }[];
  memory: string;
  /** automation 断点续跑:checkpoint 栈快照(刷新/崩溃后恢复 restoreLastCheckpoint 能力);仅 capabilities.automation 开启时写入 */
  checkpoints?: unknown[];
  /** automation 断点续跑:累计 token usage(刷新后续跑预算统计连续) */
  usage?: TokenUsage;
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
  /** 更新会话标题(自动从首条 user 消息生成,供历史列表显示) */
  updateTitle(agentId: string, sessionId: string, title: string): Promise<void>;
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

/**
 * augmentSystem 钩子上下文:集成方回调据此按运行时状态动态注入 system prompt 段。
 * - `state`:harness 当前状态(messages/todos/files/skills/memory…);不含 data(data 是 createChatSdk 层概念)
 * - `data`:当前主数据配置(每轮从 liveData() 取最新,setData 后自动同步;含 schema/bind/description)
 */
export interface SystemAugmentContext {
  state: any;
  data?: DataConfig;
}

/** 宿主动作定义:集成方注册的页面操作(保存/发布/预览/导出等),SDK 自动包成命名 tool */
export interface ActionDef {
  /** 动作描述(给 LLM 看) */
  description: string;
  /** 执行函数;接收 params schema 解析的参数,返回值序列化回灌 LLM */
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** 可选参数 schema(ZodObject);不传 = 无参 tool */
  params?: any;
}
/** actions 配置:动作名 → 定义(动作名即 tool 名,须合法标识符) */
export type ActionMap = Record<string, ActionDef>;
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
  /** 系统提示词(base + 可操作数据段,数据段随 data 动态;不含 todos/skills/memory/augmentSystem 等运行态 augmentPrompt 段) */
  systemPrompt?: string;
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 true,用 '---' 分隔线区分;设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置,此项无效) */
  appendReliableWriteRules?: boolean;
  /**
   * 动态 system prompt 注入钩子:每轮 buildSystemPrompt 时调用,集成方按运行时状态(state/data)返回字符串 → 作为 system prompt 一段注入;返回 undefined → 跳过。
   * - ctx.data 每轮从 liveData() 取最新(setData 后自动同步),可据此动态算组件说明 / 部分 schema 描述
   * - 回调异常降级为跳过该段 + debug 日志(不崩 agent)
   * - 段排在内置段之后、用户 middleware 之前;不配 = 完全现状行为
   */
  augmentSystem?: (ctx: SystemAugmentContext) => string | undefined;
  tools?: any[];
  /** 宿主动作:集成方注册的页面操作(保存/发布/预览等),SDK 自动包成命名 tool;LLM 直接看到命名 tool */
  actions?: ActionMap;
  skills?: SkillSpec[];
  /** 用户创建 skill 的独立持久化存储(与 storage 选项分离)。默认 `{ backend: 'indexed' }`(即使 storage:false 也持久化);`false` 关闭;`id` 手动指定同一 id 可跨页面/跨 agent 复用 */
  skillStorage?: SkillStoreConfig | false;
  /** AGENTS.md 风格持久指令。支持 string 与同步/异步函数(异步函数适合加载 RAG 文档) */
  memory?: string | (() => string | Promise<string>);
  data?: DataConfig;
  /** 大 schema 分层披露阈值(默认 maxKeys=15/maxChars=4000;超则 systemPrompt 只注入顶层概览,深层约束查 schema_data) */
  schemaHint?: SchemaHintOptions;
  permissions?: PermissionRule[];
  /** 自定义中间件(注入到内置中间件之后;可拦截/观察模型调用、工具、prompt) */
  middleware?: any[];
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number };
  /** 每个数据对象最多保留快照数(默认 20) */
  maxSnapshots?: number;
  /** 自动乐观锁(默认 true):写入时若 LLM 未传 expectedHash,自动用其最后 get 读到的 hash 比对;设 false 回退「不传 = 不校验」 */
  autoLock?: boolean;
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; value?: unknown; detail?: string; timestamp: number }) => void;
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
  /** 规划阶段总轮次预算(默认 5);planning 状态下超限 → write_todos/update_todo 回灌,防"光规划不执行"死循环。与 maxIterations 正交 */
  maxPlanRevisions?: number;
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number;
  /** token 预算上限(累计 total_tokens 超过 → 停止 agent + emit BUDGET_EXCEEDED;需 capabilities.automation:true) */
  tokenBudget?: number;
  /** 时间预算 ms(从 agent 开始计时,超过 → 停止;需 capabilities.automation:true) */
  timeBudgetMs?: number;
  /** 无人值守错误恢复:致命错误(invoke 抛错)自动 restore_last_checkpoint + 重试次数(默认 1;防单点错误永久中断批量/长任务)。需 capabilities.automation:true */
  maxAutoRetries?: number;
  /** 同轮工具并发上限(默认 1 串行) */
  maxParallelTools?: number;
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number;
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number;
  /** 子 agent 委派(默认开启;{ enabled: false } 关闭) */
  capabilities?: { dataOps?: boolean; fetch?: boolean; planning?: boolean; missionAnchor?: boolean; skills?: boolean; vfs?: boolean; summarization?: boolean; memory?: boolean; subagent?: boolean; verify?: boolean; domInspect?: boolean; inspectEnv?: boolean; draftWrite?: boolean; tracing?: boolean; todoDeps?: boolean; automation?: boolean; workingMemory?: boolean; skillHostScript?: boolean; contextInspector?: boolean };
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
  /** 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive / complex(多步复杂任务/大 JSON);提供合理默认,contextOptions 细参可覆盖 */
  contextPreset?: 'auto' | 'conservative' | 'aggressive' | 'complex';
  /** 摘要压缩专用 LLM(BaseChatModel 实例或 LLMConfig);不传则默认用主 agent 模型(llm) */
  summaryLlm?: any;
  /** 标题生成 LLM(BaseChatModel 实例或 LLMConfig);不传则用 summaryLlm → 主 llm。首轮后自动生成会话标题(主旨) */
  titleLlm?: any;
  /** 自动生成会话标题(默认 true:首轮后调 LLM 生成主旨标题;false 关闭,用规则 deriveTitle 截取) */
  autoTitle?: boolean;
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
  /** Dialog UI config (title/placeholder/drawer/drawerWidth/drawerHidden/inputRows/onClose grouped) */
  dialog?: DialogConfig;
}

/** Dialog UI config (grouped form, recommended) */
export interface DialogConfig {
  title?: string;
  placeholder?: string;
  drawer?: boolean;
  drawerWidth?: number | string;
  drawerHidden?: boolean;
  /** Input box rows (visible height); default 2 (2-row initial height, auto-expands up to max-height:100px). 1 = single row; >2 = taller. */
  inputRows?: number;
  onClose?: () => void;
}

/** 会话级任务目标锚点(mission 中间件;capture 或 setMission;revive-mission-anchor Phase 1) */
/** 跨压缩工作记忆(workingMemory 中间件;经 augmentPrompt 每轮注入 system,天然跨压缩保留) */
export interface WorkingMemory {
  locatedPaths: string[];
  lastHashes: Record<string, string>;
}
export interface Mission {
  /** 一句话任务目标(必填) */
  goal: string;
  /** 完成标准(可选,集成方显式传入) */
  acceptanceCriteria?: string[];
  /** 来源 user 消息 index(自动 capture 时填) */
  sourceMessageIdx: number;
  /** capture/setMission 时间戳 */
  capturedAt: number;
  /** true=集成方显式 setMission;false=自动 capture */
  explicit: boolean;
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless)。
   *  可选传 overrideContainer(HTMLElement | 选择器字符串)覆盖创建时 options.container —— 异步绑定:创建时可省略 container,mount 时才指定 */
  mount(overrideContainer?: HTMLElement | string): Promise<void>;
  /** 响应式消息数组(headless 模式自建 UI 读) */
  messages: AgentMessage[];
  unmount(): void;
  /** 抽屉模式隐藏:加 cs-hidden class,不卸载 vueApp/不 release agent —— 保留聊天历史与正在进行的生成进程;再 mount() 直接 show 恢复 */
  hide(): void;
  /** 抽屉模式显示:移除 cs-hidden class 恢复可见(配合 hide 使用;首次挂载用 mount) */
  show(): void;
  send(message: string, options?: { mission?: Partial<Mission> }): Promise<string>;
  switchSession(sessionId?: string): Promise<string>;
  /** 列出当前 agent 的所有历史会话(供「历史列表」UI;storage 未开启 → []) */
  listSessions(): Promise<SessionMeta[]>;
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh/hook) */
  readonly sessions: import('vue').Ref<SessionMeta[]>;
  /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
  deleteSession(sessionId: string): Promise<void>;
  /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
  readonly sessionId: string;
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos) */
  inspect(): AgentInfo;
  /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  inspectContext(): ContextSnapshot | undefined;
  /** 读取当前任务目标锚点 mission(自动 capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined;
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void;
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint,无可用返回 false */
  restoreLastCheckpoint(): boolean;
  /** 列出可用 checkpoint(回退点);需开启 checkpoint,未开启返回空数组 */
  listCheckpoints(): CheckpointMeta[];
  /**
   * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint,任务间错误隔离(单任务失败记 error 不中断整批)。
   * 适合无人值守批量操作(批量生成/改一批页面)。不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。
   * 配合 capabilities.automation + checkpoint 使用。
   */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void): Promise<BatchResult[]>;
  /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
  hook(handler: SdkEventHandler): () => void;
  /** 运行时替换主数据配置(如页面切换、schema 变更);立即对数据工具生效,无需重建 agent。需开启 dataOps */
  setData(config: DataConfig): void;
  /** 读取当前主数据配置;dataOps 关闭时返回 undefined */
  getData(): DataConfig | undefined;
  /**
   * 运行时替换整个 skill 列表(同名 skill 覆盖更新)。立即生效:system prompt 的 skill 索引段下轮重渲染反映新 skill;
   * 清空 skill 全文缓存与本轮已加载记录,下次 load_skill 重新取最新全文(含 vfs doc)。需开启 skills(默认开)
   */
  setSkills(skills: SkillSpec[]): void;
  /** 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖)。需开启 skills(默认开) */
  addSkill(skill: SkillSpec): void;
  /** 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills)。返回是否删除成功 */
  removeSkill(name: string): boolean;
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[];
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined;
  /**
   * 清 skill 全文缓存(动态 skill 内容变化时主动失效)。不传 name 清全部;传 name 清指定。
   * 下次 load_skill 重新 getContent/readSkillDoc 取最新。需开启 skills(默认开)
   */
  invalidateSkillCache(name?: string): void;
  /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
  exportData(): any;
  /** 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用);默认经 schema 校验,不合法返回 {ok:false,error};opts.validate:false 跳过校验,opts.emit:false 不发 data_change */
  importData(json: any, opts?: { validate?: boolean; emit?: boolean }): { ok: boolean; error?: string };
  /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
  usage: TokenUsage;
  /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 自建 UI */
  pendingConflict: Ref<PendingConflict | null>;
  /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
  resolveConflict(action: ConflictResolution['action']): void;
  /** 运行时替换用户工具集(内置工具不动);立即 rebind + infoTick 刷新 */
  setTools(tools: any[]): void;
  /** 运行时追加用户工具(去重 by name);立即生效 */
  addTool(tool: any): void;
  /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
  removeTool(name: string): boolean;
  /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
  setLlm(llm: ChatModelLike | LLMConfig): void;
  /** 运行时更新 memory;支持 string 与同步/异步函数(异步函数后台求值,下一轮 beforeAgent 前就绪) */
  setMemory(source: string | (() => string | Promise<string>)): void;
  /** 重新求值当前 memory 函数 source(RAG 文档更新后强制刷新);返回最新文本 */
  refreshMemory(): Promise<string>;
  /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind);需创建时配 subagents:[] */
  setSubagents(configs: SubagentConfig[]): void;
  /** 运行时追加预声明子 agent(id 重复 warn 跳过);需创建时配 subagents:[] */
  addSubagent(config: SubagentConfig): void;
  /** 运行时移除预声明子 agent(by id);返回是否移除成功;需创建时配 subagents:[] */
  removeSubagent(id: string): boolean;
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
// ============ system prompt 构建(promptBuilder,refactor-module-extraction 从 createChatSdk 抽离)============
/** 默认 systemPrompt(用户未传 systemPrompt 时用);含身份 + 能力概述 + 可靠写入规则 */
export declare const DEFAULT_SYSTEM_PROMPT: string;
/** 拼接「可操作数据」段(从 data schema .describe() 自动提取注入) */
export declare function buildDataPrompt(data: DataConfig | undefined): string;
/**
 * 统一 systemPrompt base 段入口:处理 appendReliableWriteRules 分支 + '---' 分割线。
 * 传 systemPrompt 默认追加 reliableWriteRules(设 appendReliableWriteRules:false 关闭);不传用 DEFAULT_SYSTEM_PROMPT(已内置)。纯函数。
 */
export declare function buildSystemPrompt(opts: { systemPrompt?: string; appendReliableWriteRules?: boolean }): string;
export declare function defineTool(opts: {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => unknown | Promise<unknown>;
}): any;
export declare function createDataOps(config: DataConfig, opts?: DataOpsOptions): any[];
export declare function filterByToolMode(tools: any[], mode?: 'simple' | 'advanced' | 'minimal'): any[];
/** 整体 set 写入纯函数:schema 校验 + 快照 + merge/替换 + audit。set_data / write(set) / draft_commit 共用。返回 {ok,hash,data} 或 {ok:false,error} */
export declare function commitSetToBind(args: { bindRef: unknown; value: unknown; schema: any; allowKeys: string[] | null; snapshots: any[]; maxSnapshots: number; audit: (e: any) => void; dryRun?: boolean; op?: 'set' | 'draft_commit' }): { ok: true; hash: string; data: unknown } | { ok: false; error: string };
/** 结构化追踪 span(revive-observability-tracing Phase 3) */
export type SpanType = 'round' | 'model' | 'tool' | 'compression';
export type SpanStatus = 'ok' | 'error' | 'timeout';
export interface TraceSpan {
  id: string;
  parentId?: string;
  name: string;
  type: SpanType;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}
export interface TraceMetrics {
  rounds: number;
  totalDurationMs: number;
  avgRoundMs: number;
  toolCalls: number;
  toolFailures: number;
  toolSuccessRate: number;
  modelCalls: number;
  retries: number;
  compressions: number;
  totalTokens?: { prompt: number; completion: number; total: number };
}
/** 从 TraceSpan[] 聚合 metrics(纯函数:轮次/延迟/工具成功率/重试/压缩/token) */
export declare function getTraceMetrics(spans: TraceSpan[]): TraceMetrics;
// ============ 通用 JSON 操作纯函数(jsonUtils,refactor-module-extraction 从 dataOps 抽离;零依赖,经 ./query subpath 按需引入)============
export type EditOp = 'set' | 'remove' | 'merge' | 'append';
export declare const UNSAFE_KEYS: Set<string>;
export declare function isUnsafePath(path: string): boolean;
export declare function safeMerge(target: Record<string, any>, src: unknown): void;
export declare function getByPath(obj: unknown, path: string): unknown;
export declare function setByPath(obj: unknown, path: string, value: unknown): void;
export declare function deleteByPath(obj: unknown, path: string): boolean;
export declare function deepClone<T>(v: T): T;
export declare function maybeParseValue(v: unknown): { parsed?: unknown; parseError?: unknown };
export declare function projectFields(obj: unknown, fields: string[]): unknown;
export declare function limitDepth(obj: unknown, depth: number): unknown;
export declare function safeStringify(value: unknown, maxLen?: number): string;
export declare function hashValue(value: unknown): string;
export declare function applyPatchToClone(clone: any, op: EditOp, jsonPath: string, value: unknown): string | null;
export declare function applyPatchToLive(bind: any, op: EditOp, jsonPath: string, value: unknown): void;
export declare function restoreLive(bind: any, snapshotVal: unknown): void;
export declare function restoreInPlace(live: Record<string, unknown> | unknown[], snapshotVal: unknown): void;
/** 深度差异对比(对象/数组递归,叶子差异),返回 {path, from, to}[];供 diff_data / verify 自纠 / 审计复用 */
export declare function diffObjects(a: unknown, b: unknown, prefix?: string): { path: string; from: unknown; to: unknown }[];
// ============ schema 白名单投影纯函数(schemaUtils,refactor-module-extraction 从 dataOps 抽离)============
export declare function getSchemaTopKeys(schema: any): string[] | null;
export declare function isPathAllowed(jsonPath: string, schema: any | null, allowKeys: string[] | null): boolean;
export declare function unwrapSchema(schema: any): any;
export declare function getSchemaAtPath(schema: any, jsonPath: string): any | null;
export declare function projectBySchemaDeep(obj: unknown, schema: any | null): unknown;
export declare function projectBySchema(obj: unknown, allowKeys: string[] | null): unknown;
// ============ schema 约束结构化提取(expose-schema-constraints;供 systemPrompt「可操作数据」段 / read 概览 / schema_data 工具)============
export interface SchemaNodeDesc {
  type: string;
  constraints?: {
    minLength?: number; maxLength?: number; length?: number;
    min?: number; max?: number; int?: boolean;
    format?: string | string[];
    values?: readonly (string | number)[];
    value?: unknown;
    item?: SchemaNodeDesc;
    shape?: Record<string, SchemaNodeDesc>;
    anyOf?: SchemaNodeDesc[];
    valueType?: SchemaNodeDesc;
  };
  optional?: boolean;
  nullable?: boolean;
  default?: unknown;
  description?: string;
}
/** 结构化提取单个 zod 节点的约束(type + 关键约束 + optional/default/nullable;zod 4 `_def`/`_zod.def` 读取) */
export declare function describeSchemaNode(schema: any): SchemaNodeDesc;
/** 把标量约束格式化为括号内短串(min/max/enum/format 等;shape/item/anyOf 不渲染) */
export declare function formatConstraints(c: NonNullable<SchemaNodeDesc['constraints']>): string;
/** 渲染单行字段标注 `- key (Type?)[约束]: description` */
export declare function renderSchemaHint(key: string, desc: SchemaNodeDesc): string;
/** 渲染 schema 顶层字段约束总览(非 object fallback 根节点;供 extractSchemaHint + read 概览复用) */
export declare function renderSchemaOverview(schema: any): string;
/** 渲染 schema 顶层字段浅概览(分层模式:只 key+type+desc,不带约束/不递归;大 schema 用,体积降) */
export declare function renderSchemaShallow(schema: any): string;
/** extractSchemaHint 分层阈值配置(默认 maxKeys=15/maxChars=4000;超则转顶层概览) */
export interface SchemaHintOptions { maxKeys?: number; maxChars?: number }
// ============ 上下文索引纯函数(contextIndex,refactor-module-extraction 期二 从 useContextManager 抽离)============
export declare const STOP_WORDS: Set<string>;
export declare function tokenize(text: string): string[];
export declare function estimateMessageTokens(m: any): number;
export declare function estimateRoundTokens(r: any): number;
export declare function indexSummarize(older: any[], preserve?: Set<string>): string;
export declare function recallRounds(older: any[], query: string, topK: number): any[];
// ============ LLM 解析(llmResolver,refactor-module-extraction 期二 从 createChatSdk 抽离)============
export declare function isChatModel(v: unknown): boolean;
export declare function resolveLlm(options: any): { modelCaps: any; summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined };
export declare function deriveTitle(msgs: AgentMessage[]): string | undefined;
// ============ 乐观锁冲突管理器(conflictManager,refactor-module-extraction 期二 从 createChatSdk 抽离)============
export interface ConflictManager {
  pendingConflict: import('vue').Ref<any | null>;
  set(info: any): Promise<any>;
  resolve(action: any): void;
}
export declare function createConflictManager(getEmit?: () => (((e: any) => void) | undefined)): ConflictManager;
// ============ 配置解析 + 事件系统(optionsResolver/events,refactor-module-extraction 期三)============
// capabilities 能力开关注册表 + 单一解析(p2-refactor 子项 4:消除 11/17 开关 ===true/!==false 混)
export interface Capability { name: string; defaultOn: boolean; requires?: readonly string[] }
export type CapabilityFlags = Partial<Record<string, boolean>>;
export type ResolvedCapabilities = Record<string, boolean>;
export declare const CAPABILITIES: readonly Capability[];
/** 单一解析:集成方原始 caps(Partial)→ 全量 boolean(opt-out 默认开 !==false / opt-in 默认关 ===true;requires 依赖未满足强制关)。参数宽松 Record<string,unknown>(兼容含 subagents 等非 boolean 字段的 caps 对象;只读已知 capability 的 boolean) */
export declare function resolveCapabilities(caps?: Record<string, unknown>): ResolvedCapabilities;
export declare function resolveStorage(storage: any): any | null;
export declare function resolveDialogConfig(opts: any): any;
export interface SdkEvents {
  listeners: Set<(e: any) => void>;
  emit: (e: any) => void;
  hook(handler: (e: any) => void): () => void;
}
export declare function createSdkEvents(onEvent?: (e: any) => void): SdkEvents;
export declare function selectBuiltinTools(caps: { dataOps?: boolean; fetch?: boolean; domInspect?: boolean; inspectEnv?: boolean } | undefined, dataOps: any[], fetchDocs: any[], dom?: any[], inspect?: any[]): any[];
export declare function createUsageHintsMiddleware(caps: { planning?: boolean; dataOps?: boolean; subagent?: boolean } | undefined, hasDataOps: boolean, toolMode?: 'simple' | 'advanced' | 'minimal'): any;
export declare const fetchDocTools: any[];
/** DOM 读取工具 get_dom(随 capabilities.domInspect 装配,opt-in) */
export declare const domTools: any[];
export declare const domToolsStatic: any[];
/** 环境探查工具 inspect_env(随 capabilities.inspectEnv 默认装配,默认开;排查 window/location/调试变量) */
export declare const inspectTools: any[];
/** 单个 inspect_env 工具(inspectTools 数组的元素) */
export declare const inspectEnvTool: any;
/** 纯函数:安全序列化任意值(跳过 function/DOM,防循环引用,截断)—— inspect_env 读 window[key] 时用 */
export declare function safeSerialize(value: unknown, depth?: number, maxLen?: number, seen?: WeakSet<object>): unknown;
/** 环境摘要(location/navigator/viewport/document);inspect_env 无参时返回,可传 win 注入测试 */
export declare function getEnvSummary(win?: Window & typeof globalThis): Record<string, unknown>;
export declare const getDomTool: any;
/** 纯函数:DOM Element → 结构化 DomNode(可单测,与浏览器解耦) */
export declare function domToStructure(node: Element | null, opts: { depth: number; attrs?: string[]; includeText?: boolean }): DomNode | null;
/** 把集成方注册的 actions 转成命名 tool 数组(每个 action 一个 tool) */
export declare function actionsToTools(actions: ActionMap): any[];
export declare function actionsToInspectInfo(actions: ActionMap): Record<string, { description: string; hasParams: boolean }>;
export interface DomNode { tag: string; attrs: Record<string, string>; text?: string; children?: DomNode[]; childCount?: number }
export interface DomReadOptions { depth: number; attrs?: string[]; includeText?: boolean }
export declare const fetchTools: any[];
export declare function defineDataToolset(config: DataConfig, opts?: DataOpsOptions): any[];
export declare function defineSkill(spec: SkillSpec): SkillSpec;
export declare function createAgent(options: any): any;
/** 检测模型把工具调用写成文本(伪 XML/标签)而非标准 tool_calls 的异常格式;主循环据此回灌 feedback 自纠 */
export declare function detectGarbledToolCall(content: string): boolean;
export declare function createSubagentMiddleware(opts: any): any;
export declare function createVerifyMiddleware(opts: VerifyMiddlewareOptions): any;
export declare function createWriteBackCheck(opts?: WriteBackCheckOptions): VerifyCheck;
export declare function createMemoryMiddleware(memory?: string | (() => string | Promise<string>)): any;
export type MemorySource = string | (() => string | Promise<string>);
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
/** 创建 Skill 独立持久化存储(与 storage 选项分离;默认 indexedDB,可手动指定 id 跨页复用) */
export declare function createSkillStore(config?: SkillStoreConfig): SkillStore;
export interface SkillStore {
  ready: Promise<boolean>;
  list(): Promise<PersistedSkill[]>;
  get(name: string): Promise<PersistedSkill | undefined>;
  put(skill: PersistedSkill): Promise<void>;
  remove(name: string): Promise<boolean>;
  clear(): Promise<void>;
  dispose(): void;
}
/** 持久化的用户创建 skill(getContent 函数不可序列化,故 content 直接存字符串) */
export interface PersistedSkill {
  name: string;
  description: string;
  content: string;
}

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
/** 通用 Worker 沙箱结果(eval_script 与 skill exec 共用;EvalResult 的别名同构) */
export interface SandboxResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  elapsedMs: number;
}
/**
 * 创建沙箱执行器(柯里化:先绑 script+timeoutMs,再传可选 input)。三层防护:静态扫描禁用模式 +
 * lockSandboxGlobal defineProperty 锁网络/存储 API(防 delete self.fetch 逃逸)+ 超时 terminate。
 * 无 input 传 undefined(skill exec);有 input 作 data 入参(eval_script)。
 */
export declare function createSandboxRunner(script: string, timeoutMs?: number): (input?: unknown) => Promise<SandboxResult>;
/** 宿主脚本执行(skill exec context:'host';AsyncFunction 主线程全权,不经静态扫描,需 capabilities.skillHostScript:true) */
export declare function runHostScript(code: string, timeoutMs?: number): Promise<SandboxResult>;

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
// ============ 统一错误模型(unify-error-model:三档 severity,各 catch 点按档路由)============
/** 错误严重程度三档:recoverable(回灌)/ fatal(中断)/ observable(记录不中断) */
export type ErrorSeverity = 'recoverable' | 'fatal' | 'observable';
/** 统一错误对象(结构化,跨层传递;普通 Error 经 asAgentError 归一化) */
export interface AgentError {
  severity: ErrorSeverity;
  message: string;
  code?: string;
  context?: unknown;
}
/** 错误路由:recoverable→feedback / fatal→abort / observable→log */
export type ErrorRouting = 'feedback' | 'abort' | 'log';
/** 路由纯函数:据 severity 决定错误如何被处理 */
export declare function routeError(err: AgentError): ErrorRouting;
/** 把任意错误归一化为 AgentError(已是 AgentError 不覆盖;普通 Error 用 defaultSeverity,默认 fatal) */
export declare function asAgentError(err: unknown, defaultSeverity?: ErrorSeverity): AgentError;
/** AgentError 便捷工厂 */
export declare function agentError(severity: ErrorSeverity, message: string, code?: string, context?: unknown): AgentError;

// === 与 src/core/index.ts 导出对齐(消费者类型完整;复杂内部类型用宽松声明,消费者主要消费工厂返回值) ===
// 上下文压缩预设
export declare function resolveContextOptions(options: any, modelContextWindow: number): any;
export type ContextPreset = 'auto' | 'conservative' | 'aggressive' | 'complex';
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
export interface SubagentsController {
  set(configs: SubagentConfig[]): void;
  add(config: SubagentConfig): void;
  remove(id: string): boolean;
  get(): SubagentConfig[];
}
/** spawn_agent / spawn_agents 运行时选项(role/tools/writablePaths 等可运行时覆盖) */
export interface SubagentOptions {
  role?: string;
  tools?: string[];
  /** 子 agent 可写路径前缀白名单(运行时覆盖;写工具包 path guard,越界 PATH_OUT_OF_SCOPE)。subagent-writable Phase 2 */
  writablePaths?: string[];
  model?: string;
  [k: string]: any;
}
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
/**
 * 串行化运行器(P1-2,arch-review):把并发异步操作排成串行链,一个跑完下一个才开始。
 * createChatSdk 的 send/switchSession/batch 经此串行化,防并发共享 state 竞态。
 * 返回的 runSerial(fn):fn 排队执行(前一个无论成败都继续),返回 fn 的 Promise(透传结果/错误)。
 */
export declare function createSerialRunner(): <T>(fn: () => Promise<T>) => Promise<T>;
