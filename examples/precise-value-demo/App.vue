<script setup lang="ts">
/**
 * 精确值保护(placeholder-protected-read-write)demo
 *
 * 展示 data.resources 声明受保护字段后:
 *  - read 受保护路径 → 占位符 ⟦frozen:path⟧ / ⟦res:handle⟧(精确值不入 LLM 消息流)
 *  - 写侧强制:freeze 不可改(FROZEN_FIELD)/ verbatim 改值须经 resource_update(VERBATIM_MISMATCH)
 *  - resource_get 取真值 / resource_update 改 verbatim / resource_list/delete
 *  - 跨压缩 pin:每轮 systemPrompt 注入「受保护资源」段
 *
 * 对话试试:
 *  - 「读一下 token」→ AI 看到 ⟦res:handle⟧ 占位符(不是真 token)
 *  - 「改 title 为 xxx」→ 放行(title 非受保护)
 *  - 「改 id 为 abc」→ 被 FROZEN_FIELD 拒
 *  - 「刷新 token」→ AI 用 resource_update 更新 verbatim
 *  - 「token 的真值是什么」→ AI 用 resource_get 取
 */
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import { useAgentConfig } from '../page-demo/useAgentConfig'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import { preciseSchema, resourcesConfig, initialData } from './preciseSchema'

const cfg = useAgentConfig()

// reactive bind:AI write → 响应式自动刷新模板(无需 tick)
const dataObj = reactive(JSON.parse(JSON.stringify(initialData)))
;(window as any).preciseData = dataObj

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'precise-value-demo',
    storage: 'memory',
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature || 0.3,  // 操作精确值建议低温
      maxTokens: cfg.maxTokens,
    },
    streaming: true,
    systemPrompt:
      '你是配置管理助手。主数据含受保护字段(集成方在 data.resources 声明):id(freeze 只读)、token 与 items.0.hash(verbatim 原样保留)。read 这些字段会看到占位符 ⟦frozen:path⟧/⟦res:handle⟧(精确值不在消息流),需真值用 resource_get({path})。改 title / items[].name 等普通字段自由;改 id 会被 FROZEN_FIELD 拒(放弃该字段);改 token/hash 需先 resource_update({path,value}) 再写回句柄,否则 VERBATIM_MISMATCH。撞 RESOURCE_EVICTED/NOT_FOUND 重新 read 懒注册。',
    data: { schema: preciseSchema, bind: dataObj, resources: resourcesConfig, description: '用户配置(含受保护字段 id/token/hash)' },
    toolMode: 'advanced',  // advanced 暴露 resource_get/update/list/delete
    debug: true,
    dialog: {
      title: '精确值保护 Demo',
      placeholder: '试试:读 token / 改 title / 改 id(被拒)/ 刷新 token',
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
      <EditableBanner title="主数据(含受保护字段)" hint="AI 经 write 修改;🔒 freeze / 📝 verbatim 受保护">
        <div class="data-card">
          <div class="field freeze">
            <span class="tag">🔒 freeze</span>
            <span class="label">id:</span>
            <code>{{ dataObj.id }}</code>
            <span class="dim">(AI 看不到真值,不可改)</span>
          </div>
          <div class="field verbatim">
            <span class="tag">📝 verbatim</span>
            <span class="label">token:</span>
            <code class="break">{{ dataObj.token }}</code>
          </div>
          <div class="field">
            <span class="tag plain">普通</span>
            <span class="label">title:</span>
            <code>{{ dataObj.title }}</code>
            <span class="dim">(AI 可自由改)</span>
          </div>
          <div class="field">
            <span class="tag plain">普通</span>
            <span class="label">items[0].name:</span>
            <code>{{ dataObj.items[0].name }}</code>
          </div>
          <div class="field verbatim">
            <span class="tag">📝 verbatim</span>
            <span class="label">items[0].hash:</span>
            <code>{{ dataObj.items[0].hash }}</code>
          </div>
        </div>
      </EditableBanner>
      <div class="hint">
        <p><b>🔒 freeze(id)</b>:AI read 看到 <code>⟦frozen:id⟧</code> 占位符(精确值不入消息流);写会被 <code>FROZEN_FIELD</code> 拒。</p>
        <p><b>📝 verbatim(token/hash)</b>:AI read 看到 <code>⟦res:handle⟧</code> 占位符,原值在资源池;改值经 <code>resource_update</code> 同步 bind,直接写新值 <code>VERBATIM_MISMATCH</code>。</p>
        <p class="try">👉 对话试试:让 AI「读 token」(看占位符)、「改 title」(放行)、「改 id」(被拒)、「刷新 token 为新值」(resource_update)。</p>
      </div>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: var(--ark-bg); padding: 20px; color: var(--ark-fg); }
.pane-right { width: 50%; flex: 1; border-left: 1px solid rgba(255,255,255,0.06); background: var(--ark-panel); }
.pane-right > :deep(.chat-dialog) { width: 100%; height: 100%; }
.data-card { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; font-size: 13px; line-height: 1.6; }
.field.freeze { background: rgba(239,68,68,0.08); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #ef4444; }
.field.verbatim { background: rgba(245,158,11,0.08); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #f59e0b; }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; font-weight: 600; white-space: nowrap; }
.tag:not(.plain) { background: rgba(255,255,255,0.1); }
.freeze .tag { background: #ef4444; color: #fff; }
.verbatim .tag { background: #f59e0b; color: #fff; }
.tag.plain { background: rgba(255,255,255,0.06); color: var(--ark-fg); opacity: 0.7; }
.label { font-weight: 600; opacity: 0.9; }
code { background: rgba(0,0,0,0.3); padding: 1px 5px; border-radius: 3px; font-size: 12px; word-break: break-all; }
.break { word-break: break-all; }
.dim { opacity: 0.5; font-size: 12px; }
.hint { margin-top: 16px; padding: 12px 14px; background: rgba(59,130,246,0.08); border-radius: 8px; font-size: 12.5px; line-height: 1.7; }
.hint p { margin: 4px 0; }
.hint .try { margin-top: 10px; font-weight: 600; }
</style>
