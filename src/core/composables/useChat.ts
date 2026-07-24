/**
 * 对话状态管理 composable(通用)
 *
 * 管理消息列表、loading 状态、错误信息,并提供发送消息的入口。
 * 支持流式(fetchStream)与非流式(fetchResponse)两种模式。纯状态管理,不耦合任何业务工具。
 *
 * messages/onPersist/onClear 为持久化集成预留(由 createChatSdk 注入):
 *  - messages:外部共享响应式数组,与父级共用同一引用(刷新恢复时灌入)
 *  - onPersist:一轮完成后回调(落盘)
 *  - onClear:清空时回调(新建会话)
 *
 * sendMessage / regenerate 共用 runAssistantStream:前者先 push user,后者移除旧 assistant 后以历史重发。
 */
import { reactive, ref, nextTick } from 'vue'
import type { AgentMessage, AgentState, StreamHandler, ToolStep } from '../types'
import { isAbort } from '../harness/retry'

type FetchFn = (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>
type StreamFn = (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>

export function useChat(
  opts: {
    fetchResponse?: FetchFn
    fetchStream?: StreamFn
    /** 外部共享的消息数组(持久化恢复时传入,与父级共用同一响应式引用) */
    messages?: AgentMessage[]
    /** 一轮对话完成后回调(用于持久化);可返回 Promise,sendMessage 会 await 确保落盘后再关 loading */
    onPersist?: (messages: AgentMessage[]) => void | Promise<void>
    /** 清空对话时回调(用于新建会话) */
    onClear?: () => void
  } = {},
) {
  const { fetchResponse, fetchStream, onPersist, onClear } = opts

  /** 对话状态:消息列表 + loading + 错误(messages 可与父级共享同一引用) */
  const state = reactive<AgentState>({
    messages: (opts.messages ?? []) as AgentMessage[],
    loading: false,
    error: null,
  })

  /** 消息列表容器 DOM 引用,用于自动滚动 */
  const scrollContainer = ref<HTMLElement | null>(null)

  /** 当前生成的 AbortController(stop() 中止用;每次 sendMessage/regenerate 新建,停止不影响后续发送) */
  let currentController: AbortController | null = null

  function scrollToBottom() {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  }

  function addMessage(role: AgentMessage['role'], content: string) {
    state.messages.push({ role, content, timestamp: Date.now() })
    scrollToBottom()
  }

  /**
   * 跑一轮 assistant 生成(sendMessage / regenerate 共用)。
   * 历史已含待回复的最后一条 user;占位 assistant push 到末尾,fetchStream 传 slice(0,-1) = 历史。
   * 流式优先,否则非流式 fallback。abort 不计入 error;失败移除空占位。
   */
  async function runAssistantStream(signal: AbortSignal) {
    if (fetchStream) {
      const assistantMsg = reactive({
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
        reasoning: '',
        steps: [] as ToolStep[],
      })
      // 轮次分隔:多轮工具循环中模型每轮的 text/reasoning 直接拼接会连成一段("我来查一下根据结果…"),
      // 在 round>1 的首个 delta 前插一个换行,保持轮次边界可读
      let pendingSep = false
      state.messages.push(assistantMsg)
      try {
        await fetchStream(state.messages.slice(0, -1), (event) => {
          switch (event.type) {
            case 'round_start':
              if (event.round > 1 && (assistantMsg.content || assistantMsg.reasoning)) pendingSep = true
              break
            case 'reasoning':
              if (pendingSep) { assistantMsg.reasoning += '\n'; pendingSep = false }
              assistantMsg.reasoning += event.delta
              break
            case 'text':
              if (pendingSep) { assistantMsg.content += '\n'; pendingSep = false }
              assistantMsg.content += event.delta
              break
            case 'tool_call':
              assistantMsg.steps.push({ name: event.name, args: event.args, status: 'running' })
              break
            case 'tool_result': {
              for (let i = assistantMsg.steps.length - 1; i >= 0; i--) {
                if (assistantMsg.steps[i].name === event.name && assistantMsg.steps[i].status === 'running') {
                  assistantMsg.steps[i].result = event.result
                  assistantMsg.steps[i].status = event.status
                  break
                }
              }
              break
            }
            case 'subagent': {
              const spawnStep = assistantMsg.steps[assistantMsg.steps.length - 1]
              if (!spawnStep) break
              if (!spawnStep.children) spawnStep.children = []
              const fullName = event.label ? `[${event.label}] ${event.name}` : event.name
              if (event.kind === 'tool_call') {
                spawnStep.children.push({ name: fullName, args: event.args, status: 'running' })
              } else {
                for (let i = spawnStep.children.length - 1; i >= 0; i--) {
                  if (spawnStep.children[i].status === 'running' && spawnStep.children[i].name === fullName) {
                    spawnStep.children[i].result = event.result
                    spawnStep.children[i].status = event.status || 'done'
                    break
                  }
                }
              }
              break
            }
          }
          scrollToBottom()
        }, signal)
      } catch (err: any) {
        if (!isAbort(err, signal)) state.error = err.message || '请求失败,请重试'
        // 失败/abort 时移除空占位(已生成内容则保留)
        if (!assistantMsg.content && !assistantMsg.reasoning) {
          const idx = state.messages.indexOf(assistantMsg)
          if (idx >= 0) state.messages.splice(idx, 1)
        }
      } finally {
        await onPersist?.(state.messages)
        state.loading = false
        currentController = null
      }
      return
    }

    // 非流式模式
    try {
      const fetchFn = fetchResponse || defaultFetch
      const response = await fetchFn(state.messages, signal)
      addMessage('assistant', response)
    } catch (err: any) {
      if (!isAbort(err, signal)) state.error = err.message || '请求失败,请重试'
    } finally {
      await onPersist?.(state.messages)
      state.loading = false
      currentController = null
    }
  }

  /**
   * 发送消息:添加用户消息 → 跑 assistant 生成。
   * 每次新建 AbortController;stop() 可中止,abort 不计入 error。
   */
  async function sendMessage(content: string) {
    if (!content.trim() || state.loading) return
    addMessage('user', content.trim())
    state.loading = true
    state.error = null
    currentController = new AbortController()
    await runAssistantStream(currentController.signal)
  }

  /** 重新生成最后一条 assistant 回复:移除它(及尾部)→ 以当前历史(含最后 user)重发 */
  async function regenerate() {
    if (state.loading) return
    const msgs = state.messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs.splice(i) // 移除该 assistant 及其后所有
        break
      }
    }
    // 需有 user 可重发
    if (!msgs.some((m) => m.role === 'user')) return
    state.loading = true
    state.error = null
    currentController = new AbortController()
    await runAssistantStream(currentController.signal)
  }

  /** 内置模拟回复(开发调试用,未接入 API 时的 fallback) */
  async function defaultFetch(messages: AgentMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()
    return `收到你的消息:"${lastUserMsg?.content}"。这是一个模拟回复,请接入实际的 AI API。`
  }

  function clearMessages() {
    onClear?.()
    state.messages.splice(0, state.messages.length)
    state.error = null
  }

  /** 停止当前生成(abort) */
  function stop() {
    currentController?.abort()
  }

  /** 重试最后一条用户消息:移除其后所有消息(失败占位),清错误,重发 */
  async function retry() {
    if (!state.error) return // 仅出错时重试
    const msgs = state.messages
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return
    const content = msgs[lastUserIdx].content
    msgs.splice(lastUserIdx) // 移除该 user 及其后所有消息(失败的 assistant 占位)
    state.error = null
    await sendMessage(content)
  }

  return { state, scrollContainer, sendMessage, clearMessages, stop, retry, regenerate }
}
