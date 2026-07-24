/**
 * 框架无关 SDK 入口 —— createChatSdk
 *
 * 组装:harness(createAgent)+ 内置中间件(todos/skills/vfs/memory/permissions)
 *   + 内置工具(window 操作/fetch 文档)+ 用户工具/skills/memory/windowProps
 *   + 持久化(IndexedDB,降级内存;多 agent id 隔离;全局配额/LRU 淘汰)
 * 对外命令式 API:mount(container) / unmount() / send(message) / switchSession()。
 * 内部用 Vue 渲染 ChatDialog(打包进 SDK,使用者无需安装 Vue)。
 *
 * 持久化模型:三层命名空间 DB→agentId→sessionId。
 *   - send() 与 mount()(经 useChat)共享同一响应式 messages 数组(唯一来源)。
 *   - mount 异步:await 持久化恢复 → 构造 agent → 渲染。
 *
 * 共享上下文(shareContext):同 agentId 的多个 createChatSdk 实例可复用同一 AgentCore
 *   (messages/agent/vfsStore/store/todos/memory 全共享 = 「同一 agent 的多个对话框视图」)。
 *   模块级 sharedCores 注册表 + 引用计数;mount/unmount 各自渲染到不同 container。
 */
import { createApp, h, defineComponent, reactive, type App as VueApp } from 'vue'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import ChatDialog from '../components/ChatDialog.vue'
import { createAgent } from '../harness/createAgent'
import { z } from 'zod'
import { createTodosMiddleware } from '../harness/todos'
import { createSkillsMiddleware, type SkillSpec } from '../harness/skills'
import { createMemoryMiddleware } from '../harness/memory'
import { createPermissionsMiddleware, type PermissionRule } from '../harness/permissions'
import { createApprovalMiddleware } from '../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../harness/humanConfirm'
import {
  createCheckpointManager,
  createCheckpointMiddleware,
  type CheckpointManager,
} from '../harness/checkpoint'
import type { Middleware } from '../harness/middleware'
import { createSubagentMiddleware, createSubagentsMiddleware, type SubagentConfig } from '../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, type VerifyCheck } from '../harness/verify'
import { connectMcp, type McpServerConfig } from '../mcp/client'
import { createSummarizationMiddleware } from '../harness/summarization'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { resolveContextOptions, type ContextPreset } from './contextPreset'
import { createVfs, createVfsMiddleware, type VfsStore } from '../backends/vfs'
import type { VfsFile } from '../harness/state'
import { createWindowOps, type WindowPropSpec } from '../tools/windowOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { selectBuiltinTools } from '../toolsets'
import { createUsageHintsMiddleware } from '../harness/usageHints'
import { createSessionStore, type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot } from '../backends/storage'
import { makeId } from '../utils/id'
import { resolveModelCaps } from '../utils/modelCaps'
import { groupRounds, plainSummary } from '../utils/rounds'
import type { AgentMessage, StreamHandler, AgentInfo } from '../types'

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number
}

/** 单 agent 实例的会话控制 */
export interface SessionOptions {
  /** 显式会话 id(载入指定会话;不存在则以该 id 新建) */
  id?: string
  /** 自动恢复最近会话(默认 true;false 则每次新建) */
  autoResume?: boolean
  /** 会话标题(供未来会话列表 UI) */
  title?: string
}

export interface ChatSdkOptions {
  /** 挂载点(选择器或元素;headless 模式 ui:false 时可不传) */
  container?: string | HTMLElement
  /** UI:'default'(默认,渲染内置 ChatDialog)/ false(headless 不渲染,只返回 agent 核心,集成方自建 UI) */
  ui?: boolean | 'default'
  /** LLM:配置对象(LLMConfig,兼容 OpenAI 协议)或预构造模型实例(任意 provider,provider 抽离) */
  llm: LLMConfig | BaseChatModel
  /**
   * agent 实例 id(多 agent 共存隔离用)。强烈建议传稳定值:刷新后据此恢复数据。
   * 不传则随机生成并告警(刷新后无法恢复)。
   */
  id?: string
  /** 持久化:默认关闭;赋值后端字符串('indexed'/'session'/'local'/'memory')或配置对象开启;false 关闭 */
  storage?: StorageBackendType | StorageConfig | false
  /** 会话控制 */
  session?: SessionOptions
  /** 共享上下文:默认 false(每实例独立);true 时同 id 复用同一 AgentCore(同页多对话框 = 同一 agent) */
  shareContext?: boolean
  /** 系统提示词(通用"页面操作助手",可覆盖) */
  systemPrompt?: string
  /** 用户自定义工具(散工具 / 展开的预设数组 / 模块 default,皆可;与内置工具合并) */
  tools?: StructuredToolInterface[]
  /** 声明式 skill(渐进式披露) */
  skills?: SkillSpec[]
  /** AGENTS.md 风格持久指令(加载时优先于持久化的 memory) */
  memory?: string
  /** window 可操作属性注册表(范围 + schema 校验) */
  windowProps?: WindowPropSpec[]
  /** scope 白名单(默认不启用;启用后对 window/vfs 工具生效) */
  permissions?: PermissionRule[]
  /** 自定义中间件(在内置中间件之后注入;可拦截/观察模型调用、工具执行、prompt 增强等) */
  middleware?: Middleware[]
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number }
  /** 每个 window 属性最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number
  debug?: boolean
  maxToolRounds?: number
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
  /** 同轮多个工具调用的并发上限(默认 1 串行;>1 并发,可能影响有状态中间件如 todos 的计数) */
  maxParallelTools?: number
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number
  /** 内置能力开关(默认全开;关掉某能力则对应中间件/工具不装载) */
  capabilities?: {
    windowOps?: boolean      // window 操作工具集(默认 true;关 → 不装 10 个 window 工具,省 token/上下文)
    fetch?: boolean          // 文档抓取工具 fetch_document(默认 true;关 → 不装)
    planning?: boolean       // todos 任务规划
    skills?: boolean         // 渐进式披露技能
    vfs?: boolean            // 虚拟工作区(关 → 大结果外存退化为截断)
    summarization?: boolean  // 上下文压缩(关 → 长会话不压缩)
    memory?: boolean         // AGENTS.md 持久指令
    subagent?: boolean       // 子 agent 委派(与 subagent.enabled:false 等效)
    verify?: boolean         // 自检中间件(默认 false;开启后 agent 返回前跑 check 自纠,需配合 verify.check)
  }
  /** 子 agent 委派(spawn_agent/spawn_agents);默认开启,{ enabled: false } 关闭 */
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | BaseChatModel; maxDepth?: number; maxParallel?: number }
  /** 预声明子 agent 列表:每个用同主配置方式声明,自动生成 use_<id> 委派工具(与 spawn_agent 共存) */
  subagents?: SubagentConfig[]
  /** 自检:agent 返回前跑 check,不通过则 feedback 回灌自纠(默认关闭)。需 capabilities.verify:true 开启;check 必填(期三起可省略,默认用 createWriteBackCheck) */
  verify?: {
    /** 显式关闭(优先级最高;即使 capabilities.verify:true) */
    enabled?: boolean
    /** 领域校验函数(ok=false 时 feedback 回灌自纠) */
    check?: VerifyCheck
    /** 自纠上限(默认 2) */
    maxAttempts?: number
    /** 对抗式验证(期四实现:spawn 找茬子 agent) */
    adversarial?: boolean
  }
  /**
   * 人工确认:工具调用前弹确认框,用户「允许/拒绝」后才执行(默认关闭,不传 = 不装)。
   * tools 指定需确认的工具名(如 ['set_window_prop','edit_window_prop']);confirm 自定义判定;timeoutMs 超时自动拒绝。
   * humanConfirmTool(默认 true,传 approval 即装):装载 request_human_confirmation 工具,LLM 可在不确定/多方案/高风险时主动征询用户。
   */
  approval?: {
    tools?: string[]
    confirm?: (name: string, args: any) => boolean
    timeoutMs?: number
    /** 是否装载 request_human_confirmation 主动确认工具(传 approval 时默认 true;false 关闭) */
    humanConfirmTool?: boolean
  }
  /**
   * 会话级 checkpoint 回滚(回到上次正常时)。默认关闭,不传 = 不装。
   * 传 true 用默认;或 { maxCheckpoints?, auto? }。auto(默认 true):每轮 agent 行动前自动存一个 checkpoint;
   * restore_last_checkpoint / list_checkpoints 工具供 LLM 自纠;SDK 暴露 restoreLastCheckpoint/listCheckpoints 供 UI 一键回退。
   */
  checkpoint?: boolean | { maxCheckpoints?: number; auto?: boolean }
  /** MCP server 列表(连远程 server,动态把其 tools 注入 agent;浏览器仅 http/sse/websocket transport) */
  mcp?: McpServerConfig[]
  /** 上下文压缩配置(false 关闭;默认 LLM 摘要,失败回退索引摘要) */
  contextOptions?: Partial<ContextManagerOptions> | false
  /**
   * 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive。
   * 提供一组合理默认,降低配置学习难度;contextOptions 细参可在其基础上覆盖个别字段。
   */
  contextPreset?: ContextPreset
  /**
   * 摘要压缩专用 LLM:可传 BaseChatModel 实例或 LLMConfig(如更便宜的小模型)。
   * 不传则默认用主 agent 的模型(options.llm)。
   */
  summaryLlm?: BaseChatModel | LLMConfig
  /** 摘要 LLM 温度(默认 0.3,稳定输出) */
  summaryTemperature?: number
  /** 摘要 LLM 输出上限(默认 1024;摘要无需大输出,省成本) */
  summaryMaxTokens?: number
  /** 摘要 LLM 超时毫秒(默认 15000;超时回退零成本索引摘要,不阻塞用户) */
  summaryTimeoutMs?: number
  /** 流式输出(默认 true 逐字流式);false 时等整段回复再显示(底层仍 stream 聚合) */
  streaming?: boolean
  /** 对话框 UI 文案 */
  title?: string
  placeholder?: string
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless) */
  mount(): Promise<void>
  /** 响应式消息数组(headless 模式下供集成方自建 UI 读取;与内部共享同一引用) */
  messages: AgentMessage[]
  /** 卸载(shareContext 时仅减引用计数,归零才真销毁) */
  unmount(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化) */
  send(message: string): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 切换到指定会话(载入其上下文);不传 id 则新建。返回新会话 id。storage 未开启时抛错 */
  switchSession(sessionId?: string): Promise<string>
  /** 检视 agent 详细信息(tools/skills/windowProps/middleware/todos 等),供 debug 或外部消费 */
  inspect(): AgentInfo
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + window 注册属性 + vfs + todos);需开启 checkpoint 选项,无可用 checkpoint 返回 false */
  restoreLastCheckpoint(): boolean
  /** 列出可用 checkpoint(回退点);需开启 checkpoint 选项,未开启返回空数组 */
  listCheckpoints(): { id: number; label?: string; timestamp: number; messageCount: number }[]
}

/** 内存中保留的对话轮数上限(超限压缩为摘要,防 OOM);0 表示关闭 */
const DEFAULT_MAX_MEMORY_ROUNDS = 50


/** 解析 storage 选项 → SessionStore | null(undefined/false/未传 关闭;字符串/对象 开启) */
function resolveStorage(storage: StorageBackendType | StorageConfig | false | undefined): SessionStore | null {
  if (storage === undefined || storage === false) return null
  if (typeof storage === 'string') return createSessionStore({ backend: storage })
  if (storage.enabled === false) return null
  return createSessionStore(storage)
}

/** 判定 llm 选项是模型实例(BaseChatModel)还是配置对象(LLMConfig) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

// ===== AgentCore:可被多实例共享的核心上下文 =====
type AgentInstance = ReturnType<typeof createAgent>
type TodosMw = ReturnType<typeof createTodosMiddleware>
type MemoryMw = ReturnType<typeof createMemoryMiddleware>

interface AgentCore {
  agentId: string
  store: SessionStore | null
  messages: AgentMessage[]
  vfsStore: VfsStore
  todosMw: TodosMw
  memoryMw: MemoryMw
  agent: AgentInstance | null
  initDone: Promise<void>
  /** 当前会话 id(可变;共享时多实例同步) */
  sessionId: string
  /** 引用计数(shareContext 时多实例共用一个 core) */
  refCount: number
  /** MCP client closers(unmount/release 时关闭) */
  mcpClosers: Array<() => Promise<void>>
  /** 已连 MCP server 元信息(getInfo 展示;失败的 server 不进) */
  mcpServers: { name: string; url: string; toolCount: number }[]
  /** 会话级 checkpoint 管理器(未开启 checkpoint → null) */
  checkpoint: CheckpointManager | null
  applySnapshot(snap: SessionSnapshot): void
  afterRound(): void
  send(message: string): Promise<string>
  switchSession(sessionId?: string): Promise<string>
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 实例 unmount 时调;引用计数归零才真销毁(store.dispose + 移出注册表) */
  release(): void
  /** 检视 agent 详情(inspect() 与 debug 窗口消费) */
  getInfo(): AgentInfo
}

/** shareContext 注册表:agentId → AgentCore(同页同 id 复用) */
const sharedCores = new Map<string, AgentCore>()

/** 从 LLM 响应消息提取文本内容(content 可能是 string 或 content parts 数组) */
function extractText(msg: BaseMessage): string {
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('')
  }
  return String(c ?? '')
}

/**
 * 构建摘要用 LLM invoke 函数(供 summarization 中间件 llmInvoke)。
 * 优先用 options.summaryLlm(专用压缩模型,如更便宜的小模型);未配则回退主 agent 模型(options.llm)。
 * 复用实例或按 LLMConfig 另构造 ChatOpenAI(低温 + 限输出,压缩成连贯段落)。
 * 温度/输出/超时可配(summaryTemperature/summaryMaxTokens/summaryTimeoutMs);超时回退索引摘要(不阻塞用户)。
 */
function buildSummaryLlmInvoke(options: ChatSdkOptions): ((prompt: string) => Promise<string>) | undefined {
  const llmOpt = options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  const temperature = options.summaryTemperature ?? 0.3
  const maxTokens = options.summaryMaxTokens ?? 1024
  const timeoutMs = options.summaryTimeoutMs ?? 15000
  let llm: BaseChatModel
  if (isChatModel(llmOpt)) {
    llm = llmOpt
  } else {
    const cfg = llmOpt as LLMConfig
    if (!cfg.apiKey) {
      // 显式配了 summaryLlm 却无效(apiKey 缺失):非 debug 也 warn,避免"以为用了专用模型实际回退了主模型/索引摘要"
      if (options.summaryLlm) {
        console.warn('[chat-sdk][summarization] summaryLlm 已配置但缺 apiKey,摘要回退主 agent 模型或零成本索引摘要')
      }
      return undefined
    }
    llm = new ChatOpenAI({
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature,
      maxTokens,
      configuration: cfg.baseUrl ? { baseURL: cfg.baseUrl } : undefined,
    })
  }
  return async (prompt: string) => {
    // 超时保护:摘要 LLM 卡住时 reject → useContextManager 的 try/catch 回退索引摘要,不阻塞用户首次响应
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await llm.invoke(
        [
          new SystemMessage('你是对话历史压缩助手。把下面按轮次索引的对话要点,改写成一段连贯、紧凑的中文摘要,保留关键事实、用户意图与已用工具,不要编造。直接输出摘要正文。'),
          new HumanMessage(prompt),
        ],
        { signal: ac.signal } as any,
      )
      return extractText(res).trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 构建一个独立的核心上下文(含持久化恢复 + agent 构造 + 操作函数) */
function buildCore(options: ChatSdkOptions, agentId: string): AgentCore {
  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[chat-sdk][storage]', e))
  }

  // ===== 模型能力(声明优先 > model 名查表 > 缺省):供 offload 阈值/压缩触发/maxTokens 缺省自适应 =====
  const llmCfg = isChatModel(options.llm) ? undefined : (options.llm as LLMConfig)
  const modelCaps = resolveModelCaps({
    model: llmCfg?.model,
    contextWindow: options.contextWindow ?? llmCfg?.contextWindow,
    maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens,
  })
  if (options.debug) console.log('[chat-sdk][modelCaps]', modelCaps)

  // 摘要用 LLM invoke(默认 LLM 摘要压缩);apiKey 缺失时为 undefined → 自动回退零成本索引摘要
  const summaryLlmInvoke = buildSummaryLlmInvoke(options)
  if (options.debug && !summaryLlmInvoke) console.warn('[chat-sdk][summarization] 未构造 llmInvoke(apiKey 缺失?),摘要回退零成本索引摘要')

  // ===== 共享 messages(send/mount 唯一来源)=====
  const messages = reactive<AgentMessage[]>([])

  // ===== vfs + 中间件(保留可 reset 的引用以便恢复注入)=====
  const vfsStore = createVfs(options.vfs?.initialFiles, {
    persist: store
      ? { save: (files: Record<string, VfsFile>): void => {
          if (core.sessionId && store) void store.save(agentId, core.sessionId, { vfs: files })
        } }
      : undefined,
    maxBytes: options.vfs?.maxBytes,
  })

  const todosMw = createTodosMiddleware()
  const memoryMw = createMemoryMiddleware(options.memory || '')

  // agent 实例引用 holder(checkpoint manager 需读 agent.getState 取 todos,但 agent 在 initDone 内才创建;闭包延后读取)
  const agentRef: { current: any } = { current: null }

  // 会话级 checkpoint(默认关;传 options.checkpoint 开启):每轮自动存 + 一键回滚到上次正常时
  const checkpointOpts = options.checkpoint
  const useCheckpoint = checkpointOpts !== undefined && checkpointOpts !== false
  const checkpointMgr: CheckpointManager | null = useCheckpoint
    ? createCheckpointManager({
        windowPaths: (options.windowProps ?? []).map((w) => w.path),
        vfsStore,
        todosMw,
        getTodos: () => agentRef.current?.getState?.()?.todos ?? [],
        messages,
        maxCheckpoints:
          checkpointOpts && typeof checkpointOpts === 'object' ? checkpointOpts.maxCheckpoints : undefined,
      })
    : null
  const checkpointAuto = !checkpointOpts || typeof checkpointOpts !== 'object' || checkpointOpts.auto !== false

  // 内置能力开关(默认全开;false 则对应中间件/工具不装载)
  const caps = options.capabilities
  const useWindowOps = caps?.windowOps !== false

  // 工具:window 操作 + 文档抓取 + 用户自定义(子 agent 中间件据此筛选只读子集)
  // windowOps/fetch 可经 capabilities 关闭(默认开,保持零配置;关则不进工具池,省 token/上下文);筛选经纯函数 selectBuiltinTools(可单测)
  const windowOps = useWindowOps
    ? createWindowOps(options.windowProps || [], {
        onAudit: options.debug ? (e) => console.log('[chat-sdk][window audit]', e) : undefined,
        maxSnapshots: options.maxSnapshots,
      })
    : []
  // 工具来源标注(builtin / mcp:<name> / user),供 getInfo 展示(DebugDrawer 区分内置/MCP/用户工具)
  const toolSources = new Map<string, string>()
  const builtinTools = selectBuiltinTools(caps, windowOps, fetchDocTools)
  builtinTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  const userTools: StructuredToolInterface[] = [
    ...(options.tools || []),
  ]
  userTools.forEach((t) => toolSources.set(t.name, 'user'))
  // 人工确认(主动侧):传 approval 且 humanConfirmTool 未关 → 装 request_human_confirmation 工具(LLM 主动征询用户)
  const useHumanConfirm = !!options.approval && options.approval.humanConfirmTool !== false
  const humanConfirmTool = useHumanConfirm ? createHumanConfirmTool() : null
  if (humanConfirmTool) toolSources.set(HUMAN_CONFIRM_TOOL_NAME, 'builtin')
  // 会话级 checkpoint 回滚工具(供 LLM 自纠:流程异常/走偏时回退到上次正常态)
  const checkpointTools: StructuredToolInterface[] = useCheckpoint && checkpointMgr
    ? [
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint,无法回退。'
            const ok = checkpointMgr.restore()
            return ok
              ? `已回退到最近一次正常状态(checkpoint #${list[list.length - 1].id})。对话历史、window 注册属性、vfs、todos 已整体还原。请基于回退后的状态重新判断并继续。`
              : '回退失败:无可用 checkpoint。'
          },
          { name: 'restore_last_checkpoint', description: '回退到最近一次正常状态(整体还原对话历史 + window 注册属性 + vfs + todos)。当本轮操作出错、页面被改坏、或走偏时调用,回到本轮起点重新来过。不传参数即回退最近一次。', schema: z.object({}).optional() },
        ),
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint。'
            return '可用 checkpoint:\n' + list.map((c) => `#${c.id} [${c.label ?? 'auto'}] 消息数=${c.messageCount} 时间=${new Date(c.timestamp).toLocaleTimeString()}`).join('\n')
          },
          { name: 'list_checkpoints', description: '列出可用会话 checkpoint(回退点)。', schema: z.object({}).optional() },
        ),
      ]
    : []
  checkpointTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  const allTools: StructuredToolInterface[] = [
    ...builtinTools,
    ...userTools,
    ...(humanConfirmTool ? [humanConfirmTool] : []),
    ...checkpointTools,
  ]

  const usePlanning = caps?.planning !== false
  const useSkills = caps?.skills !== false
  const useVfs = caps?.vfs !== false
  const useSummarization = caps?.summarization !== false
  const useMemory = caps?.memory !== false
  const useSubagent = caps?.subagent !== false
  // verify 默认关(烧 token);需 capabilities.verify:true + 未显式 enabled:false + maxAttempts>0(check 可选,省略则用 createWriteBackCheck)
  const verifyMaxAttempts = options.verify?.maxAttempts ?? 2
  const useVerify = caps?.verify === true && options.verify?.enabled !== false && verifyMaxAttempts > 0
  // 诊断:常见误用 warn(与 options.id/mcp 的 warn 惯例一致),避免"以为开了实际没开"
  if (options.verify?.check && caps?.verify !== true) {
    console.warn('[chat-sdk][verify] 检测到 verify.check 但 capabilities.verify 未开启,verify 未装载')
  }

  // 子 agent 中间件(capabilities.subagent 或 subagent.enabled 为 false 则关闭)
  const subOpts = options.subagent
  // 子 agent 工具:allowedTools(从主池按名选)
  const subAllowed = subOpts?.allowedTools ?? []
  const subagentMw =
    !useSubagent || subOpts?.enabled === false
      ? undefined
      : createSubagentMiddleware({
          llm: subOpts?.llm ?? options.llm,
          allTools,
          allowedTools: subAllowed.length ? subAllowed : undefined,
          // 子 agent 独立配置(自定义身份/温度/上下文上限/技能)
          systemPrompt: subOpts?.systemPrompt,
          temperature: subOpts?.temperature,
          maxTokens: subOpts?.maxTokens,
          skills: subOpts?.skills,
          maxDepth: subOpts?.maxDepth,
          maxParallel: subOpts?.maxParallel,
          debug: options.debug,
        })

  // 预声明子 agent(subagents:[] → 每个 use_<id> 委派工具;与上面 spawn 中间件共存)
  const subagentsMw = options.subagents?.length
    ? createSubagentsMiddleware(options.subagents, { llm: options.llm, allTools, debug: options.debug })
    : undefined

  // 对抗子 agent 的只读工具(白名单筛选,让其能实证读回 window 检查而非臆测;windowOps 关闭则不含 window 工具)
  const READONLY_FOR_ADVERSARIAL = ['get_window_prop', 'get_window_paths', 'list_window_props', 'describe_window_prop', 'fetch_document']
  const readonlyTools = allTools.filter((t) => READONLY_FOR_ADVERSARIAL.includes(t.name))
  // verify 中间件(check 省略时默认 createWriteBackCheck 写后读回验证)。maxAttempts 经 maxVerifyAttempts 透传 createAgent,非中间件字段
  const verifyMw = useVerify
    ? createVerifyMiddleware({
        check: options.verify!.check ?? createWriteBackCheck({
          schemas: Object.fromEntries((options.windowProps ?? []).map((p) => [p.path, p.schema])),
        }),
        adversarial: options.verify?.adversarial ? { llm: options.llm, tools: readonlyTools } : undefined,
      })
    : undefined

  // 能力用法提示(最前,紧跟 base systemPrompt;按 caps 注入,全关则不注入)
  const usageHintsMw = createUsageHintsMiddleware(
    { ...caps, humanConfirm: useHumanConfirm },
    useWindowOps && !!(options.windowProps?.length),
  )
  const middlewares = [
    usageHintsMw,
    // 按 capabilities 条件装载内置中间件(默认全开;verify 默认关)
    ...(usePlanning ? [todosMw] : []),
    ...(useSkills
      ? [
          createSkillsMiddleware(options.skills || [], {
            // vfs 启用时注入 readVfs,让 skill 文档源(vfs://path)能读取 vfs 文件
            readVfs: useVfs ? (p: string) => vfsStore.files[p]?.content : undefined,
          }),
        ]
      : []),
    ...(useVfs ? [createVfsMiddleware(vfsStore)] : []),
    ...(useSummarization
      ? [
          createSummarizationMiddleware({
            // 预设档位(默认 auto)提供合理默认 → contextOptions 细参覆盖个别字段 → 兜底
            ...resolveContextOptions(options, modelCaps.contextWindow),
            llmInvoke: summaryLlmInvoke,
          }),
        ]
      : []),
    ...(useMemory ? [memoryMw] : []),
    ...(options.permissions?.length ? [createPermissionsMiddleware(options.permissions)] : []),
    // 会话级 checkpoint:auto 模式每轮 beforeModel 首次自动存(回滚到上次正常时);顺序无关(仅 beforeAgent/beforeModel 副作用)
    ...(useCheckpoint && checkpointAuto && checkpointMgr ? [createCheckpointMiddleware(checkpointMgr)] : []),
    // 人工确认(主动侧):拦截 request_human_confirmation,发 approval_request;装在 approval 白名单之前(更外层,先收口,避免双重确认)
    ...(useHumanConfirm ? [createHumanConfirmMiddleware()] : []),
    // 人工确认(被动侧):白名单工具调用前确认(wrapToolCall 洋葱,此处更内层)
    ...(options.approval && (options.approval.tools !== undefined || !!options.approval.confirm)
      ? [createApprovalMiddleware(options.approval)]
      : []),
    ...(verifyMw ? [verifyMw] : []), // permissions 之后(beforeReturn 正序,verify 在用户自定义中间件前)
    ...(subagentMw ? [subagentMw] : []),
    ...(subagentsMw ? [subagentsMw] : []),
    ...(options.middleware || []),
  ]

  const maxMemoryRounds = options.maxMemoryRounds ?? DEFAULT_MAX_MEMORY_ROUNDS

  const core: AgentCore = {
    agentId,
    store,
    messages,
    vfsStore,
    todosMw,
    memoryMw,
    agent: null,
    initDone: Promise.resolve(),
    sessionId: '',
    refCount: 0,
    mcpClosers: [],
    mcpServers: [],
    checkpoint: checkpointMgr,

    /** 持久化恢复:灌入 messages / vfs / todos / memory(hydrate 不触发 vfs save) */
    applySnapshot(snap: SessionSnapshot): void {
      if (snap.messages?.length) messages.push(...snap.messages)
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.todos?.length) todosMw.reset(snap.todos)
      // memory:options.memory 优先(非空覆盖),否则用持久化的
      if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
    },

    /** 一轮结束后:裁内存历史(防 OOM)+ 安排持久化(debounced)。落盘等待由 onPersist/send 显式 await flush 保证 */
    afterRound(): void {
      trimMemoryMessages()
      persistRuntime()
    },

    async send(message: string): Promise<string> {
      await core.initDone
      messages.push({ role: 'user', content: message, timestamp: Date.now() })
      const reply = await core.agent!.invoke(messages)
      messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
      core.afterRound()
      if (store) await store.flush() // 确保落盘完成(indexed 异步事务;刷新前已写入)
      return reply
    },

    /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
    async switchSession(sessionId?: string): Promise<string> {
      await core.initDone
      if (!store) throw new Error('chat-sdk: storage 未开启,无法切换会话(请传 storage 选项)')
      vfsStore.flush?.()
      await store.flush()
      let target = sessionId ?? ''
      let snap: SessionSnapshot | undefined
      if (target) {
        snap = await store.load(agentId, target)
        if (!snap) await store.createSession(agentId, options.session?.title, target)
      } else {
        target = await store.createSession(agentId, options.session?.title)
      }
      core.sessionId = target
      // 清空当前内存态(替换语义,非叠加)
      messages.splice(0, messages.length)
      vfsStore.clear?.()
      todosMw.reset([])
      if (!options.memory) memoryMw.reset('')
      if (!snap) snap = await store.load(agentId, target)
      if (snap) core.applySnapshot(snap)
      if (options.memory) void store.save(agentId, core.sessionId, { memory: options.memory })
      return target
    },

    stream: (msgs, onEvent, signal) => {
      if (!core.agent) throw new Error('chat-sdk: agent 尚未初始化完成,请先 await mount()')
      return core.agent.stream(msgs, onEvent, signal)
    },

    release(): void {
      core.refCount--
      if (core.refCount <= 0) {
        if (store) {
          vfsStore.flush?.()
          void store.flush()
          store.dispose()
        }
        const closers = core.mcpClosers.splice(0)
        if (closers.length) void Promise.allSettled(closers.map((c) => c()))
        sharedCores.delete(agentId)
      }
    },

    /** 检视 agent 详情:tools/skills/windowProps/memory/middleware/todos(inspect() 与 debug 窗口消费) */
    getInfo(): AgentInfo {
      return {
        id: agentId,
        model: isChatModel(options.llm) ? ((options.llm as any).model ?? (options.llm as any).modelName) : options.llm.model,
        tools: allTools.map((t) => ({ name: t.name, description: t.description, schema: (t as any).schema, source: toolSources.get(t.name) || 'user' })),
        skills: (options.skills ?? []).map((s) => ({ name: s.name, description: s.description })),
        windowProps: (options.windowProps ?? []).map((w) => ({ path: w.path, description: w.description, schema: w.schema })),
        memory: options.memory ?? '',
        middleware: middlewares.map((m) => m.name),
        todos: (core.agent?.getState?.()?.todos ?? []).map((t) => ({ content: t.content, status: t.status })),
        subagent: {
          enabled: !!subagentMw,
          maxDepth: options.subagent?.maxDepth ?? 1,
          maxParallel: options.subagent?.maxParallel ?? 4,
          allowedTools: options.subagent?.allowedTools ?? [],
        },
        verify: {
          enabled: !!verifyMw,
          maxAttempts: useVerify ? verifyMaxAttempts : 0,
          adversarial: useVerify && !!options.verify?.adversarial,
        },
        mcp: { servers: core.mcpServers },
        lastCompression: core.agent?.getState?.()?.lastCompression as AgentInfo['lastCompression'],
        checkpoints: checkpointMgr
          ? { enabled: true, auto: checkpointAuto, list: checkpointMgr.list() }
          : undefined,
      }
    },
  }

  /** 解析会话 id + 载入快照(仅 store 非 null 时) */
  async function resolveAndLoad(): Promise<void> {
    if (!store) return
    await store.ready
    const sessOpts = options.session || {}
    if (sessOpts.id) {
      core.sessionId = sessOpts.id
      const snap = await store.load(agentId, core.sessionId)
      if (snap) core.applySnapshot(snap)
      else await store.createSession(agentId, sessOpts.title, core.sessionId)
    } else if (sessOpts.autoResume !== false) {
      const sessions = await store.listSessions(agentId)
      if (options.debug) console.log('[chat-sdk][restore] listSessions', agentId, sessions.length, sessions.map((s) => s.sessionId))
      if (sessions.length) {
        core.sessionId = sessions[0].sessionId
        const snap = await store.load(agentId, core.sessionId)
        if (snap) {
          core.applySnapshot(snap)
          if (options.debug) console.log('[chat-sdk][restore] 恢复会话', core.sessionId, `${snap.messages?.length ?? 0} msgs`)
        } else if (options.debug) {
          console.log('[chat-sdk][restore] 会话 meta 存在但快照为空', core.sessionId)
        }
      } else {
        core.sessionId = await store.createSession(agentId, sessOpts.title)
        if (options.debug) console.log('[chat-sdk][restore] 新建会话(无历史)', core.sessionId)
      }
    } else {
      core.sessionId = await store.createSession(agentId, sessOpts.title)
    }
    // options.memory 落盘(每次启动确保持久化;加载时 options 优先已在 applySnapshot 处理)
    if (options.memory) void store.save(agentId, core.sessionId, { memory: options.memory })
  }

  /**
   * 内存对话轮数上限:超限把最旧轮次压缩为一条摘要 system 消息(原地 splice,保持共享响应式引用)。
   * storage:false 也生效 —— 纯内存历史累积的 OOM 兜底。
   */
  function trimMemoryMessages(): void {
    if (maxMemoryRounds <= 0) return
    const rounds = groupRounds(messages)
    if (rounds.length <= maxMemoryRounds) return
    const keepFromIdx = rounds[rounds.length - maxMemoryRounds].startIdx
    const older = rounds.slice(0, rounds.length - maxMemoryRounds)
    const summary = older
      .map((r) => {
        const q = plainSummary(r.userMsg.content, 60) || '(空)'
        const a = r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : '(无回复)'
        return `- 第${r.round}轮:${q} → ${a}`
      })
      .join('\n')
    const summaryMsg: AgentMessage = {
      role: 'system',
      content: `【更早对话摘要(${older.length} 轮)】\n${summary}`,
      timestamp: older[0].userMsg.timestamp,
    }
    messages.splice(0, keepFromIdx, summaryMsg)
  }

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    if (!core.sessionId || !store) return
    // messages 元素是 Vue reactive proxy → IDB structured clone 会抛 DataCloneError(静默失败,messages 存不进);
    // 先 JSON 纯化为普通对象。localStorage 走 JSON.stringify 本就纯化,故 local 不受影响、indexed 受影响。
    const pureMessages = JSON.parse(JSON.stringify(messages)) as AgentMessage[]
    void store.save(agentId, core.sessionId, { messages: pureMessages })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    void store.save(agentId, core.sessionId, { todos })
    if (options.debug) console.log('[chat-sdk][persist] save', core.sessionId, `${messages.length} msgs`)
  }

  // 初始化:解析会话 + 恢复 + 构造 agent(异步,不阻塞 buildCore 返回)
  core.initDone = (async (): Promise<void> => {
    await resolveAndLoad()
    // MCP:连所有 server(故障隔离),工具注入 allTools(createAgent 前 —— 构造后 bindTools 固化)
    if (options.mcp?.length) {
      const results = await Promise.allSettled(options.mcp.map((c) => connectMcp(c)))
      core.mcpClosers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.close] : []))
      core.mcpServers = []
      const mcpTools: StructuredToolInterface[] = []
      results.forEach((r, i) => {
        const cfg = options.mcp![i]
        const label = cfg.name ?? cfg.url
        if (r.status === 'fulfilled') {
          core.mcpServers.push({ name: label, url: cfg.url, toolCount: r.value.tools.length })
          r.value.tools.forEach((t) => toolSources.set(t.name, `mcp:${label}`))
          mcpTools.push(...r.value.tools)
        } else {
          console.warn(`[chat-sdk][mcp] server ${label} 连接失败:`, r.reason)
        }
      })
      allTools.push(...mcpTools)
      if (options.debug) console.log(`[chat-sdk][mcp] 注入 ${mcpTools.length} 个工具,${core.mcpServers.length} 个 server`)
    }
    core.agent = createAgent({
      // provider 抽离:llm 为模型实例则注入,否则按配置构造 ChatOpenAI
      ...(isChatModel(options.llm)
        ? { llm: options.llm }
        : {
            apiKey: options.llm.apiKey,
            baseUrl: options.llm.baseUrl,
            model: options.llm.model,
            temperature: options.llm.temperature,
            maxTokens: options.llm.maxTokens,
          }),
      systemPrompt: options.systemPrompt,
      tools: allTools,
      middleware: middlewares,
      maxToolRounds: options.maxToolRounds,
      maxRetries: options.maxRetries,
      maxParallelTools: options.maxParallelTools,
      // 模型能力透传(已在 buildCore 解析,声明优先 > 表 > 缺省):驱动 maxTokens 缺省与 offload 阈值
      contextWindow: modelCaps.contextWindow,
      maxOutputTokens: modelCaps.maxOutputTokens,
      // verify 自纠上限:装载 verify 时用 verify.maxAttempts(默认 2),否则 0(关闭自纠 = 现状)
      maxVerifyAttempts: useVerify ? verifyMaxAttempts : 0,
      debug: options.debug,
    })
    agentRef.current = core.agent
  })()

  return core
}

export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  // ===== agent 实例 id(多共存隔离)=====
  const agentId: string = options.id ?? makeId()
  if (!options.id) {
    console.warn(
      `[chat-sdk] 未传 options.id,已生成随机 id "${agentId}"。刷新后持久化数据无法恢复,请传稳定 id。`,
    )
  }
  // 流式输出(默认 true 逐字);false 时 ChatDialog 走非流式 fetchResponse(等整段)
  const streaming = options.streaming ?? true
  const ui = options.ui ?? 'default'

  // ===== 获取或创建 core(shareContext 时同 id 复用)=====
  let core: AgentCore
  const existing = options.shareContext ? sharedCores.get(agentId) : undefined
  if (existing) {
    core = existing
  } else {
    core = buildCore(options, agentId)
    if (options.shareContext) sharedCores.set(agentId, core)
  }
  core.refCount++ // 本实例持有一引用

  // ===== 每实例:渲染 + 事件监听(不共享)=====
  let vueApp: VueApp | null = null
  let flushHandler: (() => void) | null = null
  let visHandler: (() => void) | null = null

  async function mount(): Promise<void> {
    await core.initDone
    // headless:不渲染 UI,只 init agent + 装 flush 兜底(集成方用 messages/send 自建 UI)
    if (ui === false) {
      if (core.store) {
        flushHandler = () => {
          core.vfsStore.flush?.()
          void core.store!.flush()
        }
        visHandler = () => {
          if (document.visibilityState === 'hidden') void core.store!.flush()
        }
        window.addEventListener('pagehide', flushHandler)
        document.addEventListener('visibilitychange', visHandler)
      }
      return
    }
    const el =
      typeof options.container === 'string' ? document.querySelector(options.container) : options.container
    if (!el) throw new Error(`createChatSdk: 挂载点未找到(${options.container})`)
    const debugLogsRef = core.agent!.debugLogs
    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ChatDialog, {
            fetchStream: streaming ? core.agent!.stream : undefined,
            fetchResponse: streaming ? undefined : (msgs: AgentMessage[], signal?: AbortSignal) => core.agent!.invoke(msgs, signal),
            title: options.title,
            placeholder: options.placeholder,
            debugLogs: debugLogsRef.value,
            initialMessages: core.messages,
            getInfo: () => core.getInfo(),
            onUndo: core.checkpoint ? () => core.checkpoint!.restore() : undefined,
            canUndo: core.checkpoint ? () => core.checkpoint!.canRestore() : undefined,
            onPersist: async () => {
              core.afterRound()
              if (core.store) await core.store.flush() // 等待落盘完成(useChat await 此 Promise,确保刷新前 indexed 已写入)
            },
            onClear: () => {
              // 新建会话:同步生成 id + 重置内存态(vfs/todos/memory),防旧会话数据残留或污染新会话
              if (!core.store) return
              core.sessionId = makeId()
              core.vfsStore.clear?.()
              core.todosMw.reset([])
              if (!options.memory) core.memoryMw.reset('')
              void core.store.createSession(core.agentId, options.session?.title, core.sessionId)
            },
          })
      },
    })
    vueApp = createApp(Wrapper)
    vueApp.mount(el)

    // 刷新/切页兜底 flush(防丢 debounce 内的待写)
    if (core.store) {
      flushHandler = () => {
        core.vfsStore.flush?.() // vfs 自身的 800ms debounce 窗口也要立即落盘
        void core.store!.flush()
      }
      visHandler = () => {
        if (document.visibilityState === 'hidden') void core.store!.flush()
      }
      window.addEventListener('pagehide', flushHandler)
      document.addEventListener('visibilitychange', visHandler)
    }
  }

  function unmount(): void {
    if (flushHandler) window.removeEventListener('pagehide', flushHandler)
    if (visHandler) document.removeEventListener('visibilitychange', visHandler)
    flushHandler = null
    visHandler = null
    vueApp?.unmount()
    vueApp = null
    core.release() // 引用计数--;shareContext 归零才真销毁
  }

  return {
    mount,
    unmount,
    send: core.send,
    switchSession: core.switchSession,
    stream: core.stream,
    inspect: core.getInfo,
    messages: core.messages,
    /** 回退到最近一次正常 checkpoint(整体还原对话历史 + window 注册属性 + vfs + todos);无可用 checkpoint 返回 false */
    restoreLastCheckpoint: () => core.checkpoint?.restore() ?? false,
    /** 列出可用 checkpoint(回退点) */
    listCheckpoints: () => core.checkpoint?.list() ?? [],
  }
}
