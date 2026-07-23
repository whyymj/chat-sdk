/**
 * 对话状态管理 composable(通用)
 *
 * 管理消息列表、loading 状态、错误信息,并提供发送消息的入口。
 * 支持流式(fetchStream)与非流式(fetchResponse)两种模式。纯状态管理,不耦合任何业务工具。
 *
 * messages/onPersist/onClear 为持久化集成预留(由 createPageAgent 注入):
 *  - messages:外部共享响应式数组,与父级共用同一引用(刷新恢复时灌入)
 *  - onPersist:一轮完成后回调(落盘)
 *  - onClear:清空时回调(新建会话)
 */
import { reactive, ref, nextTick } from 'vue'
import type { AgentMessage, AgentState, StreamHandler, ToolStep } from '../types'

type FetchFn = (messages: AgentMessage[]) => Promise<string>
type StreamFn = (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>

export function useChat(
  opts: {
    fetchResponse?: FetchFn
    fetchStream?: StreamFn
    /** 外部共享的消息数组(持久化恢复时传入,与父级共用同一响应式引用) */
    messages?: AgentMessage[]
    /** 一轮对话完成后回调(用于持久化) */
    onPersist?: (messages: AgentMessage[]) => void
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
   * 发送消息:添加用户消息 → 调用 AI → 添加 AI 回复
   * 优先使用流式(fetchStream),否则回退到非流式(fetchResponse / 模拟回复)
   */
  async function sendMessage(content: string) {
    if (!content.trim() || state.loading) return

    addMessage('user', content.trim())
    state.loading = true
    state.error = null

    // 流式模式:先创建占位的 assistant 消息,随事件增量更新
    if (fetchStream) {
      const assistantMsg = reactive({
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
        reasoning: '',
        steps: [] as ToolStep[],
      })
      state.messages.push(assistantMsg)

      try {
        await fetchStream(state.messages.slice(0, -1), (event) => {
          switch (event.type) {
            case 'reasoning':
              assistantMsg.reasoning += event.delta
              break
            case 'text':
              assistantMsg.content += event.delta
              break
            case 'tool_call':
              assistantMsg.steps.push({
                name: event.name,
                args: event.args,
                status: 'running',
              })
              break
            case 'tool_result': {
              // 找到最后一个同名 running 步骤,写入结果
              for (let i = assistantMsg.steps.length - 1; i >= 0; i--) {
                if (assistantMsg.steps[i].name === event.name && assistantMsg.steps[i].status === 'running') {
                  assistantMsg.steps[i].result = event.result
                  assistantMsg.steps[i].status = event.status
                  break
                }
              }
              break
            }
          }
          scrollToBottom()
        })
      } catch (err: any) {
        state.error = err.message || '请求失败,请重试'
        // 失败时移除空占位消息
        if (!assistantMsg.content && !assistantMsg.reasoning) {
          const idx = state.messages.indexOf(assistantMsg)
          if (idx >= 0) state.messages.splice(idx, 1)
        }
      } finally {
        state.loading = false
        onPersist?.(state.messages) // 持久化(含失败态:占位已移除后的真实状态)
      }
      return
    }

    // 非流式模式
    try {
      const fetchFn = fetchResponse || defaultFetch
      const response = await fetchFn(state.messages)
      addMessage('assistant', response)
    } catch (err: any) {
      state.error = err.message || '请求失败,请重试'
    } finally {
      state.loading = false
      onPersist?.(state.messages)
    }
  }

  /** 内置模拟回复(开发调试用,未接入 API 时的 fallback) */
  async function defaultFetch(messages: AgentMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()
    return `收到你的消息:"${lastUserMsg?.content}"。这是一个模拟回复,请接入实际的 AI API。`
  }

  function clearMessages() {
    onClear?.() // 通知父级(如新建会话)
    // 清空:splice 保持共享引用(若 state.messages 与父级共用同一数组)
    state.messages.splice(0, state.messages.length)
    state.error = null
  }

  return { state, scrollContainer, sendMessage, clearMessages }
}
