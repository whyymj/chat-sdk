<script setup lang="ts">
/**
 * 动态重配置演示面板 —— 一次性展示 add-dynamic-reconfiguration 新增 API 的使用场景与说明
 *
 * 新增 API(零破坏,不调用 = 现状):
 * - sdk.setTools / addTool / removeTool:运行时增删用户工具(内置不动,内部 rebind)
 * - sdk.setLlm:运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)
 * - sdk.setMemory:运行时更新持久指令 memory
 * - sdk.setSubagents / addSubagent / removeSubagent:运行时增删预声明子 agent(需创建时配 subagents:[])
 *
 * 面板每个按钮触发一次演示动作,实时显示 inspect() 的 before/after 快照(tools/model/memory/subagent)。
 */
import { ref, computed } from 'vue'
import { defineTool, type ChatSdk } from '../../src/core'
import { z } from 'zod'

const props = defineProps<{ agent: ChatSdk | null }>()

const collapsed = ref(false)
const log = ref<string[]>([])

function pushLog(line: string) {
  log.value.unshift(`${new Date().toLocaleTimeString()}  ${line}`)
  if (log.value.length > 20) log.value.pop()
}

const snapshot = computed(() => {
  if (!props.agent) return null
  const info = props.agent.inspect()
  return {
    toolsCount: info.tools.length,
    toolNames: info.tools.map((t) => t.name),
    model: info.model,
    memory: info.memory,
    subagents: info.subagent.subagents ?? [],
  }
})

// ===== 1. setTools / addTool / removeTool =====
function demoAddTool() {
  if (!props.agent) return
  const before = props.agent.inspect().tools.length
  props.agent.addTool(
    defineTool({
      name: 'query_stock',
      description: '查询商品库存(演示动态注入的用户工具)',
      schema: z.object({ sku: z.string().describe('商品 SKU') }),
      handler: async ({ sku }) => `库存查询(演示):SKU ${sku} 当前库存 99 件`,
    }),
  )
  const after = props.agent.inspect().tools.length
  pushLog(`addTool('query_stock') → 工具数 ${before} → ${after}(inspect().tools 含 query_stock)`)
}

function demoRemoveTool() {
  if (!props.agent) return
  const before = props.agent.inspect().tools.length
  const ok = props.agent.removeTool('query_stock')
  const after = props.agent.inspect().tools.length
  pushLog(`removeTool('query_stock') → ${ok ? '成功' : '未找到'};工具数 ${before} → ${after}`)
}

function demoSetTools() {
  if (!props.agent) return
  const before = props.agent.inspect().tools.length
  // 整体替换为单个工具(演示:按业务阶段只保留必要工具)
  props.agent.setTools([
    defineTool({
      name: 'page_analytics',
      description: '页面埋点上报(演示 setTools 整体替换)',
      schema: z.object({ event: z.string().describe('事件名') }),
      handler: async ({ event }) => `已上报事件:${event}`,
    }),
  ])
  const after = props.agent.inspect().tools.length
  pushLog(`setTools([page_analytics]) → 工具数 ${before} → ${after}(用户工具整体替换,内置不动)`)
}

// ===== 2. setLlm =====
function demoSetLlm() {
  if (!props.agent) return
  const before = props.agent.inspect().model
  // 演示:切到 gpt-4o(仅切换配置,不实际调用;真实场景配额耗尽切便宜模型 / 复杂任务切强模型)
  props.agent.setLlm({
    apiKey: 'sk-demo-not-real',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    temperature: 0.3,
  })
  const after = props.agent.inspect().model
  pushLog(`setLlm({model:'gpt-4o'}) → model ${before} → ${after}(rebind + 重解析能力)`)
}

// ===== 3. setMemory =====
function demoSetMemory() {
  if (!props.agent) return
  const before = props.agent.inspect().memory
  props.agent.setMemory('用户偏好:回答尽量简洁;修改组件时优先用增量 patch。')
  const after = props.agent.inspect().memory
  pushLog(`setMemory('用户偏好...') → memory "${before || '(空)'}" → "${after}"(下轮 augmentPrompt 注入)`)
}

function demoClearMemory() {
  if (!props.agent) return
  props.agent.setMemory('')
  pushLog(`setMemory('') → memory 清空(空串跳过注入)`)
}

// ===== 4. setSubagents / addSubagent / removeSubagent =====
function demoAddSubagent() {
  if (!props.agent) return
  const before = (props.agent.inspect().subagent.subagents ?? []).length
  props.agent.addSubagent({
    id: 'translator',
    description: '翻译子 agent(中英互译,演示动态注入)',
    systemPrompt: '你是翻译助手,中英互译。',
  })
  const after = (props.agent.inspect().subagent.subagents ?? []).length
  pushLog(`addSubagent({id:'translator'}) → 子 agent ${before} → ${after}(生成 use_translator 委派工具)`)
}

function demoRemoveSubagent() {
  if (!props.agent) return
  const before = (props.agent.inspect().subagent.subagents ?? []).length
  const ok = props.agent.removeSubagent('translator')
  const after = (props.agent.inspect().subagent.subagents ?? []).length
  pushLog(`removeSubagent('translator') → ${ok ? '成功' : '未找到'};子 agent ${before} → ${after}`)
}
</script>

<template>
  <div class="reconfig-panel">
    <div class="panel-header" @click="collapsed = !collapsed">
      <span class="title">⚡ 动态重配置演示(add-dynamic-reconfiguration 新增 API)</span>
      <span class="toggle">{{ collapsed ? '展开 ▼' : '收起 ▲' }}</span>
    </div>

    <div v-show="!collapsed" class="panel-body">
      <!-- 实时 inspect 快照 -->
      <div class="snapshot">
        <div class="snap-title">当前 inspect() 快照</div>
        <div class="snap-grid">
          <div><b>model</b>:<code>{{ snapshot?.model || '-' }}</code></div>
          <div><b>tools</b>:<code>{{ snapshot?.toolsCount }} 个</code></div>
          <div><b>memory</b>:<code>{{ snapshot?.memory ? `"${snapshot.memory.slice(0, 24)}${snapshot.memory.length > 24 ? '…' : ''}"` : '(空)' }}</code></div>
          <div><b>subagents</b>:<code>{{ snapshot?.subagents.length }} 个</code></div>
        </div>
      </div>

      <!-- 1. tools 动态化 -->
      <div class="section">
        <div class="sec-title">1️⃣ 工具动态化(setTools / addTool / removeTool)</div>
        <div class="sec-doc">
          运行时增删<b>用户工具</b>(内置工具由 capabilities 控制,不动)。内部 rebindTools 重新绑定到 LLM,下一轮即生效。
          适用:按权限/业务阶段/A-B 实验动态切换工具组,无需重建 agent。
        </div>
        <div class="btns">
          <button @click="demoAddTool">addTool('query_stock')</button>
          <button @click="demoRemoveTool">removeTool('query_stock')</button>
          <button @click="demoSetTools">setTools([page_analytics])</button>
        </div>
      </div>

      <!-- 2. llm 动态化 -->
      <div class="section">
        <div class="sec-title">2️⃣ LLM 动态切换(setLlm)</div>
        <div class="sec-doc">
          运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)。参数 BaseChatModel 或 LLMConfig;
          rebind + 重解析模型能力(contextWindow/maxOutputTokens)。summaryLlm 不受影响。
        </div>
        <div class="btns">
          <button @click="demoSetLlm">setLlm({model:'gpt-4o'})</button>
        </div>
      </div>

      <!-- 3. memory 动态化 -->
      <div class="section">
        <div class="sec-title">3️⃣ Memory 动态更新(setMemory)</div>
        <div class="sec-doc">
          运行时更新持久指令 memory 文本,下一轮 augmentPrompt 注入最新值;setMemory('') 清空(空串跳过注入)。
          适用:运行时切换业务上下文 / 追加业务约束。
        </div>
        <div class="btns">
          <button @click="demoSetMemory">setMemory('用户偏好...')</button>
          <button @click="demoClearMemory">setMemory('')</button>
        </div>
      </div>

      <!-- 4. subagents 动态化 -->
      <div class="section">
        <div class="sec-title">4️⃣ 子 agent 动态化(setSubagents / addSubagent / removeSubagent)</div>
        <div class="sec-doc">
          运行时增删预声明子 agent(重新生成 use_&lt;id&gt; 委派工具 + rebind)。<b>需创建时配 subagents:[]</b>,
          否则 controller 为 null,setter warn 不抛错。适用:运行时根据任务类型决定委派哪些子 agent。
          <br /><span class="hint">注:本 demo 已在 createChatSdk 配 subagents:[](空数组占位启用 controller),点击下方按钮即时生效(初始 0 个,add 后生成 use_translator 委派工具)</span>
        </div>
        <div class="btns">
          <button @click="demoAddSubagent">addSubagent({id:'translator'})</button>
          <button @click="demoRemoveSubagent">removeSubagent('translator')</button>
        </div>
      </div>

      <!-- 操作日志 -->
      <div class="log">
        <div class="log-title">操作日志(最新在上)</div>
        <div v-if="log.length === 0" class="log-empty">点击上方按钮查看 before/after 快照</div>
        <pre v-for="(line, i) in log" :key="i" class="log-line">{{ line }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reconfig-panel {
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  background: #f5f3ff;
  margin-bottom: 16px;
  overflow: hidden;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #ede9fe;
  cursor: pointer;
  user-select: none;
}
.panel-header .title { font-weight: 600; color: #4c1d95; font-size: 14px; }
.panel-header .toggle { color: #6d28d9; font-size: 12px; }
.panel-body { padding: 12px 14px; }

.snapshot {
  background: #fff;
  border: 1px dashed #a78bfa;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.snap-title { font-size: 12px; color: #6d28d9; margin-bottom: 4px; font-weight: 600; }
.snap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 12px; }
.snap-grid code { background: #ede9fe; padding: 1px 4px; border-radius: 3px; color: #4c1d95; }

.section { margin-bottom: 12px; }
.sec-title { font-weight: 600; font-size: 13px; color: #4338ca; margin-bottom: 3px; }
.sec-doc { font-size: 12px; color: #4b5563; line-height: 1.5; margin-bottom: 6px; }
.sec-doc .hint { color: #b45309; font-size: 11px; }
.btns { display: flex; flex-wrap: wrap; gap: 6px; }
.btns button {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid #6366f1;
  background: #fff;
  color: #4338ca;
  border-radius: 4px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
}
.btns button:hover { background: #eef2ff; }

.log { margin-top: 12px; border-top: 1px dashed #a78bfa; padding-top: 8px; }
.log-title { font-size: 12px; color: #6d28d9; font-weight: 600; margin-bottom: 4px; }
.log-empty { font-size: 12px; color: #9ca3af; font-style: italic; }
.log-line {
  font-size: 11px;
  color: #374151;
  margin: 2px 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, monospace;
}
</style>
