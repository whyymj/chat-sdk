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
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentMessage, StreamHandler } from '../types'
import { offloadLargeResult } from '../utils/offload'
import { runPool } from '../utils/pool'
import { createInitialState, type HarnessState } from './state'
import { withRetry, isAbort } from './retry'
import {
  type Middleware,
  type ModelRequest,
  type ModelResponse,
  type ToolCallContext,
  runBeforeAgent,
  runBeforeModel,
  runAfterModel,
  runAfterAgent,
  runBeforeReturn,
  composeModelCall,
  composeToolCall,
} from './middleware'

export interface DebugLog {
  timestamp: number
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware'
  data: any
  /** 日志来源(主 agent 省;子 agent 转发时为 '子:label',便于区分) */
  source?: string
}

export interface CreateAgentOptions {
  /** 预构造的 LLM 实例(任意 provider,provider 抽离);提供则优先于 apiKey/model 配置 */
  llm?: BaseChatModel
  apiKey?: string
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
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
  /** 重试退避基数 ms(默认 500,第 n 次重试等待 = base*2^n + jitter) */
  retryDelayMs?: number
  /** 同轮多个工具调用的并发上限(默认 1 = 串行,保持现有工具语义);>1 时并发执行 */
  maxParallelTools?: number
  /** beforeReturn 自纠上限(默认 0 = 关闭,纯放行);>0 时 agent 返回前跑 beforeReturn 钩子,有 feedback 则回灌 user 消息继续循环,达上限强制 return 防死循环 */
  maxVerifyAttempts?: number
  /** 日志下沉:每条 debugLog 产生时回调(子 agent 经此把日志转发到主 debugLogs) */
  onLog?: (entry: DebugLog) => void
  debug?: boolean
}

const DEFAULT_MAX_TOOL_ROUNDS = 10

export function createAgent(options: CreateAgentOptions) {
  const {
    apiKey,
    baseUrl,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 16384, // 大 JSON 写入场景默认提高;.env VITE_AI_MAX_TOKENS / llm.maxTokens 仍可覆盖
    systemPrompt,
    tools: extraTools = [],
    middleware: middlewares = [],
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    maxRetries = 2,
    retryDelayMs = 500,
    maxParallelTools = 1,
    maxVerifyAttempts = 0,
    onLog,
    debug = false,
  } = options

  // shallowRef:浅响应式,不深度代理 push 进来的 data 对象,避免与 currentMessages 共享引用污染日志快照
  const debugLogs = shallowRef<DebugLog[]>([])
  function log(type: DebugLog['type'], data: any) {
    // 始终记录到 debugLogs(供日志抽屉查看请求上下文历史);debug 时额外输出到 console
    const entry: DebugLog = { timestamp: Date.now(), type, data }
    debugLogs.value.push(entry)
    triggerRef(debugLogs)
    onLog?.(entry) // 日志下沉(子 agent 经 ctx.logSink → onLog 转发到主)
    if (debug) console.log(`%c[Agent] ${type}`, 'color:#667eea;font-weight:bold', data)
  }
  /** push 一条外部 debugLog 到主日志(供子 agent 经 ctx.logSink 转发) */
  const pushLog = (entry: DebugLog) => { debugLogs.value.push(entry); triggerRef(debugLogs) }

  // 合并工具:中间件贡献的工具 + 用户工具
  const allTools: StructuredToolInterface[] = [
    ...middlewares.flatMap((m) => m.tools || []),
    ...extraTools,
  ]

  // provider 抽离:优先用预构造实例(任意 provider);否则按 apiKey/model 配置构造 ChatOpenAI(向后兼容)
  const llm = options.llm ?? new ChatOpenAI({
    apiKey,
    model,
    temperature,
    maxTokens,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  })
  const llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm

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

  /**
   * 核心模型调用(stream,洋葱最内层):聚合 chunk、emit text/reasoning
   * - 可恢复错误(网络/429/5xx)经 withRetry 自动重试;abort 不重试
   * - abort 时不抛,返回 { aborted:true, content: 已累积 partial }(保留已生成内容,等同 ChatGPT 停止)
   */
  async function coreModelCall(req: ModelRequest, onEvent?: StreamHandler, signal?: AbortSignal): Promise<ModelResponse> {
    const run = async (): Promise<ModelResponse> => {
      let aggregated: AIMessageChunk | null = null
      let content = ''
      try {
        // stream 启动 + 迭代都纳入 try:启动阶段被 abort 也走 aborted 分支(不冒泡、不重试)
        const stream = await llmWithTools.stream(req.messages, signal ? { signal } : undefined)
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
      } catch (err) {
        // abort:不抛,把已累积的 partial 带出来(不丢失已生成内容)
        if (isAbort(err, signal)) {
          const message = (aggregated as unknown as BaseMessage) ?? new AIMessage(content)
          return { message, toolCalls: [], content, aborted: true }
        }
        throw err
      }
      const message = aggregated as unknown as BaseMessage
      const toolCalls = ((message as any).tool_calls || []) as ModelResponse['toolCalls']
      return { message, toolCalls, content }
    }
    return withRetry(run, {
      signal,
      maxRetries,
      baseDelayMs: retryDelayMs,
      onRetry: ({ attempt, error, waitMs }) => {
        const reason = (error as any)?.message ?? String(error)
        log('error', { stage: 'model_retry', attempt, waitMs, error: reason })
        console.warn(`[Agent] 模型调用失败,第 ${attempt}/${maxRetries} 次重试(等 ${waitMs}ms):${reason}`)
      },
    })
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
  async function stream(messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal): Promise<string> {
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

    const modelHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal))
    const toolHandler = composeToolCall(middlewares, coreExecTool)

    let rounds = 0
    let lastFinalContent: string | null = null // 自纠路径缓存:verify 拒掉的最终答,供 rounds 耗尽兜底优先返回
    while (rounds < maxToolRounds) {
      // 每轮开始检查 abort(用户停止)
      if (signal?.aborted) break
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

      // 模型被 abort(用户停止):保留已累积 partial,正常结束(不执行后续工具)
      if (response.aborted) {
        onEvent({ type: 'done', content: response.content })
        await runAfterAgent(middlewares, state)
        return response.content
      }

      if (!response.toolCalls.length) {
        // beforeReturn 钩子(正序):agent 返回前可拦截自纠(回灌 user 消息继续循环)。
        // 预算检查前置(verifyAttempts < maxVerifyAttempts):避免预算耗尽仍跑钩子(尤其 adversarial 子 agent 烧 token),框架级防御不靠中间件自觉
        if (maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts) {
          const feedback = await runBeforeReturn(middlewares, { messages: currentMessages, state, response, log: (t, d) => log(t as DebugLog['type'], d) })
          if (feedback) {
            lastFinalContent = response.content // 缓存最终答:自纠若耗尽 rounds 预算,兜底优先返回它(而非误导性"请简化问题")
            state.verifyAttempts += 1
            currentMessages.push(new HumanMessage(`⚠️ 验证未通过,请修正:${feedback}`))
            log('middleware', { stage: 'verify_retry', attempt: state.verifyAttempts, feedback })
            rounds += 1
            continue // 回灌反馈,继续循环让模型修正(不 return)
          }
        }
        onEvent({ type: 'done', content: response.content })
        await runAfterAgent(middlewares, state)
        return response.content
      }

      // 执行工具(经 wrapToolCall 洋葱;按 maxParallelTools 并发,默认 1 串行保持原语义)
      const calls = response.toolCalls
      const ctxs = calls.map((call) => {
        const id = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        return { id, call, ctx: { id, name: call.name, args: call.args, state, signal, emit: onEvent, logSink: pushLog } as ToolCallContext }
      })
      // 并发池执行(emit tool_call/result 在 fn 内,串行时保持交替 UX;结果按原顺序收集)
      const results = await runPool(
        ctxs,
        maxParallelTools,
        async (c) => {
          if (signal?.aborted) return undefined // 双保险:abort 不启动新工具
          onEvent({ type: 'tool_call', name: c.call.name, args: c.call.args })
          log('tool_call', { round: rounds + 1, name: c.call.name, args: c.call.args, id: c.id })
          const result = await toolHandler(c.ctx)
          onEvent({ type: 'tool_result', name: c.call.name, result: result.content, status: result.status })
          log('tool_result', { round: rounds + 1, name: c.call.name, result: result.content, status: result.status })
          return result
        },
        signal,
      )
      // 按原 tool_calls 顺序回填 ToolMessage(跳过 abort 未执行的)
      for (let i = 0; i < ctxs.length; i++) {
        const r = results[i]
        if (!r) continue
        currentMessages.push(new ToolMessage({ tool_call_id: ctxs[i].id, content: r.content }))
      }
      if (signal?.aborted) break // 中止则不进入下一轮
      rounds++
    }

    // 循环退出:abort(用户停止)或达到最大轮次
    if (signal?.aborted) {
      onEvent({ type: 'done', content: '' })
      await runAfterAgent(middlewares, state)
      return ''
    }
    // 自纠耗尽 rounds 预算 → 优先返回最近一次缓存的有效最终答(而非误导性"请简化问题");纯工具循环耗尽(无缓存)才用兜底文案
    const fallback = lastFinalContent ?? '已达到最大工具调用轮次，请简化你的问题。'
    onEvent({ type: 'done', content: fallback })
    await runAfterAgent(middlewares, state)
    return fallback
  }

  /** 非流式入口(复用 stream,聚合最终文本;透传 signal 支持停止) */
  async function invoke(messages: AgentMessage[], signal?: AbortSignal): Promise<string> {
    let final = ''
    await stream(
      messages,
      (e) => {
        if (e.type === 'done') final = e.content
      },
      signal,
    )
    return final
  }

  return { invoke, stream, getState: () => state, allTools, debugLogs }
}
