<script setup lang="ts">
/**
 * 动态组件示例 —— 演示「懒加载、结构各异的组件」如何用单主数据 + edit_data 增量管理 + setSkills 动态注入组件说明。
 *
 * 演示能力:
 *  ① 组件懒加载:点击「加载」按钮动态新增不同类型组件(banner/card/stat/chart),结构各异
 *  ② 单主数据:window.app.components 是动态组件容器(record),schema 宽松(z.record),组件结构各异由 skill 描述
 *  ③ 集成方代码直接改 bind:组件挂载/卸载由集成方代码直接改 appObj.components(普通对象),agent 可读可改
 *  ④ agent 增量改:agent 用 edit_data 改 components.<id>.<field>(jsonPath 相对主数据根)
 *  ⑤ setSkills 动态组件说明:每种组件类型对应一个 skill(load_skill comp-<type> 取字段说明),loadComp/unloadComp 后按已加载类型集合 sdk.setSkills 动态注入/移除,agent 操作前按需 load_skill
 *  ⑥ 刷新:bind 用普通对象(非 reactive),agent 改后由 onEvent('data_change') 触发 tick 重渲染
 *
 * 运行:npm run dev → 访问 /examples/dynamic-demo/
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, defineSkill, z, type ChatSdk, type SkillSpec } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import { compTypeDescriptions, compTypeLabels, createComp, type AnyComp, type CompType } from './componentSchemas'

// 主数据:动态组件容器(普通对象,非 reactive);集成方自己挂 window.app 供页面读取
// Vue 模板不自动响应 → 靠 tick(onEvent + load/unload)触发重渲染
const appObj: { components: Record<string, AnyComp> } = { components: {} }
;(window as any).app = appObj
const components = appObj.components

// tick:data_change 或 load/unload 时 ++,触发 loadedList computed 重算
const tick = ref(0)

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 已加载组件 id 列表(响应式,用于渲染左侧列表)
const loadedIds = ref<string[]>([])
const compTypes: CompType[] = ['banner', 'card', 'stat', 'chart']

// 当前已加载组件(从主数据 components 的 keys 实时取)
const registeredIds = ref<string[]>([])
function refreshRegistered() {
  registeredIds.value = Object.keys(components)
}

// 每种组件类型对应一个 skill:描述该类型组件的字段结构 + 操作指引(操作某类型组件前 load_skill 获取)
// loadComp/unloadComp 后按「当前已加载组件的类型集合」sdk.setSkills 动态注入对应 skill,卸载类型后自动移除
const compSkills: Record<CompType, SkillSpec> = {
  banner: defineSkill({
    name: 'comp-banner',
    description: 'Banner 横幅组件的字段说明与操作指引(操作 banner-* 组件前加载)',
    getContent: () => compTypeDescriptions.banner + '\n\njsonPath 示例:components.<id>.title / components.<id>.bg / components.<id>.color',
  }),
  card: defineSkill({
    name: 'comp-card',
    description: 'Card 商品卡组件的字段说明与操作指引(操作 card-* 组件前加载)',
    getContent: () => compTypeDescriptions.card + '\n\njsonPath 示例:components.<id>.title / components.<id>.price / components.<id>.tag',
  }),
  stat: defineSkill({
    name: 'comp-stat',
    description: 'Stat 指标组件的字段说明与操作指引(操作 stat-* 组件前加载)',
    getContent: () => compTypeDescriptions.stat + '\n\njsonPath 示例:components.<id>.label / components.<id>.value / components.<id>.unit',
  }),
  chart: defineSkill({
    name: 'comp-chart',
    description: 'Chart 图表组件的字段说明与操作指引(操作 chart-* 组件前加载)',
    getContent: () => compTypeDescriptions.chart + '\n\njsonPath 示例:components.<id>.chartType / components.<id>.data',
  }),
}

// 按当前已加载组件的类型集合,动态替换 skill 列表(同名覆盖;清缓存,下轮 system prompt 索引重渲染)
function syncSkills() {
  if (!agent) return
  const loadedTypes = new Set<CompType>()
  for (const id of loadedIds.value) {
    const t = id.split('-')[0] as CompType
    if (t in compSkills) loadedTypes.add(t)
  }
  agent.setSkills([...loadedTypes].map((t) => compSkills[t]))
}

// 加载一个组件 → 集成方代码直接改主数据(普通对象,agent 可读可改);tick++ 触发列表重渲染;syncSkills 动态注入该类型组件说明
let seq = 0
function loadComp(type: CompType) {
  const id = `${type}-${++seq}`
  const comp = createComp(type, id)
  components[id] = comp
  loadedIds.value.push(id)
  refreshRegistered()
  tick.value++
  syncSkills()
}

// 卸载一个组件 → 直接从主数据移除;tick++ 触发列表重渲染;syncSkills 动态移除该类型组件说明(若该类型已无组件)
function unloadComp(id: string) {
  delete components[id]
  loadedIds.value = loadedIds.value.filter((x) => x !== id)
  refreshRegistered()
  tick.value++
  syncSkills()
}

// loadedList 依赖 tick(普通对象改属性不触发 computed,需 tick 驱动重算)
const loadedList = computed(() => {
  void tick.value
  return loadedIds.value.map((id) => ({ id, comp: components[id] }))
})

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
    // 单主数据:动态组件容器(record),schema 宽松(组件结构各异,由 systemPrompt 描述各 type 字段)
    data: {
      schema: z.object({
        components: z.record(z.string(), z.any()).describe('动态组件容器(按 id 存,结构各异)'),
      }),
      bind: appObj,
      description: '动态组件容器(按组件 id 为键存对象,各组件 type 不同结构各异)',
    },
    systemPrompt: [
      '你是页面组件助手。主数据(挂 window.app)的 components 是动态组件容器,按组件 id 为键存对象。',
      '组件由集成方代码动态增删,实时变化;操作前先 read 查看当前存在的组件 id。',
      '各组件有自己的 type(banner/card/stat/chart),字段结构各异;操作某类型组件前,先 load_skill comp-<type> 获取该类型字段说明(如操作 banner-1 前 load_skill comp-banner)。',
      '改某组件时 jsonPath 相对主数据根(如改 banner-1 标题:jsonPath="components.banner-1.title")。',
    ].join('\n'),
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    onEvent(e) {
      if ((e as any).type === 'data_change') {
        refreshRegistered()
        tick.value++
      }
    },
    debug: true,
    title: '动态组件(单主数据)',
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
      <h2>🧩 动态组件(window.app.components)</h2>
      <p class="hint">
        组件<strong>懒加载</strong>:点击下方按钮动态新增不同类型组件(结构各异)。<br />
        集成方代码直接改主数据 <code>appObj.components</code>(普通对象)→ AI 经 <code>edit_data</code> 按 jsonPath 改子属性,改动经 <code>onEvent('data_change')</code> 触发 tick 重渲染。<br />
        <strong>setSkills 动态说明</strong>:加载/卸载组件时按已加载类型集合 <code>sdk.setSkills</code> 动态注入对应 <code>comp-&lt;type&gt;</code> skill,AI 操作前 <code>load_skill</code> 取该类型字段说明。
      </p>

      <div class="load-bar">
        <button v-for="t in compTypes" :key="t" class="btn-load" @click="loadComp(t)">
          + 加载 {{ compTypeLabels[t] }}
        </button>
      </div>

      <h3>已加载组件({{ loadedIds.length }})</h3>
      <EditableBanner title="AI 可编辑数据" hint="Agent 经 write 按 jsonPath 改此区">
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
      </EditableBanner>

      <h3>当前主数据 components keys({{ registeredIds.length }})</h3>
      <p class="hint small">来自 <code>Object.keys(appObj.components)</code>,反映动态增删的实时状态:</p>
      <ul class="reg-list">
        <li v-for="id in registeredIds" :key="id">
          <code>components.{{ id }}</code> — <span class="reg-desc">{{ compTypeDescriptions[(compTypes.find(t=>id.startsWith(t+'-'))) as CompType] }}</span>
        </li>
      </ul>

      <p class="try">
        💡 试试:加载几个组件 → 对话框输入「把 banner-1 标题改成『限时特惠』、背景改成 #b91c1c」<br />
        或「card-1 价格改成 59、tag 改成『秒杀』」→ AI 调 <code>write</code> 按 patch jsonPath 改,onEvent 触发 tick 重渲染
      </p>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: #ffffff; padding: 28px 32px; }
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
