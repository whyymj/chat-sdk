<script setup lang="ts">
/**
 * MCP 集成示例 —— chat-sdk 连本地 mock MCP server,调用其工具。
 *
 * 运行(两个进程):
 *   1. npm run mcp:mock          → mock MCP server @ http://localhost:3001/mcp
 *   2. npm run dev               → 访问 http://localhost:3000/mcp.html
 *
 * 对话框里问「北京天气 / 搜索 AI / 算 12*8」→ Agent 调用 MCP server 的工具。
 * 打开「日志」→「🧬 Agent 信息」tab 可见 MCP 注入的 3 个工具(get_weather/search/calc)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'mcp-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // 连本地 mock MCP server(须先 npm run mcp:mock)
    mcp: [{ transport: 'http', url: 'http://localhost:3001/mcp', name: 'mock' }],
    systemPrompt:
      '你可以调用 MCP server(mock)提供的工具:get_weather(查天气)/ search(搜索)/ calc(计算)。用户问相关问题时主动调用对应工具,基于结果回答。',
    debug: true,
    title: 'MCP 集成示例',
    placeholder: '试试:北京天气 / 搜索 AI / 算 12*8',
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🔌 MCP 集成示例</h2>
      <p class="hint">
        chat-sdk 连本地 mock MCP server,动态注入其工具(<code>get_weather</code> / <code>search</code> /
        <code>calc</code>),Agent 按需调用。
      </p>
      <div class="steps">
        <div class="step">
          <b>① 启动 mock MCP server</b>
          <code>npm run mcp:mock</code>
          <span class="muted">→ http://localhost:3001/mcp</span>
        </div>
        <div class="step">
          <b>② 访问本页</b>
          <span class="muted">已在此页(对话框连了 mock server)</span>
        </div>
        <div class="step">
          <b>③ 对话测试</b>
          <span class="muted">问「北京天气」「搜索 AI」「算 12*8」→ 看 Agent 调 MCP 工具</span>
        </div>
        <div class="step">
          <b>④ 查看注入的工具</b>
          <span class="muted">对话框「日志」→「🧬 Agent 信息」tab → tools 列表含 MCP 工具</span>
        </div>
      </div>
      <p class="try">⚠️ 若工具未注入:确认 <code>npm run mcp:mock</code> 在跑(控制台会有 MCP 连接失败 warn)。</p>
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
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 16px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.steps { display: flex; flex-direction: column; gap: 10px; }
.step { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
.step b { display: block; color: #1f2937; margin-bottom: 4px; }
.step code { display: inline-block; background: #1f2937; color: #e5e7eb; padding: 4px 10px; border-radius: 6px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; margin: 2px 0; }
.muted { color: #9ca3af; font-size: 12px; }
.try { font-size: 12px; color: #92400e; background: #fef3c7; padding: 10px 14px; border-radius: 8px; margin-top: 16px; line-height: 1.6; }
.try code { background: rgba(0,0,0,0.08); padding: 1px 6px; border-radius: 4px; }
</style>
