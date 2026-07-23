/**
 * 框架无关 SDK 入口 —— createPageAgent
 *
 * 组装:harness(createAgent)+ 内置中间件(todos/skills/vfs/memory/permissions)
 *   + 内置工具(window 操作/fetch 文档)+ 用户工具/skills/memory/windowProps
 *   + 持久化(IndexedDB,降级内存;多 agent id 隔离;全局配额/LRU 淘汰)
 * 对外命令式 API:mount(container) / unmount() / send(message)。
 * 内部用 Vue 渲染 ChatDialog(打包进 SDK,使用者无需安装 Vue)。
 *
 * 持久化模型:三层命名空间 DB→agentId→sessionId。
 *   - send() 与 mount()(经 useChat)共享同一响应式 messages 数组(唯一来源)。
 *   - mount 异步:await 持久化恢复 → 构造 agent → 渲染。
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
import { createVfs, createVfsMiddleware } from '../backends/vfs'
import type { VfsFile } from '../harness/state'
import { createWindowOps, type WindowPropSpec } from '../tools/windowOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { createSessionStore, type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot } from '../backends/storage'
import { makeId } from '../utils/id'
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
  /** 虚拟工作区初始文件 */
  vfs?: { initialFiles?: Record<string, string> }
  /** 每个 window 属性最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  debug?: boolean
  maxToolRounds?: number
  /** 上下文压缩配置(false 关闭;默认索引摘要零成本) */
  contextOptions?: Partial<ContextManagerOptions> | false
  /** 对话框 UI 文案 */
  title?: string
  placeholder?: string
}

export interface PageAgent {
  /** 渲染对话框到 container(异步:含持久化恢复) */
  mount(): Promise<void>
  /** 卸载 */
  unmount(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化) */
  send(message: string): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
}

/** 解析 storage 选项 → SessionStore | null(undefined/false/未传 关闭;字符串/对象 开启) */
function resolveStorage(storage: StorageBackendType | StorageConfig | false | undefined): SessionStore | null {
  if (storage === undefined || storage === false) return null
  if (typeof storage === 'string') return createSessionStore({ backend: storage })
  if (storage.enabled === false) return null
  return createSessionStore(storage)
}

export function createPageAgent(options: PageAgentOptions): PageAgent {
  // ===== agent 实例 id(多共存隔离;const 保闭包内 narrowing)=====
  const agentId: string = options.id ?? makeId()
  if (!options.id) {
    console.warn(
      `[page-agent] 未传 options.id,已生成随机 id "${agentId}"。刷新后持久化数据无法恢复,请传稳定 id。`,
    )
  }

  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[page-agent][storage]', e))
  }

  // ===== 共享 messages(send/mount 唯一来源)=====
  const messages = reactive<AgentMessage[]>([])
  let currentSessionId = ''

  // ===== vfs + 中间件(保留可 reset 的引用以便恢复注入)=====
  // vfs 变更 → debounce 落盘到当前会话
  const vfsSave = (files: Record<string, VfsFile>): void => {
    if (currentSessionId && store) void store.save(agentId, currentSessionId, { vfs: files })
  }
  const vfsStore = createVfs(options.vfs?.initialFiles, store ? { persist: { save: vfsSave } } : {})

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

  let agent: ReturnType<typeof createAgent> | null = null

  /** 持久化恢复:灌入共享 messages / vfs / todos / memory(hydrate 不触发 vfs save) */
  function applySnapshot(snap: SessionSnapshot): void {
    if (snap.messages?.length) messages.push(...snap.messages)
    if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
    if (snap.todos?.length) todosMw.reset(snap.todos)
    // memory:options.memory 优先(非空覆盖),否则用持久化的
    if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
  }

  /** 解析会话 id + 载入快照(仅 store 非 null 时) */
  async function resolveAndLoad(): Promise<void> {
    if (!store) return
    await store.ready
    const sessOpts = options.session || {}
    if (sessOpts.id) {
      currentSessionId = sessOpts.id
      const snap = await store.load(agentId, currentSessionId)
      if (snap) applySnapshot(snap)
      else await store.createSession(agentId, sessOpts.title, currentSessionId)
    } else if (sessOpts.autoResume !== false) {
      const sessions = await store.listSessions(agentId)
      if (sessions.length) {
        currentSessionId = sessions[0].sessionId
        const snap = await store.load(agentId, currentSessionId)
        if (snap) applySnapshot(snap)
      } else {
        currentSessionId = await store.createSession(agentId, sessOpts.title)
      }
    } else {
      currentSessionId = await store.createSession(agentId, sessOpts.title)
    }
    // options.memory 落盘(每次启动确保持久化;加载时 options 优先已在 applySnapshot 处理)
    if (options.memory) void store.save(agentId, currentSessionId, { memory: options.memory })
  }

  // 初始化:解析会话 + 恢复 + 构造 agent(异步,不阻塞 createPageAgent 返回)
  const initDone = (async (): Promise<void> => {
    await resolveAndLoad()
    agent = createAgent({
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

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    if (!currentSessionId || !store) return
    void store.save(agentId, currentSessionId, { messages: [...messages] })
    const todos = agent?.getState?.()?.todos
    if (todos?.length) void store.save(agentId, currentSessionId, { todos })
  }

  let vueApp: VueApp | null = null
  let flushHandler: (() => void) | null = null
  let visHandler: (() => void) | null = null

  async function mount(): Promise<void> {
    await initDone
    const el =
      typeof options.container === 'string' ? document.querySelector(options.container) : options.container
    if (!el) throw new Error(`createPageAgent: 挂载点未找到(${options.container})`)
    const debugLogsRef = agent!.debugLogs
    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(ChatDialog, {
            fetchStream: agent!.stream,
            title: options.title,
            placeholder: options.placeholder,
            debugLogs: debugLogsRef.value,
            initialMessages: messages,
            onPersist: () => persistRuntime(),
            onClear: () => {
              // 新建会话:同步生成 id + 重置内存态(vfs/todos/memory),防旧会话数据残留或污染新会话
              if (!store) return
              currentSessionId = makeId()
              vfsStore.clear?.()
              todosMw.reset([])
              if (!options.memory) memoryMw.reset('')
              void store.createSession(agentId, options.session?.title, currentSessionId)
            },
          })
      },
    })
    vueApp = createApp(Wrapper)
    vueApp.mount(el)

    // 刷新/切页兜底 flush(防丢 debounce 内的待写)
    if (store) {
      flushHandler = () => {
        vfsStore.flush?.() // vfs 自身的 800ms debounce 窗口也要立即落盘
        void store.flush()
      }
      visHandler = () => {
        if (document.visibilityState === 'hidden') void store.flush()
      }
      window.addEventListener('pagehide', flushHandler)
      document.addEventListener('visibilitychange', visHandler)
    }
  }

  function unmount(): void {
    if (store) {
      vfsStore.flush?.()
      void store.flush()
      store.dispose()
      if (flushHandler) window.removeEventListener('pagehide', flushHandler)
      if (visHandler) document.removeEventListener('visibilitychange', visHandler)
    }
    vueApp?.unmount()
    vueApp = null
  }

  async function send(message: string): Promise<string> {
    await initDone
    messages.push({ role: 'user', content: message, timestamp: Date.now() })
    const reply = await agent!.invoke(messages)
    messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
    persistRuntime()
    return reply
  }

  return {
    mount,
    unmount,
    send,
    stream: (msgs, onEvent) => {
      if (!agent) throw new Error('page-agent: agent 尚未初始化完成,请先 await mount()')
      return agent.stream(msgs, onEvent)
    },
  }
}
