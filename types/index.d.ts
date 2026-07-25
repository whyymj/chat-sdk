import { DefineComponent } from 'vue';
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
 * + 额外时机:window_prop_change / message_update / error。
 */
export type SdkEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error' }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result'; name: string; args?: any; result?: string; status?: 'done' | 'error' }
  | { type: 'done'; content: string }
  | { type: 'window_prop_change'; path: string; operation: 'set' | 'edit' | 'delete' | 'restore'; value?: unknown }
  | { type: 'message_update'; count: number }
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
export interface WindowPropInfo { path: string; description: string; schema?: unknown }
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
  tools: ToolInfo[];
  skills: SkillInfo[];
  windowProps: WindowPropInfo[];
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

export interface WindowPropSpec {
  /** window 上的路径,支持点号嵌套 */
  path: string;
  description: string;
  /** 值的 zod schema(写入时校验) */
  schema: any;
}
/** createWindowOps 选项(审计回调 / 只读探测 / 快照上限 / 字段白名单读) */
export interface WindowOpsOptions {
  onAudit?: (entry: { op: string; path: string; value?: any; detail?: string; timestamp: number }) => void;
  allowRawRead?: boolean;
  maxSnapshots?: number;
  /**
   * 字段白名单读模式(默认 true):仅允许读「注册 path 自身 / 其后代」,禁止读未注册的祖先,
   * 防止 LLM 经 get_window_prop('page') 把整个大 JSON 拉进上下文。
   * 集成方注册「可操作子路径」(如 page.theme.color / page.components)而非顶层时,默认即「LLM 只见声明字段」。
   * 设 false 回退原行为(允许读注册 path 的祖先,即整体读)。
   */
  whitelist?: boolean;
}

/** window 属性注册表控制器(运行时动态增删;createWindowOps 返回的工具数组上以不可枚举属性 `controller` 挂载) */
export interface WindowOpsController {
  /** 新增/覆盖一个属性注册项(运行时懒加载组件场景);覆盖时旧快照栈保留 */
  add(spec: WindowPropSpec): void;
  /** 移除一个属性注册项;返回是否确实存在并移除。快照栈一并清理 */
  remove(path: string): boolean;
  /** 列出当前所有注册项(反映动态增删后的最新状态) */
  list(): WindowPropSpec[];
  /** 是否已注册某 path */
  has(path: string): boolean;
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
  /** path → zod schema(由 createChatSdk 从 windowProps 构造注入);省略则只校验「读回非空」 */
  schemas?: Record<string, any>;
  /** 读 window 的根对象(默认 globalThis.window) */
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
  tools?: any[];
  skills?: SkillSpec[];
  memory?: string;
  windowProps?: WindowPropSpec[];
  permissions?: PermissionRule[];
  /** 自定义中间件(注入到内置中间件之后;可拦截/观察模型调用、工具、prompt) */
  middleware?: any[];
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number };
  /** 每个 window 属性最多保留快照数(默认 20) */
  maxSnapshots?: number;
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
  capabilities?: { windowOps?: boolean; fetch?: boolean; planning?: boolean; skills?: boolean; vfs?: boolean; summarization?: boolean; memory?: boolean; subagent?: boolean; verify?: boolean };
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
   * SDK 事件回调:订阅常用时机(window 属性变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
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
  /** 检视 agent 详细信息(tools/skills/windowProps/middleware/todos) */
  inspect(): AgentInfo;
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + window 注册属性 + vfs + todos);需开启 checkpoint,无可用返回 false */
  restoreLastCheckpoint(): boolean;
  /** 列出可用 checkpoint(回退点);需开启 checkpoint,未开启返回空数组 */
  listCheckpoints(): CheckpointMeta[];
  /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
  hook(handler: SdkEventHandler): () => void;
  /** 运行时动态新增/覆盖一个 window 属性注册项(懒加载组件:组件挂载时注册其 schema);立即对 window 工具生效,无需重建 agent。需开启 windowOps */
  addWindowProp(spec: WindowPropSpec): void;
  /** 运行时移除一个 window 属性注册项(组件卸载);返回是否确实存在并移除。快照栈一并清理 */
  removeWindowProp(path: string): boolean;
  /** 列出当前所有已注册 window 属性(反映动态增删后的最新状态) */
  listWindowProps(): WindowPropSpec[];
}

export declare function createChatSdk(options: ChatSdkOptions): ChatSdk;
export declare function defineTool(opts: {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => unknown | Promise<unknown>;
}): any;
export declare function createWindowOps(props: WindowPropSpec[], opts?: WindowOpsOptions): any[];
export declare function selectBuiltinTools(caps: { windowOps?: boolean; fetch?: boolean } | undefined, windowOps: any[], fetchDocs: any[]): any[];
export declare function createUsageHintsMiddleware(caps: { planning?: boolean; windowOps?: boolean; subagent?: boolean } | undefined, hasWindowOps: boolean): any;
export declare const fetchDocTools: any[];
export declare const fetchTools: any[];
export declare function defineWindowToolset(props: WindowPropSpec[], opts?: WindowOpsOptions): any[];
export declare function defineSkill(spec: SkillSpec): SkillSpec;
export declare function createAgent(options: any): any;
export declare function createSubagentMiddleware(opts: any): any;
export declare function createVerifyMiddleware(opts: VerifyMiddlewareOptions): any;
export declare function createWriteBackCheck(opts?: WriteBackCheckOptions): VerifyCheck;
export declare const presets: Record<string, any>;
export declare function createSessionStore(config?: StorageConfig): SessionStore;
export declare function createMemoryBackend(): StorageBackend;
export declare function createWebStorageBackend(storage: Storage): StorageBackend;
export declare function isQuotaError(err: unknown): boolean;

// ============ 大 JSON 查询/搜索/沙箱脚本(windowQuery)============
export interface JpNode {
  /** 相对属性根的点号路径(数组索引用数字,如 components.0.text) */
  path: string;
  /** 匹配元素值 */
  value: unknown;
  /** 父为数组时的索引(便于后续 edit_window_prop 的 jsonPath 定位) */
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
