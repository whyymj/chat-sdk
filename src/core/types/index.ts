/** 工具调用步骤（用于在消息内展示思考过程） */
export interface ToolStep {
  name: string
  args?: any
  result?: string
  status: 'running' | 'done' | 'error'
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
  | { type: 'done'; content: string }

/** 流式回调函数签名 */
export type StreamHandler = (event: StreamEvent) => void

export interface ChatDialogProps {
  /** 非流式 AI 请求函数（与 fetchStream 二选一） */
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>
  /** 流式 AI 请求函数，传入则优先使用流式输出 */
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  /** 对话框标题 */
  title?: string
  /** 占位文本 */
  placeholder?: string
  /** 调试日志（响应式数组），传入则显示调试按钮 */
  debugLogs?: any[]
}
