<script setup lang="ts">
/**
 * 动画演示 demo —— 直观对比 ChatDialog 的三种动画 + inline / drawer 两种模式。
 *
 * 演示能力:
 *  ① 入场抽屉动画:挂载时从右滑入 + 淡入(cs-drawer-in / 抽屉模式 cs-drawer-slide-in 从屏幕外滑入)
 *  ② 收起/展开动画(inline 模式):点标题栏下箭头,chat-body/footer 淡出 + 高度收缩(cs-slide)
 *  ③ 卸载退出动画:unmount 时淡出 + 缩小(inline)/ 向右滑出(drawer)(cs-leaving)
 *  ④ 抽屉模式:遮罩 + 从右滑入 + 关闭按钮(替代下箭头),点遮罩/关闭按钮触发 unmount
 *
 * 运行:npm run dev → 访问 /examples/animation-demo/
 */
import { onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 当前模式:inline(占满 container,有收起下箭头)/ drawer(从右滑入 + 遮罩 + 关闭按钮)
const mode = ref<'inline' | 'drawer'>('inline')
const mounted = ref(false)
const hidden = ref(false)  // drawer 模式 hide 后为 true(保留 agent/历史,再 show 恢复)

function buildSdk() {
  return createChatSdk({
    container: root.value!,
    id: 'animation-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    drawer: mode.value === 'drawer',
    title: mode.value === 'drawer' ? '抽屉模式' : 'Inline 模式',
    placeholder: '这是动画演示,可随意输入测试…',
    debug: true,
    // drawer 模式:点遮罩/关闭按钮 → hide(保留 agent/历史/生成进程)+ 同步 hidden 状态
    onClose: () => { agent?.hide(); hidden.value = true },
  })
}

async function mountAgent() {
  if (mounted.value) return
  agent = buildSdk()
  await agent.mount()
  mounted.value = true
  hidden.value = false
}

function unmountAgent() {
  if (!agent) return
  agent.unmount()  // 触发 cs-leaving 退出动画,动画结束自动清理 DOM
  agent = null
  mounted.value = false
  hidden.value = false
}

// 抽屉模式隐藏:保留 agent + 聊天历史 + 正在进行的生成进程(再 mount/show 恢复)
function hideAgent() {
  agent?.hide()
  hidden.value = true
}
// 抽屉模式显示:恢复可见(历史与生成进程保留)
async function showAgent() {
  if (!agent) {
    await mountAgent()  // 未挂载 → 挂载
    return
  }
  agent.show()
  hidden.value = false
}

// 切换模式:先卸载(带退出动画),等动画结束再以新模式挂载
async function switchMode(m: 'inline' | 'drawer') {
  if (mode.value === m && mounted.value) return
  if (mounted.value) {
    unmountAgent()
    await new Promise((r) => setTimeout(r, 350))  // 等退出动画(0.3s + 缓冲)
  }
  mode.value = m
  await mountAgent()  // 触发入场动画
}

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🎬 ChatDialog 动画演示</h2>
      <p class="hint">
        对比 ChatDialog 的三种动画与两种挂载模式。点按钮触发挂载/卸载,观察动画效果。
      </p>

      <h3>挂载模式</h3>
      <div class="mode-bar">
        <button class="btn-mode" :class="{ active: mode === 'inline' }" :disabled="mounted && mode === 'inline'" @click="switchMode('inline')">
          Inline(占满容器)
        </button>
        <button class="btn-mode" :class="{ active: mode === 'drawer' }" :disabled="mounted && mode === 'drawer'" @click="switchMode('drawer')">
          Drawer(抽屉 + 遮罩)
        </button>
      </div>
      <p class="hint small">
        <strong>Inline</strong>:占满右侧 container,标题栏有下箭头收起/展开<br />
        <strong>Drawer</strong>:从右滑入 + 半透明遮罩,标题栏关闭按钮(替代下箭头),点遮罩关闭
      </p>

      <h3>挂载 / 隐藏 / 卸载</h3>
      <div class="action-bar">
        <button class="btn-primary" :disabled="mounted && !hidden" @click="showAgent">
          {{ hidden ? '▶ 显示聊天框(恢复历史)' : '▶ 挂载聊天框(看入场动画)' }}
        </button>
        <button class="btn-warn" :disabled="!mounted || hidden || mode !== 'drawer'" @click="hideAgent" :title="mode === 'drawer' ? '' : '仅抽屉模式支持隐藏'">
          🙈 隐藏(保留历史/生成进程)
        </button>
        <button class="btn-danger" :disabled="!mounted" @click="unmountAgent">
          ■ 卸载(彻底销毁)
        </button>
      </div>
      <p class="status">当前状态:{{ !mounted ? '未挂载' : hidden ? '已隐藏(历史保留中)' : '已显示(' + mode + ')' }}</p>
      <p class="hint small">
        <strong>隐藏 vs 卸载</strong>:drawer 模式点关闭按钮/遮罩默认触发 <strong>隐藏</strong>(保留聊天历史与正在生成的对话,再显示直接恢复);<strong>卸载</strong>才彻底销毁 agent + 历史。
      </p>

      <h3>动画说明</h3>
      <ul class="anim-list">
        <li><strong>入场</strong>:挂载时 <code>cs-drawer-in</code>(inline 从右滑 32px + 淡入)/ <code>cs-drawer-slide-in</code>(drawer 从屏幕外滑入 100%)</li>
        <li><strong>收起/展开</strong>(inline):点下箭头,<code>cs-slide</code> 淡出 + 高度收缩到 52px</li>
        <li><strong>卸载</strong>:unmount 时 <code>cs-leaving</code> 淡出 + 缩小(inline)/ 向右滑出(drawer),遮罩同步淡出</li>
        <li><strong>无障碍</strong>:<code>prefers-reduced-motion</code> 时自动关闭动画</li>
      </ul>

      <p class="try">
        💡 试试:切换 Inline/Drawer 模式 → 点「挂载」看入场 → inline 模式点标题栏下箭头看收起 → 点「卸载」看退出<br />
        抽屉模式:点遮罩或标题栏 × 按钮也可触发卸载(带退出动画)
      </p>
    </aside>
    <section ref="root" class="pane pane-right" :class="{ 'pane-right--inline': mode === 'inline' }"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: #f5f7fa; padding: 28px 32px; }
.pane-right { flex: 0 0 460px; }
.pane-right--inline { border-left: 1px solid #e5e7eb; background: #fff; }
.pane-right--inline > :deep(.chat-dialog) { width: 100%; height: 100%; }

h2 { font-size: 20px; margin: 0 0 12px; color: #1f2937; }
h3 { font-size: 14px; margin: 18px 0 8px; color: #374151; }
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 14px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.hint.small { font-size: 12px; margin: 0 0 6px; }

.mode-bar, .action-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.btn-mode, .btn-primary, .btn-danger, .btn-warn {
  padding: 8px 16px; border-radius: 7px; font-size: 13px; cursor: pointer;
  border: 1px solid transparent; transition: all 0.15s;
}
.btn-mode { background: #fff; border-color: #d1d5db; color: #374151; }
.btn-mode.active { background: #1f4d3a; border-color: #1f4d3a; color: #fff; }
.btn-mode:disabled, .btn-primary:disabled, .btn-danger:disabled, .btn-warn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #1f4d3a; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #163a2c; }
.btn-warn { background: #fff; border-color: #f59e0b; color: #b45309; }
.btn-warn:hover:not(:disabled) { background: #fffbeb; }
.btn-danger { background: #fff; border-color: #ef4444; color: #ef4444; }
.btn-danger:hover:not(:disabled) { background: #fef2f2; }

.status { font-size: 13px; color: #6b7280; margin: 6px 0 0; }

.anim-list { list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 1.8; color: #4b5563; }
.anim-list li { padding: 4px 0; }
.anim-list strong { color: #1f2937; }
.anim-list code { background: #ecfdf5; color: #065f46; padding: 1px 5px; border-radius: 4px; font-size: 11px; }

.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 14px; line-height: 1.7; }
.try code { background: #fff; color: #6d28d9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
