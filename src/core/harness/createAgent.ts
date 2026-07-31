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
import { resolveModelCaps, offloadThresholdChars, offloadPassThroughChars } from '../utils/modelCaps'
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
}

/** 检测模型把工具调用写成文本(伪 XML/标签)而非走标准 tool_calls 通道的异常格式。导出供测试 */
export function detectGarbledToolCall(content: string): boolean {
  if (!content) return false
  // 仅匹配明确的"伪工具调用标签",避免误判正常文本
  return /<｜tool_calls｜>|<｜｜[^>]*tool_call|<invoke\s+name=|<\/?tool_call>|<function_call>/i.test(content)
}

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
  /** 集成方显式声明模型上下文窗口(token);缺省按 model 名查表,再缺省 32K。影响 offload 阈值与压缩触发 */
  contextWindow?: number
  /** 集成方显式声明模型最大输出(token);缺省按 model 名查表,再缺省 4K。maxTokens 未传时作其缺省 */
  maxOutputTokens?: number
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking)。仅 llm 未传实例(按配置构造 ChatOpenAI)时生效 */
  extraBody?: Record<string, any>
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并。仅按配置构造时生效 */
  extraConfig?: Record<string, any>
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
  /** LLM 运行时切换回调(setLlm 后触发,供 createChatSdk 重解析模型能力 contextWindow/maxOutputTokens) */
  onLlmChange?: (newLlm: BaseChatModel) => void
  debug?: boolean
}

const DEFAULT_MAX_TOOL_ROUNDS = 10
/** debugLogs 条目上限:超限丢最旧,防异常多轮/子 agent 大量转发日志撑爆内存(纯内存,每轮重置,此为单轮兜底) */
const MAX_DEBUG_LOGS = 300
/** 单条日志内 message content 截断阈值:llm_request 每轮记录完整 messages(O(N²) 增长),截断既保可读又控内存 */
const MAX_LOG_CONTENT_CHARS = 6000

/**
 * 逐轮上下文保底压缩(纯函数,可单测):循环内每轮 tool 结果累积,单条已由 offload 限制,多条累积仍可能超。
 * 当总字符超过放行上限(maxChars)时,从最早的 ToolMessage 起截断为占位摘要,
 * 保留 tool_call_id(结构完整,模型仍能对应),不动对话/system/ai 消息。大模型阈值高几乎不触发。
 */
export function trimContextIfNeededImpl(messages: BaseMessage[], maxChars: number): BaseMessage[] {
  const total = messages.reduce(
    (s, m) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
    0,
  )
  if (total <= maxChars) return messages
  let trimmed = 0
  const need = total - maxChars
  // 保留首段长度按放行上限自适应:大模型(20万)→400,小模型(6400)→100;clamp [100,400]
  const keep = Math.max(100, Math.min(400, Math.round(maxChars / 500)))
  return messages.map((m) => {
    if (trimmed >= need) return m
    if (!(m instanceof ToolMessage)) return m
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    if (c.length <= 400) return m // 太短不值得压
    const summary = `…[已自动压缩 ${c.length} 字符,保留首 ${keep}]\n` + c.slice(0, keep)
    trimmed += c.length - summary.length
    return new ToolMessage({ tool_call_id: (m as any).tool_call_id, content: summary })
  })
}

export function createAgent(options: CreateAgentOptions) {
  const {
    apiKey,
    baseUrl,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens, // 不设默认:缺省由模型能力(maxOutputTokens)推导,避免设错被截断
    extraBody,
    extraConfig,
    systemPrompt,
    tools: extraTools = [],
    middleware: middlewares = [],
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    maxRetries = 2,
    retryDelayMs = 500,
    maxParallelTools = 1,
    maxVerifyAttempts = 0,
    onLog,
    onLlmChange,
    debug = false,
  } = options

  // 模型能力:声明优先 > model 名查表 > 缺省。
  // maxTokens 缺省 = maxOutputTokens(DeepSeek 8192 等,避免固定 16384 被截断);
  // offload 外存阈值按上下文窗口自适应(1M→20000,32K→2000)
  const caps = resolveModelCaps({
    model,
    contextWindow: options.contextWindow,
    maxOutputTokens: options.maxOutputTokens,
  })
  const resolvedMaxTokens = maxTokens ?? caps.maxOutputTokens
  const offloadThreshold = offloadThresholdChars(caps.contextWindow)
  // vfs 不可用时的放行上限:大模型(1M)→ 200000 几乎不截断,小模型按上下文 20% 推导
  const offloadPassThrough = offloadPassThroughChars(caps.contextWindow)

  // shallowRef:浅响应式,不深度代理 push 进来的 data 对象,避免与 currentMessages 共享引用污染日志快照
  const debugLogs = shallowRef<DebugLog[]>([])
  function log(type: DebugLog['type'], data: any) {
    // 始终记录到 debugLogs(供日志抽屉查看请求上下文历史);debug 时额外输出到 console
    const entry: DebugLog = { timestamp: Date.now(), type, data }
    debugLogs.value.push(entry)
    // 条目上限兜底:超限丢最旧(单轮内异常多 tool/子 agent 转发时防失控)
    if (debugLogs.value.length > MAX_DEBUG_LOGS) debugLogs.value.splice(0, debugLogs.value.length - MAX_DEBUG_LOGS)
    triggerRef(debugLogs)
    onLog?.(entry) // 日志下沉(子 agent 经 ctx.logSink → onLog 转发到主)
    if (debug) console.log(`%c[Agent] ${type}`, 'color:#667eea;font-weight:bold', data)
  }
  /** push 一条外部 debugLog 到主日志(供子 agent 经 ctx.logSink 转发) */
  const pushLog = (entry: DebugLog) => {
    debugLogs.value.push(entry)
    if (debugLogs.value.length > MAX_DEBUG_LOGS) debugLogs.value.splice(0, debugLogs.value.length - MAX_DEBUG_LOGS)
    triggerRef(debugLogs)
  }

  // 合并工具:中间件贡献的工具 + 用户工具
  // let + rebindTools:支持运行时 setTools 动态增删用户工具(类比 setData/setSkills)
  let allTools: StructuredToolInterface[] = [
    ...middlewares.flatMap((m) => m.tools || []),
    ...extraTools,
  ]

  // provider 抽离:优先用预构造实例(任意 provider);否则按 apiKey/model 配置构造 ChatOpenAI(向后兼容)
  // let:支持运行时 setLlm 切换模型(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)
  let llm = options.llm ?? new ChatOpenAI({
    apiKey,
    model,
    temperature,
    maxTokens: resolvedMaxTokens,
    configuration: { ...(baseUrl ? { baseURL: baseUrl } : {}), ...extraConfig },
    ...(extraBody ? { modelKwargs: extraBody } : {}),
  })
  let llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm

  /** 重新绑定工具到当前 llm(setTools/setLlm 后调用;bindTools 缺失时退回裸 llm) */
  function rebindTools(): void {
    llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm
  }

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
  async function coreModelCall(req: ModelRequest, onEvent?: StreamHandler, signal?: AbortSignal, caller?: BaseChatModel): Promise<ModelResponse> {
    // caller 默认 llmWithTools(绑工具);收口综合传裸 llm,避免模型再触发工具调用
    const streamer = caller ?? llmWithTools
    const run = async (): Promise<ModelResponse> => {
      let aggregated: AIMessageChunk | null = null
      let content = ''
      try {
        // stream 启动 + 迭代都纳入 try:启动阶段被 abort 也走 aborted 分支(不冒泡、不重试)
        const stream = await streamer.stream(req.messages, signal ? { signal } : undefined)
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
        threshold: offloadThreshold,
        passThroughChars: offloadPassThrough,
      }).content
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

  /**
   * 逐轮上下文保底压缩(模块级纯函数 trimContextIfNeeded 的薄封装,复用其 typeOf)
   */
  function trimContextIfNeeded(messages: BaseMessage[], maxChars: number): BaseMessage[] {
    return trimContextIfNeededImpl(messages, maxChars)
  }

  /** 格式化消息为接近实际请求体的结构(role 用接口名 user/assistant/tool/system,含 tool_calls/tool_call_id),按发送顺序 */
  function formatForLog(messages: BaseMessage[]) {
    // map 返回独立对象;配合外层 shallowRef(不深度代理),快照天然独立,无需深拷贝
    return messages.map((m) => {
      const t = typeOf(m)
      const entry: Record<string, unknown> = {
        role: t === 'human' ? 'user' : t === 'ai' ? 'assistant' : t,
      }
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      // 截断超长 content:llm_request 每轮记录完整 messages(O(N²) 增长),大 JSON 场景单轮可数 MB;截断保可读控内存
      if (raw) entry.content = raw.length > MAX_LOG_CONTENT_CHARS ? raw.slice(0, MAX_LOG_CONTENT_CHARS) + `…(截断 ${raw.length - MAX_LOG_CONTENT_CHARS} 字符)` : raw
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
        // 捕获最近一次压缩统计写入 state,供 DebugDrawer 可观测
        if (r && !Array.isArray(r) && r.stats) {
          state = { ...state, lastCompression: r.stats as any }
        }
      }
    }

    let currentMessages = toLC(input)
    log('context', { model, tools: allTools.map((t) => t.name), middleware: middlewares.map((m) => m.name) })

    const modelHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal))
    const toolHandler = composeToolCall(middlewares, coreExecTool)

    let rounds = 0
    let lastFinalContent: string | null = null // 自纠路径缓存:verify 拒掉的最终答,供 rounds 耗尽兜底优先返回
    let formatRetries = 0 // 格式异常自纠计数:模型把工具调用写成文本(伪 XML/标签)时回灌反馈重生成,限次防死循环
    const maxFormatRetries = 2
    try {
      while (rounds < maxToolRounds) {
        // 每轮开始检查 abort(用户停止)
        if (signal?.aborted) break
        onEvent({ type: 'round_start', round: rounds + 1 })

        // beforeModel(正序):中间件更新 state(todos 推进等),随后重渲染 system
        state = runBeforeModel(middlewares, { messages: currentMessages, state })
        currentMessages = replaceSystem(currentMessages)
        // 逐轮上下文保底压缩:tool 结果累积超放行上限时,从最早的 ToolMessage 起截断为占位摘要(大模型阈值高几乎不触发)
        currentMessages = trimContextIfNeeded(currentMessages, offloadPassThrough)

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
          return response.content
        }

        if (!response.toolCalls.length) {
          // 格式异常自纠:模型把工具调用写成文本(DeepSeek <｜tool_calls｜> / 伪 XML <invoke> 等)而非标准 tool_calls,
          // 系统未识别 → 未执行。回灌 feedback 让模型用标准 function calling 重新发起,限次防死循环
          if (formatRetries < maxFormatRetries && detectGarbledToolCall(response.content)) {
            formatRetries += 1
            log('middleware', { stage: 'format_retry', attempt: formatRetries, content: response.content.slice(0, 200) })
            currentMessages.push(new HumanMessage('⚠️ 你刚才把工具调用写成了文本(伪 XML/标签,如 <｜tool_calls｜>、<invoke name=...>),未被系统识别为工具调用,因此未执行,页面无变化。请直接用标准 function calling(工具调用)格式重新发起工具调用,不要在回复正文里输出这些标签或 JSON 文本。'))
            rounds += 1
            continue
          }
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
        return ''
      }
      // 自纠耗尽 rounds 预算 → 优先返回最近一次缓存的有效最终答
      if (lastFinalContent != null) {
        onEvent({ type: 'done', content: lastFinalContent })
        return lastFinalContent
      }
      // 工具轮耗尽且未综合:末尾是 ToolMessage → 强制收口综合(裸 llm 不绑工具,注入「工具已用尽,直接作答」提示),
      // 保证最终一定有综合输出,而非白费全部工具产出后丢一句「请简化问题」
      const last = currentMessages[currentMessages.length - 1]
      if (last && typeOf(last) === 'tool') {
        // 提示并入首部 system(单条 system 在首,避免尾部 system 消息被部分 API 拒收)
        const rest = currentMessages.filter((m) => typeOf(m) !== 'system')
        const wrapUpMessages = [
          new SystemMessage(
            buildSystemPrompt() + '\n\n工具调用次数已达上限,请基于已有工具结果直接给出最终回答,不要再调用工具。',
          ),
          ...rest,
        ]
        log('llm_request', { round: 'wrap_up', model, tools: [], messages: formatForLog(wrapUpMessages) })
        const resp = await coreModelCall({ messages: wrapUpMessages, state }, onEvent, signal, llm)
        log('llm_response', { round: 'wrap_up', content: resp.content })
        if (resp.aborted) {
          onEvent({ type: 'done', content: resp.content })
          return resp.content
        }
        if (resp.content) {
          onEvent({ type: 'done', content: resp.content })
          return resp.content
        }
      }
      // 收口也无文本(极端)→ 兜底文案
      const fallback = '已达到最大工具调用轮次，请简化你的问题。'
      onEvent({ type: 'done', content: fallback })
      return fallback
    } finally {
      // afterAgent 必跑(含异常路径):中间件清理/flush 不因模型或中间件抛错被跳过;其自身错误吞掉不影响主流程
      try {
        await runAfterAgent(middlewares, state)
      } catch (e) {
        console.warn('[Agent] afterAgent 清理出错(已忽略):', e)
      }
    }
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

  /**
   * 运行时替换用户工具集(内置工具由中间件贡献,不动)。
   * 重算 allTools = [中间件贡献工具 + userTools] + rebindTools();下一轮 LLM 调用即用新工具集。
   * 不调用 = 现状行为(创建时 tools 固定)。
   */
  function setTools(userTools: StructuredToolInterface[]): void {
    allTools = [...middlewares.flatMap((m) => m.tools || []), ...userTools]
    rebindTools()
  }

  /**
   * 运行时切换 LLM 实例(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)。
   * 替换 llm + rebindTools + onLlmChange 回调(供 createChatSdk 重解析模型能力 contextWindow/maxOutputTokens)。
   * 新模型若不支持 tool calling(bindTools 缺失),rebindTools 退回裸 llm —— 工具调用会失效但 agent 不崩。
   */
  function setLlm(newLlm: BaseChatModel): void {
    llm = newLlm
    rebindTools()
    onLlmChange?.(newLlm)
  }

  return {
    invoke,
    stream,
    getState: () => state,
    // getter:setTools/setLlm 后 allTools 重赋值,getter 始终取最新(inspect().tools 动态反映)
    get allTools() { return allTools },
    setTools,
    setLlm,
    debugLogs,
    // 复用内部权威拼装(base + Σ augmentPrompt),供 getInfo/inspect 收敛为单一真相源(fix-introspection-consistency)
    getEffectiveSystemPrompt: () => buildSystemPrompt(),
  }
}
