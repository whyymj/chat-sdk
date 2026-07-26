<script setup lang="ts">
/**
 * 工具分离演示 —— 手动注入工具集(替代默认自动装配)
 *
 * 默认 createChatSdk 按 capabilities 自动装 dataOps + fetchDoc(零配置)。
 * 本 demo 展示「手动注入」:关闭默认自动装配(capabilities),改用 tools 手动组合(散工具 / 展开的预设数组);
 * 也演示 createDataOps / fetchDocTools 的独立导出(按 tools 自由拼装)。
 * 适合「主要业务工具集单独引入、按需组合」的进阶用法。
 *
 * 运行:npm run dev → 访问 /toolsets.html
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  createChatSdk,
  defineTool,
  defineDataToolset,
  fetchTools,
  z,
  type ChatSdk,
} from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

// 声明主数据对象(单对象 + schema 校验);bind 直连普通 notes 数组(非 reactive;模板不读 notes,无需 tick)
const notesObj: string[] = []
const data = { schema: z.array(z.string()), bind: notesObj, description: '调研笔记' }

// 自定义工具:模拟文档搜索(真实场景换成你的 API)
const search = defineTool({
  name: 'search_docs',
  description: '搜索技术文档(模拟)',
  schema: z.object({ q: z.string() }),
  handler: ({ q }) => `关于「${q}」的文档:① 入门指南 ② 最佳实践 ③ 常见坑(模拟结果)`,
})

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'toolsets-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是文档调研助手。用 search_docs 搜索、fetch_document 抓取网页;结论可写入主数据(调研笔记数组)。',
    // 自定义 systemPrompt → 自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);不传 systemPrompt 用默认时已内置,此项可省
    appendReliableWriteRules: true,
    data,
    // ↓ 工具分离:关闭默认自动装配,改用 tools 手动组合(散工具 / 展开的预设数组)
    capabilities: { dataOps: false, fetch: false },
    tools: [
      ...defineDataToolset(data), // 手动注入 数据工具集(展开数组)
      ...fetchTools, // 手动注入 fetch_document
      search, // 业务自定义工具
    ],
    debug: true,
    title: '工具分离 · 手动注入',
    placeholder: '试试:搜一下 SSR,把要点记到笔记里',
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🧰 工具分离演示</h2>
      <p class="hint">
        默认 <code>createChatSdk</code> 按 <code>capabilities</code> 自动装 dataOps + fetch(零配置)。
        本 demo 展示<strong>手动注入</strong>:关闭默认自动装配,改用 <code>tools</code> 手动组合(散工具 / 展开预设数组)。
      </p>
      <pre v-pre class="code">capabilities: { dataOps: false, fetch: false }
tools: [
  ...defineDataToolset(data),  // 手动注入 数据工具集
  ...fetchTools,               // 手动注入 fetch_document
  search_docs,                 // 业务自定义工具
]</pre>
      <p class="hint">
        ▶ 打开「日志 / Agent 信息」tab:工具池只有<strong>手动注入的</strong>(dataOps + fetch_document + search_docs)。
        planning / skills / vfs / subagent 仍开(可经 <code>capabilities</code> 进一步关,省 token)。
      </p>
      <p class="hint muted">
        进阶:也可 <code>import { createDataOps, fetchDocTools }</code> 独立拿到工具数组,
        按 <code>tools</code> 自由拼装(不经 toolset 封装)。
      </p>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: #f5f7fa; padding: 28px 32px; }
.pane-right { flex: 0 0 460px; border-left: 1px solid #e5e7eb; background: #fff; }
.pane-right > :deep(.chat-dialog) { width: 100%; height: 100%; }
h2 { font-size: 20px; margin: 0 0 12px; color: #1f2937; }
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 12px; }
.hint code { background: #eef2ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.hint.muted { color: #9ca3af; }
.hint.muted code { background: #f3f4f6; color: #6b7280; }
.code { background: #1f2937; color: #e5e7eb; padding: 12px 14px; border-radius: 8px; font-size: 12px; line-height: 1.6; font-family: 'SF Mono', Monaco, Consolas, monospace; overflow-x: auto; margin: 0 0 12px; }
</style>
