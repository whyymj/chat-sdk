/**
 * 子 agent 中间件 —— spawn_agent / spawn_agents
 *
 * 主 agent 委派独立子 agent 跑子任务,只把最终结论返回主上下文(过程隔离,省主 token)。
 * 对齐 Claude Code 的 Agent 工具。复用 createAgent 工厂构造子 agent(独立 state/messages)。
 *
 * 通信(见 evolution-roadmap.md #1):单向委派 —— 主→子=工具参数,子→主=工具返回(最终结论);
 * signal 继承(主停则子停);多子并行不互通,主聚合。
 *
 * 进度展示:子的工具调用进度经主 onEvent 转发(subagent 事件)→ UI 在 spawn 步骤下嵌套展示;
 * **不进入主 LLM 上下文**(只进 UI,严守隔离)。文本/思考不转发(避免噪音)。
 *
 * 递归防护:maxDepth(默认 1)。depth+1 >= maxDepth 时子 agent 不装本中间件 → 无 spawn 工具 →
 * 物理切断(比运行时检查更可靠)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createAgent } from './createAgent'
import type { Middleware } from './middleware'
import { runPool } from '../utils/pool'
import type { StreamEvent } from '../types'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

/** 子 agent 的工具调用进度(只转发 tool_call/tool_result,不含文本/思考) */
type SubProgress = Extract<StreamEvent, { type: 'tool_call' | 'tool_result' }>

export interface SubagentLlmConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface SubagentOptions {
  /** 主 agent 的 LLM(配置对象或预构造实例,子 agent 复用) */
  llm: SubagentLlmConfig | BaseChatModel
  /** 主 agent 全部工具(子 agent 按白名单筛选只读子集) */
  allTools: StructuredToolInterface[]
  /** 子 agent 额外可用的工具名(默认仅只读 window + fetch) */
  allowedTools?: string[]
  /** 最大递归深度(默认 1:主可 spawn,子不可再 spawn) */
  maxDepth?: number
  /** spawn_agents 并发上限(默认 4) */
  maxParallel?: number
  /** 子 agent 最大工具轮次(默认 6) */
  maxToolRounds?: number
  /** 当前递归深度(内部用;主=0) */
  depth?: number
  debug?: boolean
}

/** 判定 llm 是模型实例(BaseChatModel)还是配置对象(SubagentLlmConfig) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 子 agent 默认可用的只读工具(不含写工具 —— 子 agent 只读探查,写回交主 agent) */
const DEFAULT_READONLY_TOOLS = [
  'get_window_prop',
  'get_window_paths',
  'list_window_props',
  'describe_window_prop',
  'fetch_document',
]
const DEFAULT_MAX_DEPTH = 1
const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_CHILD_ROUNDS = 6
const SPAWN_TOOL_NAMES = ['spawn_agent', 'spawn_agents']

/**
 * 构造并跑一个子 agent,返回最终文本结论。
 * 过程隔离:独立 state/messages;signal 继承(主停则子停);
 * 工具调用进度经 forward 转发到主 UI(不进入主 LLM 上下文)。
 */
async function runSubagent(
  task: { prompt: string; role?: string; model?: string },
  opts: SubagentOptions,
  signal?: AbortSignal,
  forward?: (e: SubProgress) => void,
  onLog?: (entry: any) => void,
): Promise<string> {
  const depth = opts.depth ?? 0
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  // 子 agent 工具子集:只读白名单 + 用户 allowedTools;排除 spawn(防递归)
  const allow = new Set([...DEFAULT_READONLY_TOOLS, ...(opts.allowedTools ?? [])])
  const childTools = opts.allTools.filter((t) => allow.has(t.name) && !SPAWN_TOOL_NAMES.includes(t.name))
  // 递归物理切断:depth+1 >= maxDepth 时子 agent 不装本中间件 → 无 spawn 工具
  const childMiddleware = depth + 1 < maxDepth ? [createSubagentMiddleware({ ...opts, depth: depth + 1 })] : []
  const child = createAgent({
    // provider 抽离:llm 实例则注入,否则按配置构造
    ...(isChatModel(opts.llm)
      ? { llm: opts.llm }
      : {
          apiKey: opts.llm.apiKey,
          baseUrl: opts.llm.baseUrl,
          model: task.model ?? opts.llm.model,
          temperature: opts.llm.temperature,
          maxTokens: opts.llm.maxTokens,
        }),
    systemPrompt: task.role?.trim() || '你是一个专注的子任务执行者。你只有只读工具(读 window / 抓文档),用它们完成给定任务,给出简洁结论,不要展开多余解释。',
    tools: childTools,
    middleware: childMiddleware,
    maxToolRounds: opts.maxToolRounds ?? DEFAULT_CHILD_ROUNDS,
    onLog, // 子 agent 日志下沉 → spawn 工具转发到主 debugLogs(带 source 标签)
    debug: opts.debug,
  })
  if (opts.debug) console.log(`[subagent] 启动子 agent(depth=${depth},工具 ${childTools.length} 个)`)
  return child.stream([{ role: 'user', content: task.prompt, timestamp: Date.now() }], (e) => {
    // 只转发工具调用进度到主 UI(文本/思考不转发:避免噪音 + 严守主上下文隔离)
    if (forward && (e.type === 'tool_call' || e.type === 'tool_result')) forward(e)
  }, signal)
}

export function createSubagentMiddleware(opts: SubagentOptions): Middleware {
  const maxParallel = opts.maxParallel ?? DEFAULT_MAX_PARALLEL
  // 当前主循环的 signal / emit / logSink(由 wrapToolCall 捕获,供 spawn 工具继承/转发)
  let currentSignal: AbortSignal | undefined
  let currentEmit: ((e: StreamEvent) => void) | undefined
  let currentLogSink: ((e: any) => void) | undefined

  /** 把子进度(subagent 事件)转发到主 UI(经 currentEmit) */
  const makeForward = (taskId: string, label: string) => (e: SubProgress): void => {
    if (!currentEmit) return
    currentEmit({
      type: 'subagent',
      taskId,
      label,
      kind: e.type,
      name: e.name,
      args: e.type === 'tool_call' ? e.args : undefined,
      result: e.type === 'tool_result' ? e.result : undefined,
      status: e.type === 'tool_result' ? e.status : undefined,
    })
  }

  const spawnOne = tool(
    async ({ prompt, role, tools, model }) => {
      const subOpts = tools?.length ? { ...opts, allowedTools: tools } : opts
      const taskId = `sub-${Math.random().toString(36).slice(2, 8)}`
      const label = role?.trim() || '子任务'
      const onLog = (entry: any) => currentLogSink?.({ ...entry, source: `子:${label}` })
      return await runSubagent({ prompt, role, model }, subOpts, currentSignal, makeForward(taskId, label), onLog)
    },
    {
      name: 'spawn_agent',
      description:
        '委派一个独立子 agent 执行子任务,返回其最终结论(过程隔离,不占主上下文)。用于:分治大任务、专项调研、独立验证。子 agent 默认只读(不改页面)。',
      schema: z.object({
        prompt: z.string().describe('子任务描述(子 agent 的唯一输入)'),
        role: z.string().optional().describe('子 agent 身份(如"你是代码审查专家")'),
        tools: z.array(z.string()).optional().describe('子 agent 可用工具名白名单(默认只读 window + fetch)'),
        model: z.string().optional().describe('覆盖模型(默认同主)'),
      }),
    },
  )

  const spawnMany = tool(
    async ({ tasks }) => {
      // 并发池(maxParallel):子 agent 间并行,结果按原顺序聚合;signal 继承
      const results = await runPool(
        tasks,
        maxParallel,
        async (t, i) => {
          const taskId = `sub-${i}-${Math.random().toString(36).slice(2, 6)}`
          const label = t.role?.trim() || `子任务${i + 1}`
          const onLog = (entry: any) => currentLogSink?.({ ...entry, source: `子:${label}` })
          return runSubagent(t, opts, currentSignal, makeForward(taskId, label), onLog)
        },
        currentSignal,
      )
      return results.map((r, i) => `【子任务 ${i + 1}】\n${r ?? '(未完成)'}`).join('\n\n')
    },
    {
      name: 'spawn_agents',
      description:
        '并行委派多个独立子 agent,聚合各自结论(子 agent 间互不通信,由你汇总)。适合:多路调研、多视角审查、批量处理。',
      schema: z.object({
        tasks: z
          .array(z.object({ prompt: z.string().describe('子任务描述'), role: z.string().optional() }))
          .min(1)
          .max(8)
          .describe('子任务列表(最多 8 个)'),
      }),
    },
  )

  return {
    name: 'subagent',
    tools: [spawnOne, spawnMany],
    wrapToolCall: async (ctx, next) => {
      // 捕获主循环 signal(主停则子停)+ emit(子进度转发到主 UI)
      if (ctx.signal) currentSignal = ctx.signal
      if (ctx.emit) currentEmit = ctx.emit
      if (ctx.logSink) currentLogSink = ctx.logSink
      return next(ctx)
    },
  }
}
