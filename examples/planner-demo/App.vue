<script setup lang="ts">
/**
 * 规划-反思-执行 示例 —— 双子 agent 编排(零新中间件,纯 subagents 预声明 + usageHints 路由提示)。
 *
 * 流程:用户给创作类需求 → 主 agent 路由判断 →
 *  ① use_planner(高温 0.9 创意规划师,只读)出 2-3 套风格方案(JSON 草稿)
 *  ② (可选)use_reflector(低温 0.3 反思审查)挑刺修订
 *  ③ 主 agent 自己 write 落地成最终 JSON(低温度执行 + schema 校验 + 写前确认)
 *
 * 路由提示由 usageHints 中间件按 subagents 的 temperature/description 自动注入(无需手写 prompt):
 *  - 高温(≥0.7)或描述含"规划/创意/设计/方案" → planner
 *  - 低温且描述含"反思/审查/挑刺" → reflector
 *
 * 运行:npm run dev → 访问 /planner.html
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, z, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

interface AppConfig {
  theme: 'fresh-blue' | 'night-purple' | 'warm-orange' | 'forest-green'
  density: 'compact' | 'cozy' | 'spacious'
  radius: number
  accent: string
}
const THEMES: Record<string, { name: string; bg: string; fg: string }> = {
  'fresh-blue': { name: '清新蓝', bg: '#eff6ff', fg: '#1e3a8a' },
  'night-purple': { name: '暗夜紫', bg: '#1e1b4b', fg: '#e9d5ff' },
  'warm-orange': { name: '暖橙', bg: '#fff7ed', fg: '#7c2d12' },
  'forest-green': { name: '森绿', bg: '#f0fdf4', fg: '#14532d' },
}
const DENSITY_PAD: Record<AppConfig['density'], number> = { compact: 8, cozy: 16, spacious: 24 }

// appConfig 的 zod schema:作为 data schema 自动注入字段说明(.describe())+ 写入校验
const appConfigSchema = z.object({
  theme: z.enum(['fresh-blue', 'night-purple', 'warm-orange', 'forest-green']).describe('界面主题:清新蓝/暗夜紫/暖橙/森绿'),
  density: z.enum(['compact', 'cozy', 'spacious']).describe('信息密度:紧凑/舒适/宽松'),
  radius: z.number().min(0).max(40).describe('圆角像素(0-40)'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('强调色 hex(如 #3b82f6)'),
})

const w = window as any
// 顶层建普通对象 appConfig 挂 window(供页面读取),同时作为 data bind 入参;非 reactive → 靠 tick 重渲染
const appConfigObj: AppConfig = { theme: 'fresh-blue', density: 'cozy', radius: 12, accent: '#3b82f6' }
w.appConfig = appConfigObj
const config = appConfigObj

// tick:onEvent('data_change') 时 ++,:key 强制预览重渲染读最新 config
const tick = ref(0)

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'planner-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
      temperature: 0.3, // 主 agent 低温度:执行落地要稳
    },
    // data 单主对象:bind 直连普通对象(集成方自己挂 window.appConfig),schema .describe() 自动注入字段说明到 systemPrompt
    data: { schema: appConfigSchema, bind: appConfigObj },
    systemPrompt: [
      '你是界面设计执行助手。',
      '遇到创作/设计类需求,按"规划-反思-执行"流程:先委派 planner 出方案,再据需要委派 reflector 审查,最后落地。',
      '简单明确的改动(如"标题改红色")直接执行,不必编排。',
    ].join('\n'),
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    // 预声明双子 agent:planner 高温创意(只读,无写工具),reflector 低温审查(只读)
    subagents: [
      {
        id: 'planner',
        description: '创意设计规划师,擅长页面主题/风格方案设计(只出方案,不落地)',
        temperature: 0.9, // 高温度 → 创造力
        maxTokens: 8192,
        systemPrompt:
          '你是创意设计规划师。只读 window.appConfig 看现状,给出 2-3 套风格方案,每套含 theme/density/radius/accent 的具体取值及理由。以 JSON 草稿形式给出,不要调用任何写工具。',
      },
      {
        id: 'reflector',
        description: '设计反思审查员,挑方案的不一致/不可行/体验问题并给修订建议',
        temperature: 0.3,
        systemPrompt:
          '你是设计反思审查员。对给定方案挑刺:配色对比度、与现有数据冲突、体验问题。给出具体修订建议,不要重写整个方案。',
      },
    ],
    // 写操作落地前弹确认(approval 同时默认开启主动征询 humanConfirm)
    approval: { tools: ['write'] },
    debug: true,
    dialog: {
      title: '规划-反思-执行',
      placeholder: '试试:帮我设计夏日主题风格;给页面换个有创意的感觉',
    },
    // 非 reactive bind:监听 data_change 触发 tick,:key 强制预览重渲染
    onEvent(e) {
      if ((e as any).type === 'data_change') tick.value++
    },
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🎨 规划-反思-执行</h2>
      <p class="hint">
        双子 agent 编排:<code>use_planner</code>(高温 0.9 创意规划)出方案 →
        <code>use_reflector</code>(低温 0.3 反思审查)挑刺 → 主 agent(低温 0.3)<code>write</code> 落地。
        路由提示由 <code>usageHints</code> 按 temperature/description 自动注入,零新中间件。
      </p>

      <div
        :key="tick"
        class="preview"
        :style="{
          background: (THEMES[config.theme] || THEMES['fresh-blue']).bg,
          color: (THEMES[config.theme] || THEMES['fresh-blue']).fg,
          padding: DENSITY_PAD[config.density] + 'px',
          borderRadius: config.radius + 'px',
          borderColor: config.accent,
        }"
      >
        <div class="preview__tag" :style="{ background: config.accent, color: '#fff' }">
          {{ (THEMES[config.theme] || THEMES['fresh-blue']).name }} · {{ config.density }} · r{{ config.radius }}
        </div>
        <h3 class="preview__title">实时预览</h3>
        <p class="preview__text">theme / density / radius / accent 由 <code style="color: inherit">window.appConfig</code> 驱动,主 agent 落地后 onEvent 触发 tick 重渲染。</p>
        <button class="preview__btn" :style="{ background: config.accent, borderRadius: Math.max(4, config.radius - 4) + 'px' }">示例按钮</button>
      </div>

      <ul :key="'cfg-' + tick" class="cfg">
        <li><span>theme</span><code>{{ config.theme }}</code></li>
        <li><span>density</span><code>{{ config.density }}</code></li>
        <li><span>radius</span><code>{{ config.radius }}px</code></li>
        <li><span>accent</span><code>{{ config.accent }}</code></li>
      </ul>

      <p class="try">
        💡 试试:「帮我设计夏日主题风格」「给页面换个有创意的感觉」<br />
        ▶ 主 agent 识别为创作类 → use_planner 出方案 → (可选)use_reflector 审查 → write 落地
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
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 16px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }

.preview { border: 2px solid #e5e7eb; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06); transition: all 0.25s; }
.preview__tag { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; margin-bottom: 10px; }
.preview__title { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
.preview__text { font-size: 13px; line-height: 1.6; margin: 0 0 14px; opacity: 0.9; }
.preview__btn { border: none; color: #fff; padding: 8px 18px; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
.preview__btn:hover { opacity: 0.9; }

.cfg { list-style: none; padding: 0; margin: 16px 0 0; display: flex; gap: 14px; flex-wrap: wrap; }
.cfg li { font-size: 12px; color: #6b7280; display: flex; align-items: center; gap: 6px; }
.cfg span { color: #9ca3af; }
.cfg code { background: #fff; border: 1px solid #e5e7eb; padding: 2px 8px; border-radius: 6px; font-family: ui-monospace, monospace; color: #374151; }

.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 16px; line-height: 1.7; }
</style>
