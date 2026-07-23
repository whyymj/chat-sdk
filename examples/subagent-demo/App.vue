<script setup lang="ts">
/**
 * 子 Agent 并行编排示例
 *
 * 主 agent 遇到多方案对比时,用 spawn_agents 并行委派多个子 agent 各调研一个方案,
 * 再汇总。右侧对话框会在 spawn 步骤下【嵌套显示每个子 agent 的工具调用进度】
 * (子 agent 过程不进入主上下文,只在此展示)。
 *
 * 运行:npm run dev → 访问 /subagent.html
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createPageAgent, defineTool, z, type PageAgent } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

// 模拟三个「方案」(子 agent 并行调研的对象;真实场景可换成 API/数据库/文档源)
const SOURCES: Record<'A' | 'B' | 'C', { name: string; cost: string; speed: string; risk: string; desc: string }> = {
  A: { name: '方案 A · 自建', cost: '成本:高(初始投入大)', speed: '上线:慢(3-6 月)', risk: '风险:可控(数据自有)', desc: '完全自主,适合对数据主权/合规要求高的场景' },
  B: { name: '方案 B · SaaS', cost: '成本:低(按需付费)', speed: '上线:快(1-2 周)', risk: '风险:中(依赖供应商)', desc: '开箱即用,适合快速验证 / 小团队' },
  C: { name: '方案 C · 混合', cost: '成本:中', speed: '上线:中(1-2 月)', risk: '风险:中', desc: '核心自建 + 非核心 SaaS,平衡主权与速度' },
}

// 自定义工具:查询某方案评估(子 agent 经 allowedTools 获得调用权)
const getSource = defineTool({
  name: 'get_source',
  description: '查询指定方案的详细评估(成本/速度/风险/描述)。key ∈ A/B/C',
  schema: z.object({ key: z.enum(['A', 'B', 'C']) }),
  handler: ({ key }) => JSON.stringify(SOURCES[key]),
})

const root = ref<HTMLElement>()
let agent: PageAgent | null = null

onMounted(() => {
  agent = createPageAgent({
    container: root.value!,
    id: 'subagent-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是方案调研助手。当用户要对比/评估多个方案时,【必须】用 spawn_agents 并行委派子 agent:每个子 agent 设相应 role(如"A 方案分析师")并用 get_source 调研一个方案,给出该方案的评估要点,你再汇总对比并给出推荐。单个方案的问题可用 spawn_agent(可设 role/tools/model)。子 agent 之间互不通信,由你聚合。',
    tools: [getSource],
    subagent: { allowedTools: ['get_source'] }, // 子 agent 可用 get_source(默认只读 window/fetch 之外)
    debug: true,
    title: '子 Agent 并行调研',
    placeholder: '试试:对比 A/B/C 三个方案,推荐哪个?',
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🧬 子 Agent 并行编排</h2>
      <p class="hint">
        主 agent 遇到多方案对比时,用 <code>spawn_agents</code> 并行委派多个子 agent 各调研一个方案,再汇总。
      </p>
      <p class="hint">
        ▶ 观察右侧对话框:<code>spawn_agents</code> 步骤下会<strong>嵌套显示每个子 agent 的工具调用进度</strong>
        —— 子 agent 过程<strong>不进入主上下文</strong>(只把结论返回),只在此处可视化。
      </p>
      <div class="sources">
        <div v-for="(s, k) in SOURCES" :key="k" class="source-card">
          <h3>{{ s.name }}</h3>
          <p>{{ s.cost }}</p>
          <p>{{ s.speed }}</p>
          <p class="desc">{{ s.desc }}</p>
        </div>
      </div>
      <p class="try">💡 试试问:「对比三个方案,我们 10 人团队、要快速上线,推荐哪个?」</p>
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
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
.source-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
.source-card h3 { font-size: 14px; margin: 0 0 8px; color: #4338ca; }
.source-card p { font-size: 12px; color: #6b7280; margin: 2px 0; }
.source-card .desc { color: #9ca3af; margin-top: 6px; }
.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 8px; }
</style>
