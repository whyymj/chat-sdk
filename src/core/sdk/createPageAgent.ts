/**
 * 框架无关 SDK 入口 —— createPageAgent
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
 * 共享上下文(shareContext):同 agentId 的多个 createPageAgent 实例可复用同一 AgentCore
 *   (messages/agent/vfsStore/store/todos/memory 全共享 = 「同一 agent 的多个对话框视图」)。
 *   模块级 sharedCores 注册表 + 引用计数;mount/unmount 各自渲染到不同 container。
 */
import { createApp, h, defineComponent, reactive, type App as VueApp } from 'vue'
import type { StructuredToolInterface } from '@langchain/core/tools'
import ChatDialog from '../components/ChatDialog.vue'
import { createAgent } from '../harness/createAgent'
import { createTodosMiddleware } from '../harness/todos'
import { createSkillsMiddleware, type SkillSpec } from '../harness/skills'
import { createMemoryMiddleware } from '../harness/memory'
import { createPermissionsMiddleware, type PermissionRule } from '../harness/permissions'
import { createSummarizationMiddleware } from '../harness/summarization'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { createVfs, createVfsMiddleware, type VfsStore } from '../backends/vfs'
import type { VfsFile } from '../harness/state'
import { createWindowOps, type WindowPropSpec } from '../tools/windowOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { createSessionStore, type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot } from '../backends/storage'
import { makeId } from '../utils/id'
import { groupRounds, plainSummary } from '../utils/rounds'
import type { AgentMessage, StreamHandler } from '../types'

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
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

export interface PageAgentOptions {
  /** 挂载点(选择器或元素) */
  container: string | HTMLElement
  /** LLM 配置(兼容 OpenAI 协议) */
  llm: LLMConfig
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
  /** 用户自定义工具(与内置工具合并) */
  tools?: StructuredToolInterface[]
  /** 声明式 skill(渐进式披露) */
  skills?: SkillSpec[]
  /** AGENTS.md 风格持久指令(加载时优先于持久化的 memory) */
  memory?: string
  /** window 可操作属性注册表(范围 + schema 校验) */
  windowProps?: WindowPropSpec[]
  /** scope 白名单(默认不启用;启用后对 window/vfs 工具生效) */
  permissions?: PermissionRule[]
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number }
  /** 每个 window 属性最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number
  debug?: boolean
  maxToolRounds?: number
  /** 上下文压缩配置(false 关闭;默认索引摘要零成本) */
  contextOptions?: Partial<ContextManagerOptions> | false
  /** 流式输出(默认 true 逐字流式);false 时等整段回复再显示(底层仍 stream 聚合) */
  streaming?: boolean
  /** 对话框 UI 文案 */
  title?: string
  placeholder?: string
}

export interface PageAgent {
  /** 渲染对话框到 container(异步:含持久化恢复) */
  mount(): Promise<void>
  /** 卸载(shareContext 时仅减引用计数,归零才真销毁) */
  unmount(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化) */
  send(message: string): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  /** 切换到指定会话(载入其上下文);不传 id 则新建。返回新会话 id。storage 未开启时抛错 */
  switchSession(sessionId?: string): Promise<string>
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
  applySnapshot(snap: SessionSnapshot): void
  afterRound(): void
  send(message: string): Promise<string>
  switchSession(sessionId?: string): Promise<string>
  stream: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  /** 实例 unmount 时调;引用计数归零才真销毁(store.dispose + 移出注册表) */
  release(): void
}

/** shareContext 注册表:agentId → AgentCore(同页同 id 复用) */
const sharedCores = new Map<string, AgentCore>()

/** 构建一个独立的核心上下文(含持久化恢复 + agent 构造 + 操作函数) */
function buildCore(options: PageAgentOptions, agentId: string): AgentCore {
  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[page-agent][storage]', e))
  }

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

  const middlewares = [
    todosMw,
    createSkillsMiddleware(options.skills || []),
    createVfsMiddleware(vfsStore),
    createSummarizationMiddleware(options.contextOptions === false ? undefined : options.contextOptions),
    memoryMw,
    ...(options.permissions?.length ? [createPermissionsMiddleware(options.permissions)] : []),
  ]

  const windowOps = createWindowOps(options.windowProps || [], {
    onAudit: options.debug ? (e) => console.log('[page-agent][window audit]', e) : undefined,
    maxSnapshots: options.maxSnapshots,
  })
  const allTools: StructuredToolInterface[] = [...windowOps, ...fetchDocTools, ...(options.tools || [])]

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

    /** 持久化恢复:灌入 messages / vfs / todos / memory(hydrate 不触发 vfs save) */
    applySnapshot(snap: SessionSnapshot): void {
      if (snap.messages?.length) messages.push(...snap.messages)
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.todos?.length) todosMw.reset(snap.todos)
      // memory:options.memory 优先(非空覆盖),否则用持久化的
      if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
    },

    /** 一轮结束后:先裁内存历史(防 OOM),再持久化并立即落盘(防刷新丢 debounce 内待写) */
    afterRound(): void {
      trimMemoryMessages()
      persistRuntime()
      // 立即落盘:不等 500ms debounce,确保刷新前已写入(对话轮次不频繁,可接受每轮一次写)
      if (store) void store.flush()
    },

    async send(message: string): Promise<string> {
      await core.initDone
      messages.push({ role: 'user', content: message, timestamp: Date.now() })
      const reply = await core.agent!.invoke(messages)
      messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
      core.afterRound()
      return reply
    },

    /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
    async switchSession(sessionId?: string): Promise<string> {
      await core.initDone
      if (!store) throw new Error('page-agent: storage 未开启,无法切换会话(请传 storage 选项)')
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

    stream: (msgs, onEvent) => {
      if (!core.agent) throw new Error('page-agent: agent 尚未初始化完成,请先 await mount()')
      return core.agent.stream(msgs, onEvent)
    },

    release(): void {
      core.refCount--
      if (core.refCount <= 0) {
        if (store) {
          vfsStore.flush?.()
          void store.flush()
          store.dispose()
        }
        sharedCores.delete(agentId)
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
      if (sessions.length) {
        core.sessionId = sessions[0].sessionId
        const snap = await store.load(agentId, core.sessionId)
        if (snap) {
          core.applySnapshot(snap)
          if (options.debug) console.log('[page-agent][restore] 恢复会话', core.sessionId, `${snap.messages?.length ?? 0} msgs`)
        }
      } else {
        core.sessionId = await store.createSession(agentId, sessOpts.title)
        if (options.debug) console.log('[page-agent][restore] 新建会话(无历史)', core.sessionId)
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
    void store.save(agentId, core.sessionId, { messages: [...messages] })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    void store.save(agentId, core.sessionId, { todos })
    if (options.debug) console.log('[page-agent][persist] save', core.sessionId, `${messages.length} msgs`)
  }

  // 初始化:解析会话 + 恢复 + 构造 agent(异步,不阻塞 buildCore 返回)
  core.initDone = (async (): Promise<void> => {
    await resolveAndLoad()
    core.agent = createAgent({
      apiKey: options.llm.apiKey,
      baseUrl: options.llm.baseUrl,
      model: options.llm.model,
      temperature: options.llm.temperature,
      maxTokens: options.llm.maxTokens,
      systemPrompt: options.systemPrompt,
      tools: allTools,
      middleware: middlewares,
      maxToolRounds: options.maxToolRounds,
      debug: options.debug,
    })
  })()

  return core
}

export function createPageAgent(options: PageAgentOptions): PageAgent {
  // ===== agent 实例 id(多共存隔离)=====
  const agentId: string = options.id ?? makeId()
  if (!options.id) {
    console.warn(
      `[page-agent] 未传 options.id,已生成随机 id "${agentId}"。刷新后持久化数据无法恢复,请传稳定 id。`,
    )
  }
  // 流式输出(默认 true 逐字);false 时 ChatDialog 走非流式 fetchResponse(等整段)
  const streaming = options.streaming ?? true

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
    const el =
      typeof options.container === 'string' ? document.querySelector(options.container) : options.container
    if (!el) throw new Error(`createPageAgent: 挂载点未找到(${options.container})`)
    const debugLogsRef = core.agent!.debugLogs
    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ChatDialog, {
            fetchStream: streaming ? core.agent!.stream : undefined,
            fetchResponse: streaming ? undefined : (msgs: AgentMessage[]) => core.agent!.invoke(msgs),
            title: options.title,
            placeholder: options.placeholder,
            debugLogs: debugLogsRef.value,
            initialMessages: core.messages,
            onPersist: () => core.afterRound(),
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
  }
}
