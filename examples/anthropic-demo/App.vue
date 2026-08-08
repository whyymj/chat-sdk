<script setup lang="ts">
/**
 * Anthropic Claude demo —— `llm.provider: 'anthropic'` 走 Claude 原生协议(动态 import @langchain/anthropic)。
 *
 * 与 minimal-demo(OpenAI/DeepSeek 协议)的区别仅 llm 配置加 `provider: 'anthropic'`,其余 API 完全一致。
 * 展示:Anthropic 流式文本逐字 + extended thinking(reasoning 区,若模型支持)。
 * 前置:.env 配 `VITE_AI_API_KEY`(Anthropic key)+ `VITE_AI_MODEL`(claude-* 系列)。
 *   可选 `VITE_AI_BASE_URL`(自建网关 / modelverse 代理);不配走官方 api.anthropic.com。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    id: 'anthropic-demo',
    llm: {
      provider: 'anthropic',                                              // 走 Claude 原生协议(缺省 'openai' = OpenAI/DeepSeek,向后兼容)
      apiKey: import.meta.env.VITE_AI_API_KEY,
      model: import.meta.env.VITE_AI_MODEL || 'claude-sonnet-4-5-20250929',
      baseUrl: import.meta.env.VITE_AI_BASE_URL,                          // 可选(自建网关 / 代理;不配走官方)
    },
    systemPrompt: '你是 Claude,一个由 Anthropic 训练的 AI 助手。简洁回答用户问题。',
    storage: 'memory',
    dialog: {
      title: 'Anthropic Claude 对话',
      placeholder: '问我任何问题(Claude)...',
    },
  })
  agent.mount('#chat-root')
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>Anthropic Claude</h1>
    <p><code>llm.provider: 'anthropic'</code> 走 Claude 原生协议(动态加载 <code>@langchain/anthropic</code>,optional peer —— 不用 Anthropic 的项目零影响)。</p>
    <p>展示 Anthropic 流式文本逐字 + extended thinking(reasoning 区)。需 <code>.env</code> 配 <code>VITE_AI_API_KEY</code>(Anthropic key)+ <code>VITE_AI_MODEL</code>(claude-*)。</p>
    <section id="chat-root" ref="root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page { max-width: 800px; margin: 80px auto 0; padding: 0 20px; font-family: system-ui, sans-serif; color: var(--ark-fg); }
h1 { font-size: 24px; margin-bottom: 12px; }
p { line-height: 1.6; color: var(--ark-muted); margin-bottom: 8px; }
code { background: rgba(108, 92, 231, 0.18); color: #b9a9ff; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
.chat-mount { margin-top: 24px; height: 600px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; overflow: hidden; }
.chat-mount > :deep(.chat-dialog) { width: 100%; height: 100%; }
</style>
