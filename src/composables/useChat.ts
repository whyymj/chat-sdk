import { reactive, ref, nextTick } from 'vue'
import type { AgentMessage, AgentState } from '../types'

type FetchFn = (messages: AgentMessage[]) => Promise<string>

export function useChat(customFetch?: FetchFn) {
  const state = reactive<AgentState>({
    messages: [],
    loading: false,
    error: null,
  })

  const scrollContainer = ref<HTMLElement | null>(null)

  function scrollToBottom() {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
      }
    })
  }

  function addMessage(role: AgentMessage['role'], content: string) {
    state.messages.push({
      role,
      content,
      timestamp: Date.now(),
    })
    scrollToBottom()
  }

  async function sendMessage(content: string) {
    if (!content.trim() || state.loading) return

    addMessage('user', content.trim())
    state.loading = true
    state.error = null

    try {
      const fetchFn = customFetch || defaultFetch
      const response = await fetchFn(state.messages)
      addMessage('assistant', response)
    } catch (err: any) {
      state.error = err.message || '请求失败，请重试'
    } finally {
      state.loading = false
    }
  }

  async function defaultFetch(messages: AgentMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()
    return `收到你的消息："${lastUserMsg?.content}"。这是一个模拟回复，请接入实际的 AI API。`
  }

  function clearMessages() {
    state.messages = []
    state.error = null
  }

  return {
    state,
    scrollContainer,
    sendMessage,
    clearMessages,
  }
}
