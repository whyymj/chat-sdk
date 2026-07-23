/**
 * Harness 核心 —— 可插拔中间件的 ReAct 循环
 *
 * 对齐 Deep Agents 的 createAgent:不绑定具体工具/能力,工具与能力以"中间件"注入。
 *
 * 流程:
 *   beforeAgent → while(rounds < max){ beforeModel → wrapModelCall → afterModel
 *     → (有 tool_calls) wrapToolCall(逐个) } → afterAgent
 */
import { shallowRef, triggerRef } from 'vue'
import { ChatOpenAI } from '@langchain/openai'
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentMessage, StreamHandler } from '../types'
import { offloadLargeResult } from '../utils/offload'
import { createInitialState, type HarnessState } from './state'
import {
  type Middleware,
  type ModelRequest,
  type ModelResponse,
  type ToolCallContext,
  runBeforeAgent,
  runBeforeModel,
  runAfterModel,
  runAfterAgent,
  composeModelCall,
  composeToolCall,
} from './middleware'

export interface DebugLog {
  timestamp: number
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware'
  data: any
}

export interface CreateAgentOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  /** 用户自定义工具(与中间件贡献的工具合并) */
  tools?: StructuredToolInterface[]
  /** 中间件栈(顺序:内置在前,用户在后) */
  middleware?: Middleware[]
  maxToolRounds?: number
  debug?: boolean
}

const DEFAULT_MAX_TOOL_ROUNDS = 10

export function createAgent(options: CreateAgentOptions) {
  const {
    apiKey,
    baseUrl,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 8192,
    systemPrompt,
    tools: extraTools = [],
    middleware: middlewares = [],
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    debug = false,
  } = options

  // shallowRef:浅响应式,不深度代理 push 进来的 data 对象,避免与 currentMessages 共享引用污染日志快照
  const debugLogs = shallowRef<DebugLog[]>([])
  function log(type: DebugLog['type'], data: any) {
    // 始终记录到 debugLogs(供日志抽屉查看请求上下文历史);debug 时额外输出到 console
    debugLogs.value.push({ timestamp: Date.now(), type, data })
    triggerRef(debugLogs)
    if (debug) console.log(`%c[Agent] ${type}`, 'color:#667eea;font-weight:bold', data)
  }

  // 合并工具:中间件贡献的工具 + 用户工具
  const allTools: StructuredToolInterface[] = [
    ...middlewares.flatMap((m) => m.tools || []),
    ...extraTools,
  ]

  const llm = new ChatOpenAI({
    apiKey,
    model,
    temperature,
    maxTokens,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  })
  const llmWithTools = allTools.length > 0 ? llm.bindTools(allTools) : llm

  let state: HarnessState = createInitialState()

  /** 组装 system prompt:base + 各中间件 augmentPrompt 段 */
  function buildSystemPrompt(): string {
    const parts: string[] = [systemPrompt || '你是一个智能助手。']
    for (const m of middlewares) {
      if (m.augmentPrompt) {
        const seg = m.augmentPrompt(state)
        if (seg) parts.push(seg)
      }
    }
    return parts.join('\n\n')
  }

  /** AgentMessage[] → BaseMessage[](注入 system prompt) */
  function toLC(messages: AgentMessage[]): BaseMessage[] {
    const lc: BaseMessage[] = [new SystemMessage(buildSystemPrompt())]
    for (const msg of messages) {
      if (msg.role === 'user') lc.push(new HumanMessage(msg.content))
      else if (msg.role === 'assistant') lc.push(new AIMessage(msg.content))
      else if (msg.role === 'system') lc.push(new SystemMessage(msg.content))
    }
    return lc
  }

  /** 重新渲染消息列表首部的 system 段(state 变化后) */
  function replaceSystem(messages: BaseMessage[]): BaseMessage[] {
    const rest = messages.filter((m) => typeOf(m) !== 'system')
    return [new SystemMessage(buildSystemPrompt()), ...rest]
  }

  /** 核心模型调用(stream,洋葱最内层):聚合 chunk、emit text/reasoning */
  async function coreModelCall(req: ModelRequest, onEvent?: StreamHandler): Promise<ModelResponse> {
    const stream = await llmWithTools.stream(req.messages)
    let aggregated: AIMessageChunk | null = null
    let content = ''
    for await (const chunk of stream) {
      aggregated = aggregated ? aggregated.concat(chunk) : chunk
      const textDelta = typeof chunk.content === 'string' ? chunk.content : ''
      if (textDelta && onEvent) {
        content += textDelta
        onEvent({ type: 'text', delta: textDelta })
      }
      const ak: any = (chunk as any).additional_kwargs || {}
      const rDelta = ak.reasoning_content || ak.reasoning || ''
      if (rDelta && onEvent) onEvent({ type: 'reasoning', delta: rDelta })
    }
    const message = aggregated as unknown as BaseMessage
    const toolCalls = ((message as any).tool_calls || []) as ModelResponse['toolCalls']
    return { message, toolCalls, content }
  }

  /** 核心工具执行(洋葱最内层):find + invoke */
  async function coreExecTool(ctx: ToolCallContext): Promise<{ content: string; status: 'done' | 'error' }> {
    const target = allTools.find((t) => t.name === ctx.name)
    if (!target) return { content: `工具 "${ctx.name}" 不存在`, status: 'error' }
    try {
      const result = await (target.invoke as any)(ctx.args)
      let content = typeof result === 'string' ? result : JSON.stringify(result)
      // 大结果外存:经 ctx.state.files(vfs 中间件注入的共享引用),超阈值转存 vfs 只留预览+引用
      content = offloadLargeResult(content, {
        files: ctx.state.files,
        vfsAvailable: allTools.some((t) => t.name === 'vfs_read'),
        toolName: ctx.name,
      })
      return { content, status: 'done' }
    } catch (err: any) {
      return { content: `工具执行出错：${err.message}`, status: 'error' }
    }
  }

  /** 消息类型字符串(避免使用已弃用的 _getType()) */
  function typeOf(m: BaseMessage): string {
    if (m instanceof HumanMessage) return 'human'
    if (m instanceof AIMessage) return 'ai'
    if (m instanceof SystemMessage) return 'system'
    if (m instanceof ToolMessage) return 'tool'
    return 'unknown'
  }

  /** 格式化消息为接近实际请求体的结构(role 用接口名 user/assistant/tool/system,含 tool_calls/tool_call_id),按发送顺序 */
  function formatForLog(messages: BaseMessage[]) {
    // map 返回独立对象;配合外层 shallowRef(不深度代理),快照天然独立,无需深拷贝
    return messages.map((m) => {
      const t = typeOf(m)
      const entry: Record<string, unknown> = {
        role: t === 'human' ? 'user' : t === 'ai' ? 'assistant' : t,
      }
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      if (content) entry.content = content
      const toolCalls = (m as any).tool_calls
      if (Array.isArray(toolCalls) && toolCalls.length) {
        entry.tool_calls = toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args) },
        }))
      }
      const toolCallId = (m as any).tool_call_id
      if (toolCallId) entry.tool_call_id = toolCallId
      return entry
    })
  }

  /**
   * 流式入口 —— ReAct 循环 + 中间件
   * 兼容现有 useChat 的 fetchStream 签名。
   */
  async function stream(messages: AgentMessage[], onEvent: StreamHandler): Promise<string> {
    debugLogs.value = []
    state = createInitialState()
    state.messages = messages

    // beforeAgent(正序):初始化中间件状态(todos/skills/memory 等)
    state = await runBeforeAgent(middlewares, state)

    // 输入压缩(summarization 中间件,链式:每个中间件依次压缩)
    let input = messages
    for (const m of middlewares) {
      if (m.compressInput) {
        const r = await m.compressInput(input)
        input = Array.isArray(r) ? r : r.messages
      }
    }

    let currentMessages = toLC(input)
    log('context', { model, tools: allTools.map((t) => t.name), middleware: middlewares.map((m) => m.name) })

    const modelHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent))
    const toolHandler = composeToolCall(middlewares, coreExecTool)

    let rounds = 0
    while (rounds < maxToolRounds) {
      onEvent({ type: 'round_start', round: rounds + 1 })

      // beforeModel(正序):中间件更新 state(todos 推进等),随后重渲染 system
      state = runBeforeModel(middlewares, { messages: currentMessages, state })
      currentMessages = replaceSystem(currentMessages)

      log('llm_request', {
        round: rounds + 1,
        model,
        tools: allTools.map((t) => t.name),
        messages: formatForLog(currentMessages),
      })

      const response = await modelHandler({ messages: currentMessages, state })
      currentMessages.push(response.message)

      log('llm_response', { round: rounds + 1, content: response.content, toolCalls: response.toolCalls })

      state = runAfterModel(middlewares, response, state)

      if (!response.toolCalls.length) {
        onEvent({ type: 'done', content: response.content })
        await runAfterAgent(middlewares, state)
        return response.content
      }

      // 执行工具(每个经 wrapToolCall 洋葱:permissions 校验 / 大结果外存等)
      for (const call of response.toolCalls) {
        const id = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        onEvent({ type: 'tool_call', name: call.name, args: call.args })
        log('tool_call', { name: call.name, args: call.args, id })
        const ctx: ToolCallContext = { id, name: call.name, args: call.args, state }
        const result = await toolHandler(ctx)
        currentMessages.push(new ToolMessage({ tool_call_id: id, content: result.content }))
        onEvent({ type: 'tool_result', name: call.name, result: result.content, status: result.status })
        log('tool_result', { name: call.name, result: result.content, status: result.status })
      }
      rounds++
    }

    const fallback = '已达到最大工具调用轮次，请简化你的问题。'
    onEvent({ type: 'done', content: fallback })
    await runAfterAgent(middlewares, state)
    return fallback
  }

  /** 非流式入口(复用 stream,聚合最终文本) */
  async function invoke(messages: AgentMessage[]): Promise<string> {
    let final = ''
    await stream(messages, (e) => {
      if (e.type === 'done') final = e.content
    })
    return final
  }

  return { invoke, stream, getState: () => state, allTools, debugLogs }
}
