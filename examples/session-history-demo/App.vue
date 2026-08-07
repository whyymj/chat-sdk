<script setup lang="ts">
/**
 * 会话历史管理 demo —— 零配置:会话管理 UI(新建/历史/列表)全内置 ChatDialog(storage 开即默认)
 *
 * 架构:SDK Phase 6(sessions 响应式 + switchSession/deleteSession 自动 refresh)+
 * ChatDialog 内置会话管理(sessions 注入 → 默认显示新建/历史按钮 + 历史面板)。
 * App.vue 只 createChatSdk + storage,无需任何会话管理代码(零样板)。
 */
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { createChatSdk, z, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  theme: z.enum(['light', 'dark']).describe('主题'),
})
const pageObj = { title: '示例页面', theme: 'light' as 'light' | 'dark' }
;(window as any).page = pageObj

const root = ref<HTMLElement>()
const agent = shallowRef<ChatSdk | null>(null)

onMounted(() => {
  const sdk = createChatSdk({
    container: root.value!,
    id: 'session-history-demo',
    storage: 'indexed',          // ← 开启 → ChatDialog 内置「新建/历史」按钮 + 历史面板(零配置)
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    data: { schema: pageSchema, bind: pageObj },
    systemPrompt: '你是页面助手。可改 window.page 的 title / theme。',
    debug: true,
    dialog: { title: '方舟专题', placeholder: '改标题 / 切主题 …' },
  })
  agent.value = sdk
  sdk.mount()
})
onUnmounted(() => agent.value?.unmount())
</script>

<template>
  <DevNav />
  <div class="ark-chat">
    <section ref="root" class="main"></section>
  </div>
</template>

<style scoped>
.ark-chat { position: fixed; inset: 0; background: var(--ark-bg); }
.main { width: 100%; height: 100%; }
.main > :deep(.chat-dialog) { width: 100%; height: 100%; }
/* ChatDialog 头部跟深色紫主题(标题/按钮);历史面板走 --cs-bubble-ai(已在 main.css 覆盖为深色) */
.ark-chat :deep(.chat-header) { background: var(--ark-panel); border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.ark-chat :deep(.chat-header .header-title) { color: var(--ark-fg); }
</style>
