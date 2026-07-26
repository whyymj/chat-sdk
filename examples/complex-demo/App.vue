<script setup lang="ts">
/**
 * 复杂页面 demo —— 多种组件拼装一个页面,右侧 Agent 对话框驱动左侧实时更新
 *
 * 配置方式:reactive 对象经 data 的 `bind` 字段直连 SDK(集成方自己挂 window 供页面读取),
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作数据」段,无需手写)。
 * Agent 经 write 改 page.title / page.components(增删改组件 / 调 props / 调 style)→ 左侧 PageRenderer 响应式更新(本 demo 保留 reactive 展示 Vue 响应式模式)。
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, defineSkill, type ChatSdk } from '../../src/core'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import { initialPage, pageSchema, complexBuilderSkillContent } from './pageSchema'

const cfg = useAgentConfig()

// 顶层(同步):先建响应式 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行)
const pageObj = reactive({
  title: initialPage.title,
  components: initialPage.components.map((c) => ({ ...c })),
})
;(window as any).page = pageObj

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'complex-demo',
    storage: 'memory',
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    streaming: true,
    systemPrompt:
      '你是复杂页面构建助手。左侧页面由 window.page 驱动,结构 { title, components[] }(组件数组按顺序拼装)。每个组件 = { type, id?, style?, visible?, className?, props:{...业务字段} };容器组件(container/section/grid)的 props.children 可嵌套任意组件。用户要改左侧页面时,改 page.title 或 page.components(增删改组件、调 props、调 style、容器内改 children),左侧实时更新。组件类型与各字段详见 load_skill("complex-builder")。',
    // data 单主对象配置:schema + bind 直连 reactive 对象,工具直接读写 bind(集成方自己挂 window.page 供 PageRenderer 读)
    data: { schema: pageSchema, bind: pageObj },
    skills: [
      defineSkill({
        name: 'complex-builder',
        description: '编辑组件拼装的复杂页面(window.page,含 container/section/grid 容器可嵌套 children)。用户要求改左侧页面(增删改组件 / 调 props / 调样式 / 容器内嵌套)时使用',
        getContent: () => complexBuilderSkillContent,
      }),
    ],
    debug: true,
    title: '复杂页面 Agent',
    placeholder: '试试:加一个商品卡片 / 标题改成红色 / 轮播换成 3 张图 / 商品瀑布流改成 4 列 …',
  })
  agent.mount()
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <PageRenderer />
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.pane-left {
  flex: 1;
  overflow: auto;
  background: #f5f7fa;
  padding: 24px;
}
.pane-right {
  width: 50%;
  flex: 1;
  border-left: 1px solid #e5e7eb;
  background: #fff;
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
