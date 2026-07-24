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
        <TreeRenderer :nodes="pageInfo.sections" />
      </div>
      <p class="try">
        💡 试试:「主标题改成红色」「给商品列表加一张新品卡」<br />
        「删掉商品卡 2」「把顶部 Banner 背景改成深蓝」
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
</style>
