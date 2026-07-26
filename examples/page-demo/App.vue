<script setup lang="ts">
/**
 * 测试模块 demo —— 左侧 JSON 驱动的响应式页面,右侧 Agent 对话框
 *
 * 配置方式:reactive 对象经 dataSlots 的 `bind` 字段直连 SDK(自动挂 window + 注册 dataSlot),
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作属性」段,无需手写)。
 * Agent 经 write 改 page.* 属性 → 左侧 PageRenderer 响应式更新。
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import { defineSkill } from '../../src/core/harness/skills'
import type { Middleware } from '../../src/core/harness/middleware'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import { initialPage, pageSchema, pageBuilderSkillContent } from './pageSchema'

const cfg = useAgentConfig()

// 顶层(同步):先建响应式 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行,需此时已就位)
const pageObj = reactive({
  title: initialPage.title,
  theme: initialPage.theme,
  components: initialPage.components.map((c) => ({ ...c })),
})
;(window as any).page = pageObj

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

/**
 * 自定义中间件示例:对话埋点
 * 演示 afterModel / wrapToolCall / afterAgent 三个观察钩子。
 * npm run dev 后打开控制台,对话时可见:每轮模型响应、每个工具调用耗时、对话结束。
 */
const analyticsMiddleware: Middleware = {
  name: 'analytics-demo',
  afterModel: (res) => {
    console.log('%c[analytics] 模型响应', 'color:#10b981;font-weight:bold', {
      内容长度: res.content.length,
      工具调用数: res.toolCalls.length,
    })
  },
  wrapToolCall: async (ctx, next) => {
    const t = Date.now()
    const result = await next(ctx)
    console.log(
      '%c[analytics] 工具调用',
      'color:#3b82f6;font-weight:bold',
      ctx.name,
      `+${Date.now() - t}ms`,
      result.status,
    )
    return result
  },
  afterAgent: () => console.log('%c[analytics] 本轮对话结束', 'color:#6b7280'),
}

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'page-demo',                             // ← 稳定 id:刷新后恢复历史(多 agent 共存各自隔离)
    storage: 'indexed',                          // ← 开启持久化(默认关闭);可选 'session'/'local'/'memory'
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    streaming: true,
    systemPrompt:
      '你是页面构建助手。左侧页面由 window.page 驱动,用户要改左侧页面(改标题/换主题/增删改组件)时,改 page 对应字段,左侧实时更新。组件结构详见 load_skill("page-builder")。',
    // ↓ dataSlots 统一配置:bind 字段直连 reactive 对象(自动挂 window + 注册 dataSlot),schema 的 .describe() 自动注入字段说明到 systemPrompt
    dataSlots: [
      { path: 'page', schema: pageSchema, bind: pageObj },
    ],
    skills: [
      defineSkill({
        name: 'page-builder',
        description: '编辑 JSON 驱动的响应式页面(window.page)。用户要求改左侧页面(增删改组件 / 改标题 / 换主题)时使用',
        getContent: () => pageBuilderSkillContent,
      }),
    ],
    middleware: [analyticsMiddleware], // ← 自定义中间件示例(内置 todos/skills/vfs... 之后执行)
    debug: true,
    title: '页面构建 Agent',
    placeholder: '试试:加一个"提交"按钮 / 主题改成 dark / 删掉列表 …',
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
