import { DefineComponent } from 'vue';

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

export interface PageAgentOptions {
  container: string | HTMLElement;
  llm: LLMConfig;
  systemPrompt?: string;
  tools?: any[];
  skills?: SkillSpec[];
  memory?: string;
  windowProps?: WindowPropSpec[];
  permissions?: PermissionRule[];
  vfs?: { initialFiles?: Record<string, string> };
  /** 每个 window 属性最多保留快照数(默认 20) */
  maxSnapshots?: number;
  debug?: boolean;
  maxToolRounds?: number;
  contextOptions?: any;
  title?: string;
  placeholder?: string;
}

export interface PageAgent {
  mount(): void;
  unmount(): void;
  send(message: string): Promise<string>;
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
