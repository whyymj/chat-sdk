/** 工具调用步骤（用于在消息内展示思考过程） */
export interface ToolStep {
  name: string
  args?: any
  result?: string
  status: 'running' | 'done' | 'error'
  /** 子 agent 的工具步骤(spawn_agent/spawn_agents 委派时,展示子 agent 工作进度) */
  children?: ToolStep[]
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  /** 模型思考过程（DeepSeek reasoning_content 等） */
  reasoning?: string
  /** 本轮对话中的工具调用步骤 */
  steps?: ToolStep[]
}

export interface AgentConfig {
  model: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface AgentState {
  messages: AgentMessage[]
  loading: boolean
  error: string | null
}

/** 流式事件，由 Agent 在流式生成过程中逐个抛出 */
export type StreamEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error' }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result'; name: string; args?: any; result?: string; status?: 'done' | 'error' }
  | { type: 'done'; content: string }

/** 流式回调函数签名 */
export type StreamHandler = (event: StreamEvent) => void

export interface ChatDialogProps {
  /** 非流式 AI 请求函数（与 fetchStream 二选一） */
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>
  /** 流式 AI 请求函数，传入则优先使用流式输出 */
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 对话框标题 */
  title?: string
  /** 占位文本 */
  placeholder?: string
  /** 调试日志（响应式数组），传入则显示调试按钮 */
  debugLogs?: any[]
  /** 获取 agent 详细信息（供 debug 窗口「Agent 信息」tab 展示） */
  getInfo?: () => AgentInfo
}

/** agent 检视信息（inspect() 返回，供 debug 窗口展示） */
export interface ToolInfo { name: string; description: string; schema?: unknown }
export interface SkillInfo { name: string; description: string; whenToUse?: string }
export interface WindowPropInfo { path: string; description: string; schema?: unknown }

/** 工具集(成套工具打包,可整体导入主 agent 或子 agent,替代逐个点名) */
export interface Toolset {
  name: string
  tools: unknown[]
}
/** 子 agent 配置(subagent 委派能力检视) */
export interface SubagentInfo {
  enabled: boolean
  maxDepth: number
  maxParallel: number
  allowedTools: string[]
}
export interface AgentInfo {
  id: string
  model?: string
  tools: ToolInfo[]
  skills: SkillInfo[]
  windowProps: WindowPropInfo[]
  memory: string
  middleware: string[]
  todos: { content: string; status: string }[]
  subagent: SubagentInfo
  /** verify 自检装载状态(默认未装载 → undefined) */
  verify?: { enabled: boolean; maxAttempts: number }
}
