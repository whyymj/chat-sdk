<script setup lang="ts">
/**
 * 人工确认(humanConfirm)专项示例 —— 聚焦 AI 主动征询。
 *
 * 与 nested-demo(综合:嵌套树 + 被动确认 + checkpoint)互补,本 demo 单独演示:
 *  - 主动侧(humanConfirmTool):用户给开放性需求(「帮我设计界面风格」),AI 不自行拍板,
 *    调 request_human_confirmation({ question, options:[方案...], recommendation }) →
 *    UI 渲染可点选按钮 → 用户选 → AI 据此执行
 *  - 被动侧(approval.tools):AI 落地写操作(set/edit)前再弹一次「允许/拒绝」二次把关
 *
 * 配置要点(回答「主动征询如何开启」):
 *  - 主动征询**默认开启**(不猜测):不传任何选项也装 request_human_confirmation + 注入默认提示词;
 *    关闭用顶层 `humanConfirm: false`(或传 approval 时 `approval.humanConfirmTool: false`)
 *  - 被动确认仍需声明:`approval: { tools: [...] }` 指定写操作白名单(业务相关,无法自动推断)
 *
 * 运行:npm run dev → 访问 /human-confirm.html
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, z, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

// 可被 Agent 操作的主数据配置(普通对象,非 reactive → 靠 tick 重渲染预览)
interface AppConfig {
  theme: 'fresh-blue' | 'night-purple' | 'warm-orange'
  density: 'compact' | 'cozy' | 'spacious'
  radius: number
}
const THEMES: Record<AppConfig['theme'], { name: string; bg: string; fg: string; accent: string }> = {
  'fresh-blue': { name: '清新蓝', bg: '#eff6ff', fg: '#1e3a8a', accent: '#3b82f6' },
  'night-purple': { name: '暗夜紫', bg: '#1e1b4b', fg: '#e9d5ff', accent: '#a855f7' },
  'warm-orange': { name: '暖橙', bg: '#fff7ed', fg: '#7c2d12', accent: '#f97316' },
}
const DENSITY_PAD: Record<AppConfig['density'], number> = { compact: 8, cozy: 16, spacious: 24 }

// appConfig 的 zod schema:作为 data schema 自动注入字段说明(.describe())+ 写入校验
const appConfigSchema = z.object({
  theme: z.enum(['fresh-blue', 'night-purple', 'warm-orange']).describe('界面主题:清新蓝/暗夜紫/暖橙'),
  density: z.enum(['compact', 'cozy', 'spacious']).describe('信息密度:紧凑/舒适/宽松'),
  radius: z.number().min(0).max(40).describe('圆角像素(0-40)'),
})

const w = window as any
// 顶层建普通对象 appConfig 挂 window(供页面读取),同时作为 data bind 入参;非 reactive → 靠 tick 重渲染
const appConfigObj: AppConfig = { theme: 'fresh-blue', density: 'cozy', radius: 12 }
w.appConfig = appConfigObj
const config = appConfigObj

// tick:onEvent('data_change') 时 ++,:key 强制预览重渲染读最新 config
const tick = ref(0)

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'human-confirm-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // data 单主对象:bind 直连普通对象(集成方自己挂 window.appConfig),schema .describe() 自动注入字段说明到 systemPrompt
    data: { schema: appConfigSchema, bind: appConfigObj },
    systemPrompt: [
      '你是界面风格设计助手。',
      '当用户给开放性需求(如「帮我设计风格」「换个感觉」「给几个方案我挑」)时,必须先征询用户(把候选方案做成可点选选项 + 给出你的推荐),不要只回文字罗列方案让用户自己回复。',
      '用户选定方案后,落地到 appConfig 对应字段。',
    ].join('\n'),
    // 自定义 systemPrompt → 自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);不传 systemPrompt 用默认时已内置,此项可省
    appendReliableWriteRules: true,
    // approval 一行同时开启两侧:被动(write 前弹允许/拒绝)+ 主动(request_human_confirmation 默认随附)
    approval: { tools: ['write'] },
    debug: true,
    title: '人工确认 · AI 主动征询',
    placeholder: '试试:帮我设计个界面风格;换个感觉,给几个方案我挑',
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
      <h2>✋ 人工确认 · AI 主动征询</h2>
      <p class="hint">
        用户给开放性需求时,AI 不自行拍板,调 <code>request_human_confirmation</code> 把候选方案做成<strong>可点选按钮</strong>;
        用户选完再用 <code>write</code> 落地(写前再弹一次被动确认)。两层 human-in-the-loop 一次看清。
      </p>

      <!-- 预览:由 window.appConfig(普通对象)驱动,Agent 改 → onEvent 触发 tick → :key 重渲染 -->
      <div :key="tick" class="preview" :style="{ background: THEMES[config.theme].bg, color: THEMES[config.theme].fg, padding: DENSITY_PAD[config.density] + 'px', borderRadius: config.radius + 'px' }">
        <div class="preview__tag" :style="{ background: THEMES[config.theme].accent, color: '#fff' }">
          {{ THEMES[config.theme].name }} · {{ config.density }} · r{{ config.radius }}
        </div>
        <h3 class="preview__title">实时预览卡片</h3>
        <p class="preview__text">
          主题 / 留白 / 圆角 由 <code style="color: inherit">window.appConfig</code> 驱动。AI 改完右侧确认通过即刷新。
        </p>
        <button
          class="preview__btn"
          :style="{ background: THEMES[config.theme].accent, borderRadius: Math.max(4, config.radius - 4) + 'px' }"
        >
          示例按钮
        </button>
      </div>

      <ul :key="tick" class="cfg">
        <li><span>theme</span><code>{{ config.theme }}</code></li>
        <li><span>density</span><code>{{ config.density }}</code></li>
        <li><span>radius</span><code>{{ config.radius }}px</code></li>
      </ul>

      <p class="try">
        💡 试试:「帮我设计个界面风格」「换个感觉,给几个方案我挑」「做成暗夜紫、紧凑、小圆角」<br />
        ▶ 开放性需求 → AI 弹选项按钮;选定 → AI 落地 → 写前再弹允许/拒绝
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

.preview {
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
  transition: all 0.25s;
}
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
