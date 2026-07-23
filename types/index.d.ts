import { DefineComponent } from 'vue';
export { z } from 'zod';

export interface ToolStep {
  name: string;
  args?: any;
  result?: string;
  status: 'running' | 'done' | 'error';
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
  | { type: 'done'; content: string };

export type StreamHandler = (event: StreamEvent) => void;

/** 调试日志(与 harness/createAgent 的 DebugLog 一致) */
export interface DebugLog {
  timestamp: number;
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware';
  data: any;
}

export interface ChatDialogProps {
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>;
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>;
  title?: string;
  placeholder?: string;
  debugLogs?: DebugLog[];
}

export declare const ChatDialog: DefineComponent<ChatDialogProps>;

// ===== 框架无关 SDK(页面内 Agent)=====
export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface WindowPropSpec {
  /** window 上的路径,支持点号嵌套 */
  path: string;
  description: string;
  /** 值的 zod schema(写入时校验) */
  schema: any;
}

export interface PermissionRule {
  operations: ('read' | 'write')[];
  scopes: string[];
  mode: 'allow' | 'deny';
}

export interface SkillSpec {
  name: string;
  description: string;
  whenToUse?: string;
  getContent: () => string | Promise<string>;
}

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

export interface PageAgentOptions {
  container: string | HTMLElement;
  llm: LLMConfig;
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
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number };
  /** 每个 window 属性最多保留快照数(默认 20) */
  maxSnapshots?: number;
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number;
  debug?: boolean;
  maxToolRounds?: number;
  contextOptions?: any;
  /** 流式输出(默认 true);false 时等整段回复再显示 */
  streaming?: boolean;
  title?: string;
  placeholder?: string;
}

export interface PageAgent {
  mount(): Promise<void>;
  unmount(): void;
  send(message: string): Promise<string>;
  switchSession(sessionId?: string): Promise<string>;
  stream: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>;
}

export declare function createPageAgent(options: PageAgentOptions): PageAgent;
export declare function defineTool(opts: {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => unknown | Promise<unknown>;
}): any;
export declare function defineSkill(spec: SkillSpec): SkillSpec;
export declare function createAgent(options: any): any;
export declare function createSessionStore(config?: StorageConfig): SessionStore;
export declare function createMemoryBackend(): StorageBackend;
export declare function createWebStorageBackend(storage: Storage): StorageBackend;
export declare function isQuotaError(err: unknown): boolean;
