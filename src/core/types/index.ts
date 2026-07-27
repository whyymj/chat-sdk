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
  | { type: 'approval_request'; toolName: string; args: any; resolve: (approved: boolean | string) => void }
  | { type: 'done'; content: string }

/** 流式回调函数签名 */
export type StreamHandler = (event: StreamEvent) => void

/**
 * SDK 事件(供 createChatSdk({ onEvent }) 订阅常用时机)。
 * 复用 StreamEvent(round_start/reasoning/text/tool_call/tool_result/subagent/done;approval_request 不外发,UI 已处理)
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
  | { type: 'conflict'; conflict: import('../sdk/createChatSdk').PendingConflict }
  | { type: 'session_restored'; sessionId: string; rounds: number }
  | { type: 'usage'; round: number; usage: TokenUsage; cumulative: TokenUsage }
  | { type: 'error'; message: string }

/** token 用量(OpenAI 协议字段名) */
export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

/** SDK 事件回调签名 */
export type SdkEventHandler = (event: SdkEvent) => void

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
export interface ToolInfo { name: string; description: string; schema?: unknown; /** 来源:builtin / mcp:<name> / user */ source?: string }
export interface SkillInfo { name: string; description: string }
export interface DataInfo { description?: string; schema?: unknown }

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
  /** 当前生效的 systemPrompt(默认或用户传入;含中间件 augmentPrompt 段则仅为 base 段,便于调试/验证默认提示词) */
  systemPrompt: string
  tools: ToolInfo[]
  skills: SkillInfo[]
  data?: DataInfo
  memory: string
  middleware: string[]
  todos: { content: string; status: string }[]
  subagent: SubagentInfo
  /** verify 自检装载状态(默认未装载 → undefined) */
  verify?: { enabled: boolean; maxAttempts: number; adversarial: boolean }
  /** 已连 MCP server 列表(无 MCP → undefined) */
  mcp?: { servers: { name: string; url: string; toolCount: number }[] }
  /** 最近一次跨轮压缩统计(未触发过 → undefined;供 DebugDrawer 可观测) */
  lastCompression?: {
    triggered: boolean
    roundsTotal: number
    roundsSummarized: number
    roundsRecalled: number
    originalMessages: number
    compressedMessages: number
    strategy: string
  }
  /** 会话级 checkpoint 装载状态(未开启 → undefined) */
  checkpoints?: {
    enabled: boolean
    auto: boolean
    list: { id: number; label?: string; timestamp: number; messageCount: number }[]
  }
}
