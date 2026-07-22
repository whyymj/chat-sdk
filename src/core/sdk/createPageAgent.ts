/**
 * 框架无关 SDK 入口 —— createPageAgent
 *
 * 组装:harness(createAgent)+ 内置中间件(todos/skills/vfs/memory/permissions)
 *   + 内置工具(window 操作/fetch 文档)+ 用户工具/skills/memory/windowProps
 * 对外命令式 API:mount(container) / unmount() / send(message)。
 * 内部用 Vue 渲染 ChatDialog(打包进 SDK,使用者无需安装 Vue)。
 */
import { createApp, type App as VueApp } from 'vue'
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
import { createWindowOps, type WindowPropSpec } from '../tools/windowOps'
import { fetchDocTools } from '../tools/fetchDoc'
import type { AgentMessage, StreamHandler } from '../types'

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface PageAgentOptions {
  /** 挂载点(选择器或元素) */
  container: string | HTMLElement
  /** LLM 配置(兼容 OpenAI 协议) */
  llm: LLMConfig
  /** 系统提示词(通用"页面操作助手",可覆盖) */
  systemPrompt?: string
  /** 用户自定义工具(与内置工具合并) */
  tools?: StructuredToolInterface[]
  /** 声明式 skill(渐进式披露) */
  skills?: SkillSpec[]
  /** AGENTS.md 风格持久指令 */
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
  /** 渲染对话框到 container */
  mount(): void
  /** 卸载 */
  unmount(): void
  /** 命令式发送一条消息(内部维护历史) */
  send(message: string): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
}

export function createPageAgent(options: PageAgentOptions): PageAgent {
  // vfs 实例(工具与中间件共享 store.files 引用)
  const vfsStore = createVfs(options.vfs?.initialFiles)

  // window 操作工具(属性注册表 + schema 校验 + 审计)
  const windowOps = createWindowOps(options.windowProps || [], {
    onAudit: options.debug ? (e) => console.log('[page-agent][window audit]', e) : undefined,
    maxSnapshots: options.maxSnapshots,
  })

  // 内置中间件栈(顺序:todos → skills → vfs → summarization → memory → permissions(可选))
  const middlewares = [
    createTodosMiddleware(),
    createSkillsMiddleware(options.skills || []),
    createVfsMiddleware(vfsStore),
    createSummarizationMiddleware(options.contextOptions === false ? undefined : options.contextOptions),
    createMemoryMiddleware(options.memory || ''),
    ...(options.permissions?.length ? [createPermissionsMiddleware(options.permissions)] : []),
  ]

  // 内置工具 + 用户工具
  const allTools: StructuredToolInterface[] = [
    ...windowOps,
    ...fetchDocTools,
    ...(options.tools || []),
  ]

  const agent = createAgent({
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

  // 命令式 send 用的简易历史(内存)
  const history: AgentMessage[] = []
  let vueApp: VueApp | null = null

  function mount(): void {
    const el =
      typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container
    if (!el) throw new Error(`createPageAgent: 挂载点未找到(${options.container})`)
    vueApp = createApp(ChatDialog, {
      fetchStream: agent.stream,
      title: options.title,
      placeholder: options.placeholder,
      debugLogs: agent.debugLogs,
    })
    vueApp.mount(el)
  }

  function unmount(): void {
    vueApp?.unmount()
    vueApp = null
  }

  async function send(message: string): Promise<string> {
    history.push({ role: 'user', content: message, timestamp: Date.now() })
    const reply = await agent.invoke(history)
    history.push({ role: 'assistant', content: reply, timestamp: Date.now() })
    return reply
  }

  return { mount, unmount, send, stream: agent.stream }
}
