/**
 * 中间件契约 —— 对齐 Deep Agents 的 agent middleware
 *
 * 生命周期(createAgent 内执行顺序):
 *   beforeAgent(正序) → 循环{ beforeModel(正序) → wrapModelCall(洋葱) → afterModel(逆序)
 *     → (有 tool_calls) wrapToolCall(洋葱) } → afterAgent(逆序)
 *
 * before 类正序,after 类逆序,wrap 类洋葱(reduceRight 包裹)。
 * 中间件可贡献工具、维护 state 字段、增强 system prompt、包裹模型/工具调用。
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { HarnessState } from './state'
import type { AgentMessage, StreamEvent } from '../types'

/** 模型调用请求 */
export interface ModelRequest {
  messages: BaseMessage[]
  state: HarnessState
}

/** 模型调用响应 */
export interface ModelResponse {
  message: BaseMessage
  toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>
  content: string
  /** 模型流被 abort(用户停止):true 时 content 为已累积的 partial,应保留并结束本轮(不再执行工具) */
  aborted?: boolean
}

/** 中间件返回的 state 更新(last-writer 合并) */
export type StateUpdate = Partial<HarnessState>

/** 工具调用上下文 */
export interface ToolCallContext {
  id: string
  name: string
  args: Record<string, unknown>
  state: HarnessState
  /** 当前 agent 循环的 abort signal(中间件可据此感知用户停止,如 subagent 透传给子 agent) */
  signal?: AbortSignal
  /** 主循环事件转发(供 spawn 工具把子 agent 进度冒泡到 UI;不进入主 LLM 上下文) */
  emit?: (event: StreamEvent) => void
  /** 日志下沉(供 spawn 工具把子 agent 的 debugLog 转发到主;子日志带 source 标签) */
  logSink?: (entry: any) => void
}

/** 工具执行结果 */
export interface ToolExecResult {
  content: string
  status: 'done' | 'error'
}

export interface Middleware {
  name: string
  /** 该中间件贡献的工具,合并进工具集 */
  tools?: StructuredToolInterface[]
  /** 追加到 system prompt 的段(每轮模型调用前由 createAgent 收集渲染) */
  augmentPrompt?: (state: HarnessState) => string | undefined
  /** 构建上下文前压缩历史消息(summarization 中间件用,链式) */
  compressInput?: (
    messages: AgentMessage[],
  ) => Promise<{ messages: AgentMessage[]; stats?: unknown }> | AgentMessage[]
  /** agent 启动时(正序) */
  beforeAgent?: (state: HarnessState) => StateUpdate | void | Promise<StateUpdate | void>
  /** 每次模型调用前(正序),可更新 state(随后重渲染 system) */
  beforeModel?: (req: ModelRequest) => StateUpdate | void
  /** 包裹模型调用(洋葱,可改 messages / 拦截) */
  wrapModelCall?: (req: ModelRequest, next: (req: ModelRequest) => Promise<ModelResponse>) => Promise<ModelResponse>
  /** 模型返回后(逆序) */
  afterModel?: (res: ModelResponse, state: HarnessState) => StateUpdate | void
  /** 包裹工具执行(洋葱) */
  wrapToolCall?: (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => Promise<ToolExecResult>
  /** agent 结束时(逆序) */
  afterAgent?: (state: HarnessState) => StateUpdate | void | Promise<StateUpdate | void>
}

/** 合并 state 更新 */
export function applyUpdate(state: HarnessState, update: StateUpdate | void): HarnessState {
  if (!update) return state
  return { ...state, ...update }
}

/** beforeAgent:正序执行,逐步合并更新 */
export async function runBeforeAgent(middlewares: Middleware[], state: HarnessState): Promise<HarnessState> {
  let s = state
  for (const m of middlewares) {
    if (m.beforeAgent) s = applyUpdate(s, await m.beforeAgent(s))
  }
  return s
}

/** beforeModel:正序执行,逐步合并更新 */
export function runBeforeModel(middlewares: Middleware[], req: ModelRequest): HarnessState {
  let s = req.state
  for (const m of middlewares) {
    if (m.beforeModel) s = applyUpdate(s, m.beforeModel({ messages: req.messages, state: s }))
  }
  return s
}

/** afterModel:逆序执行 */
export function runAfterModel(middlewares: Middleware[], res: ModelResponse, state: HarnessState): HarnessState {
  let s = state
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const m = middlewares[i]
    if (m.afterModel) s = applyUpdate(s, m.afterModel(res, s))
  }
  return s
}

/** afterAgent:逆序执行 */
export async function runAfterAgent(middlewares: Middleware[], state: HarnessState): Promise<HarnessState> {
  let s = state
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const m = middlewares[i]
    if (m.afterAgent) s = applyUpdate(s, await m.afterAgent(s))
  }
  return s
}

/** wrapModelCall 洋葱包裹(reduceRight,最内层是 core) */
export function composeModelCall(
  middlewares: Middleware[],
  core: (req: ModelRequest) => Promise<ModelResponse>
): (req: ModelRequest) => Promise<ModelResponse> {
  return middlewares.reduceRight<(req: ModelRequest) => Promise<ModelResponse>>(
    (next, m) => (req) => (m.wrapModelCall ? m.wrapModelCall(req, next) : next(req)),
    core,
  )
}

/** wrapToolCall 洋葱包裹 */
export function composeToolCall(
  middlewares: Middleware[],
  core: (ctx: ToolCallContext) => Promise<ToolExecResult>,
): (ctx: ToolCallContext) => Promise<ToolExecResult> {
  return middlewares.reduceRight<(ctx: ToolCallContext) => Promise<ToolExecResult>>(
    (next, m) => (ctx) => (m.wrapToolCall ? m.wrapToolCall(ctx, next) : next(ctx)),
    core,
  )
}
