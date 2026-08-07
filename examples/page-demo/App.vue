<script setup lang="ts">
/**
 * 测试模块 demo —— 左侧 JSON 驱动的页面,右侧 Agent 对话框
 *
 * 展示「非 Vue 响应式」集成模式:bind 用普通对象(非 reactive),SDK 工具直接读写 bind;
 * UI 刷新由集成方负责 —— 监听 onEvent('data_change') 触发 tick,:key 强制重渲染画布。
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作数据」段,无需手写)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import { defineSkill } from '../../src/core/harness/skills'
import type { Middleware } from '../../src/core/harness/middleware'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import { initialPage, pageSchema, pageBuilderSkillContent } from './pageSchema'

const cfg = useAgentConfig()

// 顶层(同步):先建普通对象 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行,需此时已就位)
// 非 reactive:SDK 工具直接读写此对象,但 Vue 模板不会自动响应 → 靠 tick 重渲染
const pageObj = {
  title: initialPage.title,
  theme: initialPage.theme,
  components: initialPage.components.map((c) => ({ ...c })),
}
;(window as any).page = pageObj

// tick:onEvent('data_change') 时 ++,:key="tick" 强制 PageRenderer 重建读最新 page
const tick = ref(0)

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
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    // ↓ data 单主对象:schema + bind 直连普通对象(集成方自己挂 window.page 供模板读),schema 的 .describe() 自动注入字段说明到 systemPrompt
    data: { schema: pageSchema, bind: pageObj },
    skills: [
      defineSkill({
        name: 'page-builder',
        description: '编辑 JSON 驱动的页面(window.page)。用户要求改左侧页面(增删改组件 / 改标题 / 换主题)时使用',
        getContent: () => pageBuilderSkillContent,
      }),
    ],
    middleware: [analyticsMiddleware], // ← 自定义中间件示例(内置 todos/skills/vfs... 之后执行)
    // ↓ 非 reactive bind:监听 data_change 触发 tick,:key 强制画布重渲染读最新 page
    onEvent(e) {
      if (e.type === 'data_change') tick.value++
    },
    debug: true,
    dialog: {
      title: '页面构建 Agent',
      placeholder: '试试:加一个"提交"按钮 / 主题改成 dark / 删掉列表 …',
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
      <EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区">
        <PageRenderer :key="tick" :page="pageObj" />
      </EditableBanner>
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
  background: var(--ark-bg);
  padding: 20px;
  color: var(--ark-fg);
}
.pane-right {
  width: 50%;
  flex: 1;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--ark-panel);
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
