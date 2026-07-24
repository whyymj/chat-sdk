<script setup lang="ts">
/**
 * 嵌套树示例 —— 对齐实际项目 window.Editor.PageInfo 格式 + style 自定义属性。
 *
 * 演示能力:
 *  ① 声明:递归 schema(z.lazy 自引用)+ style 显式 schema + passthrough 放行自定义属性,注册根 path('Editor.PageInfo')
 *  ② 查:query_window_prop 用 $..*[?(@.type=="text")] 递归找任意深度的区块
 *  ③ 改:edit_window_prop 用 jsonPath(如 sections.0.children.0.style.color)深层定位,只发改动
 *  ④ 增/删:append 给 section 加 children、remove 删区块;校验自动穿透到 children + style
 *  ⑤ 响应式:左侧树由 window.Editor.PageInfo(reactive)驱动,Agent 改子属性 → 树实时更新
 *
 * 运行:npm run dev → 访问 /nested.html
 */
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'
import TreeRenderer from './TreeRenderer.vue'
import { PageInfoSchema, initialPageInfo, type PageInfo } from './treeData'

// 把页面信息挂到宿主 window.Editor.PageInfo(reactive),Agent 工具函数体的 window 即此 window
const w = window as any
if (!w.Editor) w.Editor = {}
if (!w.Editor.PageInfo) w.Editor.PageInfo = reactive<PageInfo>(structuredClone(initialPageInfo))
const pageInfo = w.Editor.PageInfo as PageInfo

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// ✋ 人工介入:选中区块后直接手动编辑(与 Agent 共享同一 reactive window.Editor.PageInfo)
import type { Block, Style } from './treeData'
const selectedId = ref<string | undefined>(undefined)
const selected = ref<Block | null>(null)
// 选中区块的 style 对象(onSelect 时保证非空);v-model 直接改它 → 触发 reactive 更新
const selStyle = ref<Style>({})

// 按 id 在 sections 树里递归找区块(返回 reactive 引用,直接改其属性即触发响应式更新)
function findBlockById(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b
    if (b.children?.length) {
      const hit = findBlockById(b.children, id)
      if (hit) return hit
    }
  }
  return null
}

function onSelect(block: Block) {
  selectedId.value = block.id
  const found = findBlockById(pageInfo.sections, block.id)
  // 确保 style 对象存在(否则 v-model 改 style.color 会报错);reactive 下新建对象会自动转代理
  if (found && !found.style) found.style = {}
  selected.value = found
  selStyle.value = found?.style ?? {}
}

// 还原该区块到初始值(人工撤销自己的改动)
function resetSelected() {
  if (!selected.value) return
  const init = findBlockById(initialPageInfo.sections, selected.value.id)
  if (init) {
    selected.value.text = init.text
    selStyle.value = init.style ? { ...init.style } : {}
    selected.value.style = init.style ? { ...init.style } : undefined
  }
}

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'nested-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // 递归 schema:注册 window.Editor.PageInfo 根;children 自引用任意深度;style 显式声明,passthrough 放行自定义属性
    windowProps: [
      {
        path: 'Editor.PageInfo',
        description: '页面信息(含 title/theme/sections;section 与区块可任意嵌套 children,节点带 style 样式对象)',
        schema: PageInfoSchema,
      },
    ],
    systemPrompt: [
      '你是页面编辑助手。window.Editor.PageInfo 是页面信息,含 title/theme/sections。',
      'sections 是任意深度的区块树:节点有 id/name/type(section|text|button|image|card)/text/style/children。',
      'style 是样式对象,常用键:background/color/fontSize/fontWeight/padding/margin/borderRadius/display;可加自定义键。',
      '操作指南(jsonPath 相对 PageInfo 根,逐级定位,只发改动,不要重传整页):',
      '1. 查任意深度区块用 query_window_prop,expr 如 $..*[?(@.type=="text")] 找所有文本,$..*[?(@.type=="section")] 找所有分区,$..*[?(@.name=="主标题")] 按名找;',
      '2. 改深层样式用 edit_window_prop 的 set,如改「顶部 Banner/主标题」颜色:op=set, jsonPath="sections.0.children.0.style.color", value="#ff0000";',
      '3. 改文案用 set 改对应 jsonPath 的 text,如 jsonPath="sections.0.children.0.text";',
      '4. 加子区块用 append,如给「商品列表」加一张卡:op=append, jsonPath="sections.1.children", value=\'{"id":"c-3","name":"商品卡 3","type":"card","text":"新品","style":{"borderRadius":10,"padding":16}}\';',
      '5. 删区块用 remove,如删「商品卡 2」:op=remove, jsonPath="sections.1.children.1";',
      '6. 改分区背景用 set,如 jsonPath="sections.0.style.background"。',
      '每次操作后用路径描述改了哪个区块(如「顶部 Banner/主标题 的 color」)。',
    ].join('\n'),
    // 人工确认:写操作(set/edit/delete)前弹确认框,用户「允许/拒绝」后才执行(防 AI 误改页面)
    approval: { tools: ['set_window_prop', 'edit_window_prop', 'delete_window_prop'] },
    // 会话级 checkpoint:每轮自动存档,流程异常/改坏页面时可一键回退到上次正常态(↩ 回退按钮 + LLM 的 restore_last_checkpoint 工具)
    checkpoint: true,
    debug: true,
    title: '嵌套页面编辑',
    placeholder: '试试:主标题改成红色;给商品列表加一张「新品」卡;删掉商品卡 2',
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🌳 嵌套页面(window.Editor.PageInfo)</h2>
      <p class="hint">
        <code>window.Editor.PageInfo</code> 是任意深度的页面区块树,用 <code>z.lazy</code> 递归 schema 声明,
        节点带 <code>style</code> 样式对象(显式 schema + <code>passthrough</code> 放行自定义属性)。
        Agent 经 <code>edit_window_prop</code> 的 <strong>jsonPath 逐级定位</strong>深层节点增删改 ——
        左侧树由 <code>reactive</code> 驱动,改动<strong>实时更新</strong>。
      </p>
      <div class="tree-wrap" :data-theme="pageInfo.theme || 'light'">
        <h3 class="page-title">{{ pageInfo.title }}</h3>
        <TreeRenderer :nodes="pageInfo.sections" :selected-id="selectedId" @select="onSelect" />
      </div>

      <!-- ✋ 人工介入:点击树节点选中后,直接手动编辑该区块(与 Agent 共享同一 window.Editor.PageInfo) -->
      <div v-if="selected" class="manual-panel">
        <div class="manual-title">✋ 人工编辑 — {{ selected.name }} <span class="manual-id">#{{ selected.id }}</span></div>
        <p class="manual-hint">直接改下面字段,改动落到 <code>window.Editor.PageInfo</code>(reactive),树实时更新;Agent 后续操作也能读到这些手动改动(数据同源)。</p>
        <label class="field">
          <span>文案 text</span>
          <input v-model="selected.text" placeholder="(无文案)" />
        </label>
        <label class="field">
          <span>颜色 color</span>
          <input v-model="selStyle.color" type="color" />
          <input v-model="selStyle.color" class="color-text" placeholder="#ff0000" />
        </label>
        <label class="field">
          <span>背景 background</span>
          <input v-model="selStyle.background" type="color" />
          <input v-model="selStyle.background" class="color-text" placeholder="#1f4d3a" />
        </label>
        <label class="field">
          <span>字号 fontSize</span>
          <input v-model.number="selStyle.fontSize" type="number" min="8" max="96" />
        </label>
        <label class="field">
          <span>字重 fontWeight</span>
          <select v-model.number="selStyle.fontWeight">
            <option :value="undefined">默认</option>
            <option :value="400">400 常规</option>
            <option :value="600">600 中粗</option>
            <option :value="700">700 加粗</option>
            <option :value="900">900 特粗</option>
          </select>
        </label>
        <div class="manual-actions">
          <button class="btn" @click="selected = null">完成</button>
          <button class="btn btn-ghost" @click="resetSelected">还原该区块初始值</button>
        </div>
      </div>

      <p class="try">
        💡 试试:「主标题改成红色」「给商品列表加一张新品卡」<br />
        「删掉商品卡 2」「把顶部 Banner 背景改成深蓝」<br />
        ✋ 或点击左侧任一区块,手动改文案/颜色/字重(Agent 与人共享同一数据源)
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
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 14px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.tree-wrap {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.page-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #d1d5db;
  color: #1f2937;
}
.try {
  font-size: 13px;
  color: #7c3aed;
  background: #f3e8ff;
  padding: 10px 14px;
  border-radius: 8px;
  margin-top: 14px;
  line-height: 1.7;
}

/* ✋ 人工介入编辑面板 */
.manual-panel {
  margin-top: 14px;
  background: #fff;
  border: 1px solid #c7d2fe;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08);
}
.manual-title { font-size: 14px; font-weight: 600; color: #4338ca; margin-bottom: 4px; }
.manual-id { font-size: 11px; color: #9ca3af; font-weight: 400; }
.manual-hint { font-size: 12px; line-height: 1.6; color: #6b7280; margin: 0 0 12px; }
.manual-hint code { background: #e0e7ff; color: #4338ca; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.field { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; color: #374151; }
.field > span { width: 92px; flex-shrink: 0; color: #6b7280; }
.field input[type='text'], .field input:not([type]) { flex: 1; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
.field input[type='number'], .field select { padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; background: #fff; }
.field input[type='color'] { width: 38px; height: 30px; padding: 0; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; background: #fff; }
.field .color-text { flex: 1; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; font-family: ui-monospace, monospace; }
.manual-actions { display: flex; gap: 8px; margin-top: 12px; }
.btn { padding: 6px 14px; border: none; border-radius: 6px; background: #4338ca; color: #fff; font-size: 13px; cursor: pointer; }
.btn:hover { background: #3730a3; }
.btn-ghost { background: #fff; color: #4338ca; border: 1px solid #c7d2fe; }
.btn-ghost:hover { background: #eef2ff; }
</style>
