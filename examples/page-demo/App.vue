<script setup lang="ts">
/**
 * 测试模块 demo —— 左侧 JSON 驱动的响应式页面,右侧 Agent 对话框
 *
 * window.page 用 reactive() 创建并挂到 window(在 setup 顶层,早于子组件 mount),
 * Agent 经 set_window_prop 改 page.* 属性 → 左侧 PageRenderer 响应式更新。
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createPageAgent, type PageAgent } from '../../src/core'
import { defineSkill } from '../../src/core/harness/skills'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import { initialPage, pageWindowProps, pageBuilderSkillContent } from './pageSchema'

const cfg = useAgentConfig()

// 顶层(同步):先建响应式 page 挂到 window,供 PageRenderer 绑定
;(window as any).page = reactive({
  title: initialPage.title,
  theme: initialPage.theme,
  components: initialPage.components.map((c) => ({ ...c })),
})

const root = ref<HTMLElement>()
let agent: PageAgent | null = null

onMounted(() => {
  agent = createPageAgent({
    container: root.value!,
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    systemPrompt:
      '你是页面构建助手。左侧页面由 window.page 的 JSON 驱动。流程:get_window_prop("page") 读取当前页面 → 用 set_window_prop 修改 page.title / page.theme / page.components,左侧实时更新。组件结构详见 load_skill("page-builder")。',
    windowProps: pageWindowProps,
    skills: [
      defineSkill({
        name: 'page-builder',
        description: '编辑由 JSON 驱动的响应式页面(window.page)',
        whenToUse: '用户要求修改左侧页面(增删改组件 / 改标题 / 换主题)时',
        getContent: () => pageBuilderSkillContent,
      }),
    ],
    debug: true,
    title: '页面构建 Agent',
    placeholder: '试试:加一个"提交"按钮 / 主题改成 dark / 删掉列表 …',
  })
  agent.mount()
})

onUnmounted(() => agent?.unmount())
</script>

<template>
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
  flex: 0 0 460px;
  border-left: 1px solid #e5e7eb;
  background: #fff;
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
