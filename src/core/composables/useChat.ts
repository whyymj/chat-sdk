/**
 * 对话状态管理 composable(通用)
 *
 * 管理消息列表、loading 状态、错误信息,并提供发送消息的入口。
 * 支持流式(fetchStream)与非流式(fetchResponse)两种模式。纯状态管理,不耦合任何业务工具。
 */
import { reactive, ref, nextTick } from 'vue'
import type { AgentMessage, AgentState, StreamHandler, ToolStep } from '../types'

type FetchFn = (messages: AgentMessage[]) => Promise<string>
type StreamFn = (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>

export function useChat(opts: { fetchResponse?: FetchFn; fetchStream?: StreamFn } = {}) {
  const { fetchResponse, fetchStream } = opts

  /** 对话状态:消息列表 + loading + 错误 */
  const state = reactive<AgentState>({
    messages: [],
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
    }
  }

  /** 内置模拟回复(开发调试用,未接入 API 时的 fallback) */
  async function defaultFetch(messages: AgentMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()
    return `收到你的消息:"${lastUserMsg?.content}"。这是一个模拟回复,请接入实际的 AI API。`
  }

  function clearMessages() {
    state.messages = []
    state.error = null
  }

  return { state, scrollContainer, sendMessage, clearMessages }
}
