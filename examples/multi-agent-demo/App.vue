<script setup lang="ts">
/**
 * 多 Agent 并行 demo —— 同一页面挂三个独立 agent,各自独立 data/历史/工具,互斥切换聊天框。
 *
 * 三个 agent(不同 id 隔离,各管各 data,无冲突):
 *  ① 页面构建 Agent —— 操作 page 数据(title + components)
 *  ② 文案优化 Agent —— 操作 copy 数据(headline + subline + cta + tone)
 *  ③ 数据分析 Agent —— 操作 stats 数据(metrics + 分析结论 note)
 *
 * 互斥切换:三个 agent 都 mount 就绪(各自独立 ReAct 循环可并行),维护 activeIndex;
 *          切换时 hide 旧的(drawer 模式 hide 保留 agent/历史/生成进程)、show 新的(历史恢复)。
 *          三个 agent 可同时跑各自的生成任务(并行),互不阻塞。
 *
 * 运行:npm run dev → 访问 /examples/multi-agent-demo/
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, defineSkill, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import { useAgentConfig } from '../complex-demo/useAgentConfig'

const cfg = useAgentConfig()

// ===== 三个 agent 各自的 data(独立对象,互不冲突)=====
const pageObj = reactive({ title: '多 Agent 协同演示页', components: [{ type: 'hero', props: { title: '欢迎', subtitle: '三个 Agent 各司其职' } }] })
const copyObj = reactive({ headline: '限时特惠', subline: '全场满减,限时 3 天', cta: '立即抢购', tone: '热情' })
const statsObj = reactive({ metrics: { gmv: 128000, orders: 342, cvr: 4.2 }, note: '' })

// ===== 三个 agent 配置(不同 id / systemPrompt / data / skills)=====
interface AgentSlot { id: string; label: string; icon: string; desc: string; data: any; }
const SLOTS: AgentSlot[] = [
  { id: 'multi-page', label: '页面构建', icon: '🏗', desc: '操作 page 数据(标题 + 组件)', data: pageObj },
  { id: 'multi-copy', label: '文案优化', icon: '✍️', desc: '操作 copy 数据(标题/副标/CTA/语气)', data: copyObj },
  { id: 'multi-stats', label: '数据分析', icon: '📊', desc: '操作 stats 数据(指标 + 分析结论)', data: statsObj },
]

const agents = ref<(ChatSdk | null)[]>([null, null, null])
const active = ref(0)        // 当前显示的 agent 索引
const anyVisible = ref(true) // 是否有任意 agent 可见(点已激活按钮 toggle 隐藏/显示)
const ready = ref(false)     // 三个 agent 都 mount 就绪
const containers = ref<HTMLElement[]>([])

// 各 agent 的 systemPrompt(简短,描述各自职责 + data 结构)
const prompts: Record<string, string> = {
  'multi-page': '你是页面构建助手。操作 page 数据 { title, components[{type,props}] },改标题或调组件。组件类型与字段详见 load_skill("page-skill")。',
  'multi-copy': '你是文案优化助手。操作 copy 数据 { headline(主标题), subline(副标题), cta(按钮文案), tone(语气:热情/专业/活泼/稳重) },优化营销文案。',
  'multi-stats': '你是数据分析助手。操作 stats 数据 { metrics:{gmv(成交额),orders(订单数),cvr(转化率%)}, note(分析结论) },基于 metrics 写分析结论到 note。',
}

// 各 agent 的 skill(描述各自 data 字段细节)
const skills: Record<string, any> = {
  'multi-page': [defineSkill({ name: 'page-skill', description: '页面构建字段说明', getContent: () => 'page.title: 页面标题(字符串)\npage.components: 组件数组,每项 { type, props }\ntype 可选: hero/banner/card/grid\nprops 因类型而异(hero: title,subtitle)' })],
  'multi-copy': [defineSkill({ name: 'copy-skill', description: '文案字段说明', getContent: () => 'copy.headline: 主标题(吸引眼球)\ncopy.subline: 副标题(补充说明)\ncopy.cta: 按钮文案(促点击)\ncopy.tone: 语气枚举 热情|专业|活泼|稳重' })],
  'multi-stats': [defineSkill({ name: 'stats-skill', description: '数据字段说明', getContent: () => 'stats.metrics.gmv: 成交额(元)\nstats.metrics.orders: 订单数\nstats.metrics.cvr: 转化率(%)\nstats.note: 分析结论(你写的文字,留空待填)' })],
}

// 各 agent 的 schema(简短 zod,字段 .describe 自动注入 systemPrompt)
import { z } from 'zod'
const schemas: Record<string, any> = {
  'multi-page': z.object({ title: z.string().describe('页面标题'), components: z.array(z.object({ type: z.string(), props: z.record(z.any()) })).describe('组件数组') }),
  'multi-copy': z.object({ headline: z.string().describe('主标题'), subline: z.string().describe('副标题'), cta: z.string().describe('按钮文案'), tone: z.enum(['热情', '专业', '活泼', '稳重']).describe('语气') }),
  'multi-stats': z.object({ metrics: z.object({ gmv: z.number().describe('成交额'), orders: z.number().describe('订单数'), cvr: z.number().describe('转化率%') }), note: z.string().describe('分析结论') }),
}

onMounted(async () => {
  // 三个 agent 并行 mount(各自独立 agent 实例,独立 ReAct 循环可并行)
  await Promise.all(SLOTS.map(async (s, i) => {
    const sdk = createChatSdk({
      container: containers.value[i],
      id: s.id,                  // 不同 id 隔离:各自独立 agent/历史/工具/storage
      storage: 'memory',
      llm: { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model, temperature: cfg.temperature, maxTokens: cfg.maxTokens },
      streaming: true,
      systemPrompt: prompts[s.id],
      appendReliableWriteRules: true,
      data: { schema: schemas[s.id], bind: s.data },   // 各管各 data,无冲突
      skills: skills[s.id],
      debug: true,
      dialog: {
        drawer: true,             // 抽屉模式:从右滑入 + 遮罩 + 关闭按钮
        title: `${s.icon} ${s.label} Agent`,
        placeholder: `我是「${s.label}」Agent,${s.desc}…`,
        onClose: () => agents.value[i]?.hide(),   // 关闭按钮 → hide(保留历史/生成进程,不卸载)
      },
    })
    await sdk.mount()
    agents.value[i] = sdk
    if (i !== 0) sdk.hide()     // 初始只显示第一个,其余隐藏
  }))
  ready.value = true
})

// 互斥切换:hide 旧的、show 新的(三个 agent 历史各自保留,切换不丢对话)
function switchTo(i: number) {
  if (!ready.value) return
  // 点已激活按钮:toggle 显示/隐藏(再点当前聊天框 → 收起,再点 → 恢复)
  if (i === active.value) {
    const cur = agents.value[i]
    const dialogEl = containers.value[i]?.querySelector('.chat-dialog') as HTMLElement | null
    if (dialogEl?.classList.contains('cs-hidden')) {
      cur?.show(); anyVisible.value = true
    } else {
      cur?.hide(); anyVisible.value = false
    }
    return
  }
  agents.value[active.value]?.hide()
  active.value = i
  agents.value[i]?.show()
  anyVisible.value = true
}

onUnmounted(() => agents.value.forEach((a) => a?.unmount()))
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🤝 多 Agent 并行 + 互斥切换</h2>
      <p class="hint">
        同一页面挂三个独立 Agent(不同 <code>id</code> 隔离),各自独立 data/历史/工具,可<strong>并行</strong>跑各自生成任务;
        聊天框<strong>互斥切换</strong>(打开一个,另一个消失)—— 切换用 <code>hide</code>/<code>show</code>,保留各自历史与正在进行的生成进程,再切回直接恢复。
      </p>

      <h3>选择 Agent(互斥切换聊天框)</h3>
      <div class="agent-bar">
        <button
          v-for="(s, i) in SLOTS"
          :key="s.id"
          class="agent-btn"
          :class="{ active: active === i }"
          :disabled="!ready"
          @click="switchTo(i)"
        >
          <span class="agent-icon">{{ s.icon }}</span>
          <span class="agent-label">{{ s.label }}</span>
        </button>
      </div>
      <p class="status">当前聊天框:{{ !ready ? '初始化中…' : anyVisible ? SLOTS[active].icon + ' ' + SLOTS[active].label : SLOTS[active].icon + ' ' + SLOTS[active].label + '(已隐藏,点按钮恢复)' }}</p>

      <h3>各 Agent 的可编辑数据(独立,互不冲突)</h3>
      <div v-for="(s, i) in SLOTS" :key="s.id" class="data-block">
        <div class="data-head">{{ s.icon }} {{ s.label }} Agent <span class="data-id">#{{ s.id }}</span></div>
        <EditableBanner :title="`AI 可编辑数据 · ${s.label}`" :hint="`Agent ${i + 1} 经 write 改此区`">
          <pre class="data-json">{{ JSON.stringify(s.data, null, 2) }}</pre>
        </EditableBanner>
      </div>

      <p class="try">
        💡 试试:点上方按钮切换聊天框 → 各 Agent 输入指令(如「页面构建:加一个 banner」「文案优化:语气改专业」「数据分析:写转化率结论」)<br />
        切换到其他 Agent 时,原 Agent 的对话与生成进程保留(hide 不卸载),再切回继续。
      </p>
    </aside>
    <!-- 三个 agent 的挂载点(drawer 模式 position:fixed,实际覆盖屏幕右侧,挂载点仅作容器) -->
    <section
      v-for="(s, i) in SLOTS"
      :key="s.id"
      :ref="(el) => { if (el) containers[i] = el as HTMLElement }"
      class="pane pane-right"
    ></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: var(--ark-bg); padding: 70px 32px 28px; color: var(--ark-fg); }
.pane-right { width: 0; height: 0; }  /* drawer 模式 fixed,挂载点无需尺寸 */

h2 { font-size: 20px; margin: 0 0 12px; color: var(--ark-fg); }
h3 { font-size: 14px; margin: 18px 0 8px; color: var(--ark-fg); }
.hint { font-size: 13px; line-height: 1.7; color: var(--ark-muted); margin: 0 0 14px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }

.agent-bar {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 10001;  /* 高于抽屉遮罩(9998)+ ChatDialog(9999),切换按钮始终可点 */
  display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px;
  background: rgba(31, 41, 55, 0.94); backdrop-filter: blur(6px);
  padding: 6px 8px; border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.agent-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-radius: 999px; font-size: 13px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.06); color: #e5e7eb;
  transition: all 0.15s;
}
.agent-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); color: #fff; }
.agent-btn.active { border-color: #6366f1; background: #6366f1; color: #fff; font-weight: 600; }
.agent-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.agent-icon { font-size: 16px; }
.status { font-size: 13px; color: #6b7280; margin: 6px 0 0; }

.data-block { margin: 14px 0; }
.data-head { font-size: 13px; font-weight: 600; color: var(--ark-fg); margin-bottom: 6px; }
.data-id { color: var(--ark-muted); font-weight: 400; font-size: 11px; }
.data-json {
  margin: 0; font-size: 11px; line-height: 1.5; color: var(--ark-fg);
  background: var(--ark-bg); padding: 10px; border-radius: 6px; max-height: 160px; overflow: auto;
}

.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 18px; line-height: 1.7; }
.try code { background: #fff; color: #6d28d9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
