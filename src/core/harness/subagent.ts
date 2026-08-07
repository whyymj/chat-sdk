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
import { createSkillsMiddleware, type SkillSpec } from './skills'
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
  /** 主 agent 全部工具(子 agent 按白名单筛选只读子集)。支持 getter:运行时 setTools/addTool 动态加的工具对子 agent 立即可见(P1-4) */
  allTools: StructuredToolInterface[] | (() => StructuredToolInterface[])
  /** 子 agent 额外可用的工具名(默认仅只读主数据 + fetch) */
  allowedTools?: string[]
  /** 子 agent 默认身份(spawn 运行时的 role 优先;都缺省用兜底) */
  systemPrompt?: string
  /** 子 agent 温度(仅 llm 配置对象时生效;覆盖主 llm 温度) */
  temperature?: number
  /** 子 agent maxTokens(仅 llm 配置对象时生效;覆盖主) */
  maxTokens?: number
  /** 子 agent 专属 skills(独立,不继承主 agent skills) */
  skills?: SkillSpec[]
  /** 子 agent 额外工具(直接进工具池,不经 allTools 白名单筛选;供预声明子 agent 的专属 tools/toolsets) */
  extraTools?: StructuredToolInterface[]
  /** 最大递归深度(默认 1:主可 spawn,子不可再 spawn) */
  maxDepth?: number
  /** spawn_agents 并发上限(默认 4) */
  maxParallel?: number
  /** 子 agent 最大工具轮次(默认 6) */
  maxToolRounds?: number
  /** 当前递归深度(内部用;主=0) */
  depth?: number
  debug?: boolean
  /** 子 agent 可写路径前缀白名单(给子 agent 写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁)。subagent-writable Phase 2 */
  writablePaths?: string[]
}

/** 判定 llm 是模型实例(BaseChatModel)还是配置对象(SubagentLlmConfig) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 子 agent 默认可用的只读工具(不含写工具 —— 子 agent 只读探查,写回交主 agent) */
const DEFAULT_READONLY_TOOLS = [
  'describe_data',
  'get_data',
  'read',
  'query_data',
  'search_data',
  'fetch_document',
]
const DEFAULT_MAX_DEPTH = 1
const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_CHILD_ROUNDS = 6
const SPAWN_TOOL_NAMES = ['spawn_agent', 'spawn_agents']

/** 子 agent 可获得写权限的工具(经 writablePaths path guard 包装后) */
const SUB_WRITE_TOOLS = ['write', 'set_data', 'edit_data', 'delete_data', 'draft_commit']

/** 提取写工具 args 的所有 jsonPath(jsonPath / patch.jsonPath / patches[].jsonPath / path) */
export function extractWritePaths(args: any): string[] {
  const paths: string[] = []
  if (typeof args.jsonPath === 'string' && args.jsonPath) paths.push(args.jsonPath)
  if (typeof args.path === 'string' && args.path) paths.push(args.path)
  if (args.patch && typeof args.patch.jsonPath === 'string') paths.push(args.patch.jsonPath)
  if (Array.isArray(args.patches)) for (const p of args.patches) { if (p && typeof p.jsonPath === 'string') paths.push(p.jsonPath) }
  return paths
}

/** 写路径前缀校验:精确相等 / startsWith(p + '.') / startsWith(p + '[') */
export function isPathWritable(jsonPath: string, prefixes: string[]): boolean {
  return prefixes.some((p) => jsonPath === p || jsonPath.startsWith(p + '.') || jsonPath.startsWith(p + '['))
}

/** 包写工具一层 path guard:args 所有 jsonPath 必须在 writablePaths 前缀内;越界 → PATH_OUT_OF_SCOPE;整体 set(无 jsonPath)禁。 */
export function wrapWithPathGuard(t: StructuredToolInterface, prefixes: string[]): StructuredToolInterface {
  const orig = t.invoke.bind(t)
  const guarded = async (args: any) => {
    const paths = extractWritePaths(args)
    if (!paths.length) {
      return `PATH_OUT_OF_SCOPE:子 agent 仅可增量 patch(writablePaths: ${prefixes.join(', ')}),不能整体替换(无 jsonPath)。用 write({patch:{jsonPath,...}}) 增量改。`
    }
    for (const p of paths) {
      if (!isPathWritable(p, prefixes)) {
        return `PATH_OUT_OF_SCOPE:子 agent 写 "${p}" 越界(仅可写 ${prefixes.join(', ')})。`
      }
    }
    return orig(args)
  }
  return new Proxy(t, {
    get(target, prop, receiver) {
      if (prop === 'invoke') return guarded
      return Reflect.get(target, prop, receiver)
    },
  }) as StructuredToolInterface
}

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
  // P1-4:allTools 支持 getter —— 子 agent spawn 时取主 agent 最新工具集(运行时 setTools/addTool 动态加的工具对子 agent 可见,不再用装配期快照)
  const getAllTools = typeof opts.allTools === 'function' ? opts.allTools : () => opts.allTools
  // 子 agent 工具:主 allTools 按白名单筛只读子集 + extraTools(预声明子 agent 的专属工具,不经筛选)
  let childTools = [
    ...getAllTools().filter((t) => allow.has(t.name) && !SPAWN_TOOL_NAMES.includes(t.name)),
    ...(opts.extraTools ?? []),
  ]
  // writablePaths(子 agent 写权限):写工具包 path guard 后加入(越界 PATH_OUT_OF_SCOPE;整体 set 禁)
  if (opts.writablePaths?.length) {
    childTools = childTools.filter((t) => !SUB_WRITE_TOOLS.includes(t.name)) // 移除可能的原版写工具(防重复)
    const guardedWrites = getAllTools()
      .filter((t) => SUB_WRITE_TOOLS.includes(t.name) && !SPAWN_TOOL_NAMES.includes(t.name))
      .map((t) => wrapWithPathGuard(t, opts.writablePaths!))
    childTools = [...childTools, ...guardedWrites]
  }
  // 递归物理切断:depth+1 >= maxDepth 时子 agent 不装本中间件 → 无 spawn 工具
  const childMiddleware = depth + 1 < maxDepth ? [createSubagentMiddleware({ ...opts, depth: depth + 1 })] : []
  const child = createAgent({
    // provider 抽离:llm 实例则注入(温度/maxTokens 已在实例上定,忽略 opts.temperature/maxTokens),否则按配置构造(子 agent 配置优先于主 llm)
    ...(isChatModel(opts.llm)
      ? { llm: opts.llm }
      : {
          apiKey: opts.llm.apiKey,
          baseUrl: opts.llm.baseUrl,
          model: task.model ?? opts.llm.model,
          temperature: opts.temperature ?? opts.llm.temperature,
          maxTokens: opts.maxTokens ?? opts.llm.maxTokens,
        }),
    // 身份优先级:运行时 role(spawn 参数)> 配置默认 systemPrompt > 兜底
    systemPrompt:
      task.role?.trim() ||
      opts.systemPrompt ||
      '你是一个专注的子任务执行者。你只有只读工具(读主数据 / 抓文档),用它们完成给定任务,给出简洁结论,不要展开多余解释。',
    tools: childTools,
    // 子 agent 专属 skills(独立,不继承主)+ 递归 subagent 中间件(防递归)
    middleware: [
      ...(opts.skills?.length ? [createSkillsMiddleware(opts.skills)] : []),
      ...childMiddleware,
    ],
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
  // 当前主循环的 signal / emit / logSink(由 wrapToolCall 捕获,供 spawn 工具继承/转发)。
  // ⚠️ 并发限制(M3,已知):此为闭包级单变量,maxParallelTools>1 时并发工具调用的 wrapToolCall 会互相覆盖,
  // 子 agent 可能继承到无关工具的 signal/emit(停止信号错乱 / 进度转发到错误 handler)。
  // 默认 maxParallelTools=1(串行)规避;subagent 场景建议保持串行。彻底修需让 spawn 工具从 ToolCallContext 取这些值(待后续)
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
    async ({ prompt, role, tools, writablePaths, model }) => {
      const subOpts = tools?.length || writablePaths?.length
        ? { ...opts, ...(tools?.length ? { allowedTools: tools } : {}), ...(writablePaths?.length ? { writablePaths } : {}) }
        : opts
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
        tools: z.array(z.string()).optional().describe('子 agent 可用工具名白名单(默认只读主数据 + fetch)'),
        writablePaths: z.array(z.string()).optional().describe('子 agent 可写路径前缀(给写权限;越界 PATH_OUT_OF_SCOPE;如 ["components"] 允许写 components.* )'),
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

// ===== 预声明子 agent(subagents:[] → 专属委派工具 use_<id>)=====

/** 预声明子 agent 配置(同主配置子集 + id/description;缺省继承主 agent) */
export interface SubagentConfig {
  /** 唯一标识;生成委派工具名 use_<id>(须合法工具名 [a-zA-Z_][a-zA-Z0-9_]*) */
  id: string
  /** 一句话说明(进主 systemPrompt 索引 + 作委派工具描述,帮主 LLM 判断何时委派) */
  description: string
  /** 子 agent 独立 llm(缺省继承主) */
  llm?: SubagentLlmConfig | BaseChatModel
  /** 子 agent 身份(缺省继承主 / 兜底) */
  systemPrompt?: string
  /** 子 agent 专属工具(独立于主工具池,直接进子工具池) */
  tools?: StructuredToolInterface[]
  /** 子 agent 专属 skills */
  skills?: SkillSpec[]
  temperature?: number
  maxTokens?: number
  maxToolRounds?: number
  /** 子 agent 可写路径前缀白名单(给写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁) */
  writablePaths?: string[]
}

export interface SubagentsMiddlewareOptions {
  /** 主 agent 的 llm(子 agent 缺省继承) */
  llm: SubagentLlmConfig | BaseChatModel
  /** 主 agent 全部工具(子 agent 按只读白名单筛)。支持 getter(P1-4:动态工具对子 agent 可见) */
  allTools: StructuredToolInterface[] | (() => StructuredToolInterface[])
  debug?: boolean
}

/** 合法工具名校验(生成 use_<id>) */
const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** SubagentConfig → runSubagent 的 opts(继承主缺省 + 展开专属 tools 为 extraTools) */
function configToSubOpts(config: SubagentConfig, main: SubagentsMiddlewareOptions): SubagentOptions {
  const extra = config.tools ?? []
  return {
    llm: config.llm ?? main.llm,
    allTools: main.allTools,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    skills: config.skills,
    extraTools: extra.length ? extra : undefined,
    maxToolRounds: config.maxToolRounds,
    debug: main.debug,
    ...(config.writablePaths?.length ? { writablePaths: config.writablePaths } : {}),
  }
}

/** Subagents 动态控制器:set/add/remove 委派工具(复用 tools rebind 机制) */
export interface SubagentsController {
  /** 替换整个 subagents 列表(重新生成 use_<id> 工具,触发 onReconfigure 回调) */
  set(configs: SubagentConfig[]): void
  /** 追加一个 subagent(id 重复 warn 跳过) */
  add(config: SubagentConfig): void
  /** 移除一个 subagent(by id);返回是否移除成功 */
  remove(id: string): boolean
  /** 读取当前 subagents 列表 */
  get(): SubagentConfig[]
}

/**
 * 预声明子 agent 中间件:为每个 SubagentConfig 生成专属委派工具 use_<id>({ task })。
 * 主 LLM 直接调 use_<id> 委派(工具描述 = subagent.description);子 agent 配置缺省继承主。
 * 与 spawn_agent/spawn_agents(运行时自由委派)共存。子 agent 默认叶子(maxDepth 1,不可再 spawn)。
 * 支持运行时动态:经 controller.set/add/remove 重新生成委派工具,触发 onReconfigure 回调(供 createAgent rebind)。
 */
export function createSubagentsMiddleware(
  subagents: SubagentConfig[],
  main: SubagentsMiddlewareOptions,
): Middleware & { controller: SubagentsController } {
  // 当前主循环 signal/emit/logSink(wrapToolCall 捕获,供 use_<id> 继承/转发子进度)
  let currentSignal: AbortSignal | undefined
  let currentEmit: ((e: StreamEvent) => void) | undefined
  let currentLogSink: ((e: any) => void) | undefined
  const makeForward = (taskId: string, label: string) => (e: SubProgress): void => {
    if (!currentEmit) return
    currentEmit({
      type: 'subagent', taskId, label, kind: e.type, name: e.name,
      args: e.type === 'tool_call' ? e.args : undefined,
      result: e.type === 'tool_result' ? e.result : undefined,
      status: e.type === 'tool_result' ? e.status : undefined,
    })
  }

  // 可变状态:支持运行时 set/add/remove
  let valid: SubagentConfig[] = []
  let tools: StructuredToolInterface[] = []
  let onReconfigure: (() => void) | undefined

  /** 校验 + 生成委派工具(去重 by id) */
  function rebuild(list: SubagentConfig[]): { valid: SubagentConfig[]; tools: StructuredToolInterface[] } {
    const seen = new Set<string>()
    const v: SubagentConfig[] = []
    const t: StructuredToolInterface[] = []
    for (const s of list) {
      if (!TOOL_NAME_RE.test(s.id)) {
        console.warn(`[subagents] id "${s.id}" 非合法工具名(须 [a-zA-Z_][a-zA-Z0-9_]*),已跳过`)
        continue
      }
      const toolName = `use_${s.id}`
      if (seen.has(toolName)) {
        console.warn(`[subagents] id "${s.id}" 重复,已跳过`)
        continue
      }
      seen.add(toolName)
      v.push(s)
      t.push(
        tool(
          async ({ task }) => {
            const opts = configToSubOpts(s, main)
            const onLog = (entry: any) => currentLogSink?.({ ...entry, source: `子:${s.id}` })
            return runSubagent({ prompt: task }, opts, currentSignal, makeForward(`use_${s.id}`, s.id), onLog)
          },
          {
            name: `use_${s.id}`,
            description: `委派给「${s.description}」子 agent 执行任务,返回其结论(过程隔离,不占主上下文)。`,
            schema: z.object({ task: z.string().describe('委派给该子 agent 的任务描述') }),
          },
        ),
      )
    }
    return { valid: v, tools: t }
  }

  const initial = rebuild(subagents)
  valid = initial.valid
  tools = initial.tools

  const controller: SubagentsController = {
    set(configs) {
      const r = rebuild(configs)
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
    },
    add(config) {
      const exists = valid.some((s) => s.id === config.id)
      if (exists) {
        console.warn(`[subagents] add: id "${config.id}" 已存在,已跳过`)
        return
      }
      const r = rebuild([...valid, config])
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
    },
    remove(id) {
      const idx = valid.findIndex((s) => s.id === id)
      if (idx < 0) return false
      const next = valid.filter((s) => s.id !== id)
      const r = rebuild(next)
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
      return true
    },
    get: () => [...valid],
  }

  const mw: Middleware = {
    name: 'subagents',
    get tools() {
      return tools
    },
    augmentPrompt: () =>
      valid.length
        ? [
            '## 可用子 agent(预声明,经专属工具委派)',
            ...valid.map((s) => `- use_${s.id}: ${s.description}`),
            '需要某子 agent 时,直接调用对应的 use_<id>({ task }) 委派,任务描述要清晰。',
          ].join('\n')
        : undefined,
    wrapToolCall: async (ctx, next) => {
      if (ctx.signal) currentSignal = ctx.signal
      if (ctx.emit) currentEmit = ctx.emit
      if (ctx.logSink) currentLogSink = ctx.logSink
      return next(ctx)
    },
  }
  // controller 不可枚举挂载(类比 SkillsController);暴露 onReconfigure setter 供 createAgent 注入 rebind 回调
  Object.defineProperty(mw, 'controller', { value: controller, enumerable: false })
  Object.defineProperty(mw, 'setReconfigureHook', {
    value: (fn: (() => void) | undefined) => { onReconfigure = fn },
    enumerable: false,
  })
  return mw as Middleware & { controller: SubagentsController }
}
