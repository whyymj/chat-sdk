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
import EditableBanner from '../_shared/EditableBanner.vue'
import DynamicReconfigPanel from './DynamicReconfigPanel.vue'
import PageConfigPanel from './PageConfigPanel.vue'
import { initialPage, pageSchema, complexBuilderSkillContent } from './pageSchema'
console.log('pageSchema---->>>>', pageSchema)
const cfg = useAgentConfig()

// 顶层(同步):先建响应式 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行)
const pageObj = reactive({
  title: initialPage.title,
  components: initialPage.components.map((c) => ({ ...c })),
})
;(window as any).page = pageObj

// 发布状态(发布后显示时间戳,PageConfigPanel + agent publish action 共用)
const publishStatus = ref('')
/** 保存草稿:序列化 page → localStorage(供 PageConfigPanel 保存按钮 + agent save_draft action 复用) */
function saveDraft(): string {
  try { localStorage.setItem('complex-demo-draft', JSON.stringify({ title: pageObj.title, components: pageObj.components })) } catch { /* localStorage 不可用时静默 */ }
  return `草稿已保存(${pageObj.components.length} 个组件)。`
}
/** 发布页面(模拟):记录发布时间戳 */
function publish(): string {
  const ts = new Date().toLocaleString()
  publishStatus.value = `已发布 @ ${ts}`
  return `页面已发布(${pageObj.components.length} 个组件)@ ${ts}。`
}
/** 重置到 initialPage(splice 保留 reactive 引用) */
function resetPage(): void {
  pageObj.title = initialPage.title
  pageObj.components.splice(0, pageObj.components.length, ...initialPage.components.map((c) => ({ ...c })))
}

const root = ref<HTMLElement>()
const agentRef = ref<ChatSdk | null>(null)
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
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    // data 单主对象配置:schema + bind 直连 reactive 对象,工具直接读写 bind(集成方自己挂 window.page 供 PageRenderer 读)
    data: { schema: pageSchema, bind: pageObj },
    // 胜任自动化:agent 能读渲染后 DOM(get_dom,看修改是否生效)+ 触发宿主页面动作(保存/发布,与配置面板同等)
    capabilities: { domInspect: true },
    actions: {
      save_draft: { description: '保存当前页面为草稿(序列化 page 到 localStorage)。用户要求保存/存草稿时调用,无需参数。', run: saveDraft },
      publish: { description: '发布当前页面(模拟发布,记录发布时间戳)。用户要求发布/上线/生效时调用,无需参数。', run: publish },
      refresh_preview: {
        description: '返回当前页面概况(标题 + 组件数)。用户询问页面状态/有多少组件时调用。',
        run: () => `当前页面「${pageObj.title}」共 ${pageObj.components.length} 个组件。`,
      },
    },
    // interceptors.write:agent push 新组件时自动补 id(若未设)—— agent 无需关心 id 生成,拦截器兜底
    // (演示拦截器补充能力:即使 agent 只传 { type:'heading', props:{...} },落地时也有稳定 id 供锚点/调试)
    interceptors: {
      write: (payload) => {
        if (payload && Array.isArray((payload as any).components)) {
          let i = 0
          ;(payload as any).components = (payload as any).components.map((c: any) => {
            if (!c.id) c.id = `cmp-${Date.now()}-${i++}`
            return c
          })
        }
        return payload
      },
    },
    skills: [
      defineSkill({
        name: 'complex-builder',
        description: '编辑组件拼装的复杂页面(window.page,含 container/section/grid 容器可嵌套 children)。用户要求改左侧页面(增删改组件 / 调 props / 调样式 / 容器内嵌套)时使用',
        getContent: () => complexBuilderSkillContent,
      }),
    ],
    // 预声明子 agent:配空数组占位,启用 SubagentsController(供动态重配置面板 addSubagent/removeSubagent 生效)
    subagents: [],
    debug: true,
    dialog: {
      title: '复杂页面 Agent',
      placeholder: '试试:加一个商品卡片 / 标题改成红色 / 轮播换成 3 张图 / 商品瀑布流改成 4 列 …',
    },
  })
  agent.mount()
  agentRef.value = agent
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <DynamicReconfigPanel :agent="agentRef" />
      <PageConfigPanel :page="pageObj" :on-save="saveDraft" :on-publish="publish" :on-reset="resetPage" :publish-status="publishStatus" />
      <EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区">
        <PageRenderer />
      </EditableBanner>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style>
/* 全局重置:消除 body 默认 margin + 防止 100vw/100vh 导致页面级滚动条
   (100vw 含竖向滚动条宽度 → 横向溢出;body margin + 100vh → 竖向溢出 → 滚动条遮挡聊天输入框) */
html, body, #app { margin: 0; padding: 0; height: 100%; overflow: hidden; }
</style>

<style scoped>
.layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.pane-left {
  flex: 1;
  overflow: auto;
  background: #ffffff;
  padding: 20px;
}
.pane-right {
  width: 50%;
  flex: 1;
  border-left: 1px solid #e5e7eb;
  background: #fff;
  /* 防止 pane-right 自身溢出导致滚动条遮挡 chat-footer */
  overflow: hidden;
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
