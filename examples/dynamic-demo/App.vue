<script setup lang="ts">
/**
 * 动态注册组件示例 —— 演示「懒加载、结构各异的组件」如何经 sdk.addWindowProp / removeWindowProp 运行时注册。
 *
 * 演示能力:
 *  ① 组件懒加载:点击「加载」按钮动态新增不同类型组件(banner/card/stat/chart),结构各异,schema 各不同
 *  ② 动态注册:组件挂载时 sdk.addWindowProp({ path: `app.components.<id>`, schema }) 注册其 schema
 *  ③ 即时生效:注册后 AI 立即可 set/edit 该 path,按其 schema 校验(无需重建 agent)
 *  ④ 动态移除:组件卸载时 sdk.removeWindowProp(path),快照栈一并清理
 *  ⑤ inspect 反映:右侧「已注册属性」实时显示当前注册项(含动态增删)
 *  ⑥ 响应式:左侧组件列表由 window.app.components(reactive)驱动,AI 改子属性 → 实时更新
 *
 * 运行:npm run dev → 访问 /examples/dynamic-demo/
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { createChatSdk, z, systemPromptHelpers, type ChatSdk, type WindowPropSpec } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'
import { compSchemas, compTypeDescriptions, compTypeLabels, createComp, type AnyComp, type CompType } from './componentSchemas'

// 宿主 window.app.components:动态组件容器(reactive)
const w = window as any
if (!w.app) w.app = { components: {} as Record<string, AnyComp> }
if (!w.app.components) w.app.components = {}
const components = w.app.components as Record<string, AnyComp>

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 已加载组件 id 列表(响应式,用于渲染左侧列表)
const loadedIds = ref<string[]>([])
const compTypes: CompType[] = ['banner', 'card', 'stat', 'chart']

// 当前已注册的 windowProps(从 sdk.listWindowProps() 实时取,反映动态增删)
const registeredProps = ref<WindowPropSpec[]>([])
function refreshRegistered() {
  registeredProps.value = agent?.listWindowProps() ?? []
}

// 加载一个组件 → 动态注册其 schema
let seq = 0
function loadComp(type: CompType) {
  const id = `${type}-${++seq}`
  const comp = createComp(type, id)
  components[id] = reactive(comp) as AnyComp
  loadedIds.value.push(id)
  // ★ 动态注册:组件挂载时注册其 schema,立即对 AI 生效
  //   description 写详细字段(给 LLM 看的字段说明书;LLM 看不到 schema 字段定义,只看 description)
  agent?.addWindowProp({
    path: `app.components.${id}`,
    description: `${compTypeDescriptions[type]}(动态注册,id=${id})`,
    schema: compSchemas[type],
  })
  refreshRegistered()
}

// 卸载一个组件 → 动态移除其注册
function unloadComp(id: string) {
  delete components[id]
  loadedIds.value = loadedIds.value.filter((x) => x !== id)
  // ★ 动态移除:组件卸载时移除注册,快照栈一并清理
  agent?.removeWindowProp(`app.components.${id}`)
  refreshRegistered()
}

const loadedList = computed(() => loadedIds.value.map((id) => ({ id, comp: components[id] })))

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'dynamic-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // 静态常驻项:整体容器(宽松 schema,供 AI 了解结构);具体组件 path 由 addWindowProp 动态注册
    windowProps: [
      { path: 'app.components', description: '动态组件容器(按 id 存,结构各异;各组件 path 由 sdk.addWindowProp 动态注册)', schema: z.record(z.string(), z.any()) },
    ],
    systemPrompt: [
      '你是页面组件助手。window.app.components 是动态组件容器,按组件 id 为键存对象。',
      '每个组件有自己的 type(banner/card/stat/chart),结构各异;具体组件的 path(如 app.components.banner-1)由集成方动态注册,你可用 list_window_props 查看当前可操作的具体组件 path。',
      '操作指南:',
      '1. 先 list_window_props 查看当前已注册的可操作组件 path(动态增删,实时变化);',
      '2. 改某组件用 edit_window_prop 的 set,jsonPath 相对 app.components.<id>,如改 banner-1 标题:jsonPath="banner-1.title";',
      '3. 各组件 schema 不同:banner{title,bg,color}/ card{title,price,tag?}/ stat{label,value,unit?}/ chart{chartType,data[]};',
      '4. 改前可用 describe_window_prop 或 get_window_prop 确认字段;非法值会被 schema 校验拒绝。',
      systemPromptHelpers.reliableWriteRules,
    ].join('\n'),
    onEvent(e) {
      if (e.type === 'window_prop_change') refreshRegistered()
    },
    debug: true,
    title: '动态注册组件',
    placeholder: '先点左侧「加载」加几个组件,再让我改(如:把 banner-1 标题改成「限时特惠」)',
  })
  agent.mount()
  refreshRegistered()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🧩 动态注册组件(window.app.components)</h2>
      <p class="hint">
        组件<strong>懒加载</strong>:点击下方按钮动态新增不同类型组件(结构各异)。<br />
        组件挂载时调 <code>sdk.addWindowProp</code> 注册其 schema → AI <strong>立即可操作</strong>(无需重建 agent);卸载时 <code>sdk.removeWindowProp</code> 移除。
      </p>

      <div class="load-bar">
        <button v-for="t in compTypes" :key="t" class="btn-load" @click="loadComp(t)">
          + 加载 {{ compTypeLabels[t] }}
        </button>
      </div>

      <h3>已加载组件({{ loadedIds.length }})</h3>
      <div v-if="!loadedIds.length" class="empty">暂未加载组件。点击上方按钮加载,再让 AI 操作。</div>
      <ul v-else class="comp-list">
        <li v-for="{ id, comp } in loadedList" :key="id" class="comp-item">
          <div class="comp-head">
            <span class="comp-type">{{ compTypeLabels[comp.type] }}</span>
            <span class="comp-id">#{{ id }}</span>
            <button class="btn-unload" @click="unloadComp(id)">卸载</button>
          </div>
          <pre class="comp-json">{{ JSON.stringify(comp, null, 2) }}</pre>
        </li>
      </ul>

      <h3>当前已注册 windowProps({{ registeredProps.length }})</h3>
      <p class="hint small">来自 <code>sdk.listWindowProps()</code>,反映动态增删的实时状态:</p>
      <ul class="reg-list">
        <li v-for="p in registeredProps" :key="p.path">
          <code>{{ p.path }}</code> — <span class="reg-desc">{{ p.description }}</span>
        </li>
      </ul>

      <p class="try">
        💡 试试:加载几个组件 → 对话框输入「把 banner-1 标题改成『限时特惠』、背景改成 #b91c1c」<br />
        或「card-1 价格改成 59、tag 改成『秒杀』」→ AI 调 <code>edit_window_prop</code> 按 jsonPath 改,左侧实时更新
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
h3 { font-size: 14px; margin: 18px 0 8px; color: #374151; }
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 14px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.hint.small { font-size: 12px; margin: 0 0 6px; }

.load-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.btn-load { padding: 7px 14px; border: 1px solid #1f4d3a; background: #1f4d3a; color: #fff; border-radius: 7px; font-size: 13px; cursor: pointer; }
.btn-load:hover { background: #163a2c; }

.empty { font-size: 13px; color: #9ca3af; padding: 14px; background: #fff; border: 1px dashed #d1d5db; border-radius: 8px; text-align: center; }
.comp-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.comp-item { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
.comp-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.comp-type { font-size: 13px; font-weight: 600; color: #1f4d3a; }
.comp-id { font-size: 11px; color: #9ca3af; font-family: ui-monospace, monospace; }
.btn-unload { margin-left: auto; padding: 3px 10px; border: 1px solid #ef4444; background: #fff; color: #ef4444; border-radius: 5px; font-size: 12px; cursor: pointer; }
.btn-unload:hover { background: #fef2f2; }
.comp-json { font-size: 11px; line-height: 1.5; color: #374151; background: #f9fafb; border-radius: 6px; padding: 8px; margin: 0; font-family: ui-monospace, monospace; overflow-x: auto; }

.reg-list { list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 1.8; }
.reg-list li { color: #4b5563; }
.reg-list code { background: #ecfdf5; color: #065f46; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.reg-desc { color: #6b7280; }

.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 14px; line-height: 1.7; }
.try code { background: #fff; color: #6d28d9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
