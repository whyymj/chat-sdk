<script setup lang="ts">
/**
 * Headless 模式 demo:ui:false 不渲染内置 ChatDialog,
 * 用 sdk.messages(响应式)+ sdk.send 自建极简 UI。
 * 适合「我要完全控制 UI」的场景(自定义样式 / 嵌入现有界面 / 非 Vue 项目)。
 */
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { createChatSdk, type ChatSdk, type AgentMessage } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

const messages = ref<AgentMessage[]>([])
const input = ref('')
const sending = ref(false)
const logEl = ref<HTMLElement>()

async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  sending.value = true
  try {
    await agent!.send(text)
  } finally {
    sending.value = false
    await nextTick()
    logEl.value?.scrollTo({ top: logEl.value.scrollHeight, behavior: 'smooth' })
  }
}

function roleLabel(m: AgentMessage): string {
  if (m.role === 'user') return '你'
  if (m.role === 'assistant') return 'AI'
  if (m.role === 'tool') return '🔧'
  return m.role
}

onMounted(() => {
  agent = createChatSdk({
    id: 'headless-demo',
    ui: false, // headless:不渲染内置 ChatDialog
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt: '你是一个智能助手,简洁回答。',
  })
  // 共享同一响应式 messages 数组 —— 自建 UI 直接渲染它
  messages.value = agent.messages
  agent.mount() // headless mount 只 init agent,不渲染 UI
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>Headless 模式</h1>
    <p><code>ui: false</code> 不渲染内置 ChatDialog,用 <code>sdk.messages</code> + <code>sdk.send</code> 自建极简 UI。</p>
    <p>适合「我要完全控制 UI」的场景(自定义样式 / 嵌入现有界面 / 非 Vue 项目)。</p>

    <section ref="root" class="chat-mount"></section>

    <div class="custom-ui">
      <div ref="logEl" class="msg-log">
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg--${m.role}`">
          <span class="msg__role">{{ roleLabel(m) }}</span>
          <span class="msg__content">{{ m.content }}</span>
        </div>
        <div v-if="messages.length === 0" class="empty">说点什么吧...</div>
      </div>
      <div class="input-bar">
        <input
          v-model="input"
          :disabled="sending"
          placeholder="输入消息,回车发送..."
          @keydown.enter="send"
        />
        <button :disabled="sending || !input.trim()" @click="send">
          {{ sending ? '发送中...' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 80px auto 0;
  padding: 0 20px;
  font-family: system-ui, sans-serif;
  color: #333;
}
h1 {
  font-size: 24px;
  margin-bottom: 12px;
}
p {
  line-height: 1.6;
  color: #666;
  margin-bottom: 8px;
}
code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}
.chat-mount {
  margin-top: 24px;
  min-height: 0;
}
.custom-ui {
  margin-top: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 460px;
}
.msg-log {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
}
.msg {
  margin-bottom: 12px;
  line-height: 1.5;
}
.msg__role {
  display: inline-block;
  min-width: 32px;
  font-weight: 600;
  color: #888;
  margin-right: 8px;
}
.msg--user .msg__role {
  color: #2563eb;
}
.msg--assistant .msg__role {
  color: #16a34a;
}
.msg__content {
  white-space: pre-wrap;
  word-break: break-word;
}
.empty {
  color: #aaa;
  text-align: center;
  padding: 40px 0;
}
.input-bar {
  display: flex;
  border-top: 1px solid #e0e0e0;
  padding: 12px;
  background: #fff;
  gap: 8px;
}
.input-bar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}
.input-bar input:focus {
  border-color: #2563eb;
}
.input-bar button {
  padding: 8px 20px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.input-bar button:disabled {
  background: #aaa;
  cursor: not-allowed;
}
</style>
