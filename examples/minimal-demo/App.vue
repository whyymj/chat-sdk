<script setup lang="ts">
/**
 * 最简集成 demo:无 schema / 无 data / 无 approval,纯对话对话框。
 * 适合「我只想给页面加个 AI 对话框,不操作页面数据」的最简场景。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    id: 'minimal-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt: '你是一个智能助手,简洁回答用户问题。',
    storage: 'memory',
    dialog: {
      title: '最简 AI 对话框',
      placeholder: '问我任何问题...',
    },
  })
  agent.mount('#chat-root')
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>最简集成</h1>
    <p>无 schema / 无 data / 无 approval —— 纯对话对话框,5 行集成。</p>
    <p>适合「我只想给页面加个 AI 对话框,不操作页面数据」的最简场景。</p>
    <section id="chat-root" ref="root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 80px auto 0;
  padding: 0 20px;
  font-family: system-ui, sans-serif;
  color: var(--ark-fg);
}
h1 {
  font-size: 24px;
  margin-bottom: 12px;
}
p {
  line-height: 1.6;
  color: var(--ark-muted);
  margin-bottom: 8px;
}
.chat-mount {
  margin-top: 24px;
  height: 600px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}
.chat-mount > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
