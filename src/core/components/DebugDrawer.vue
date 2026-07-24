<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DebugLog } from '../harness/createAgent'
import type { AgentInfo } from '../types'

const props = withDefaults(defineProps<{
  logs?: DebugLog[]
  visible: boolean
  /** 获取 agent 详细信息(「Agent 信息」tab 展示) */
  getInfo?: () => AgentInfo
}>(), {
  logs: () => [],
})

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'clear'): void
}>()

const filter = ref<DebugLog['type'] | 'all'>('all')
const rawExpanded = ref<Set<number>>(new Set())
const bodyExpanded = ref<Set<number>>(new Set())

const typeMeta: Record<string, { label: string; color: string; icon: string }> = {
  context: { label: '上下文', color: '#667eea', icon: '🧩' },
  llm_request: { label: 'LLM请求', color: '#059669', icon: '➡️' },
  llm_response: { label: 'LLM响应', color: '#d97706', icon: '⬅️' },
  tool_call: { label: '工具调用', color: '#7c3aed', icon: '🔧' },
  tool_result: { label: '工具结果', color: '#2563eb', icon: '✅' },
  error: { label: '错误', color: '#dc2626', icon: '❌' },
  middleware: { label: '中间件', color: '#0891b2', icon: '⚙️' },
}

const logs = computed(() => (Array.isArray(props.logs) ? props.logs : []))
const filteredLogs = computed(() =>
  filter.value === 'all' ? logs.value : logs.value.filter((l) => l.type === filter.value)
)

const counts = computed(() => {
  const c: Record<string, number> = { all: logs.value.length }
  for (const l of logs.value) c[l.type] = (c[l.type] || 0) + 1
  return c
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' + String(ts % 1000).padStart(3, '0')
}

function toggleRaw(idx: number) {
  const s = new Set(rawExpanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  rawExpanded.value = s
}

function toggleBody(idx: number) {
  const s = new Set(bodyExpanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  bodyExpanded.value = s
}

function formatJson(data: any): string {
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
}

const roleMeta: Record<string, { label: string; color: string }> = {
  system: { label: 'SYSTEM', color: '#6b7280' },
  human: { label: 'USER', color: '#667eea' },
  user: { label: 'USER', color: '#667eea' },
  ai: { label: 'AI', color: '#059669' },
  assistant: { label: 'AI', color: '#059669' },
  tool: { label: 'TOOL', color: '#2563eb' },
}

function roleOf(t: string) {
  return roleMeta[t] || { label: (t || '?').toUpperCase(), color: '#9ca3af' }
}

function close() { emit('update:visible', false) }
function clearLogs() { rawExpanded.value = new Set(); emit('clear') }

const tab = ref<'logs' | 'info'>('logs')
const agentInfo = ref<AgentInfo | null>(null)
function switchTab(t: 'logs' | 'info') {
  tab.value = t
  // 切到「Agent 信息」时实时拉取(含动态 todos)
  if (t === 'info' && props.getInfo) {
    try { agentInfo.value = props.getInfo() } catch { agentInfo.value = null }
  }
}
const statusMeta: Record<string, { label: string; color: string }> = {
  pending: { label: '待办', color: '#9ca3af' },
  in_progress: { label: '进行中', color: '#d97706' },
  completed: { label: '完成', color: '#059669' },
}
function statusLabel(s: string) { return statusMeta[s]?.label ?? s }
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="visible" class="debug-drawer">
        <div class="drawer-panel">
          <div class="drawer-header">
            <div class="tab-group">
              <button class="tab-btn" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">🐛 日志</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'info' }" @click="switchTab('info')">🧬 Agent 信息</button>
            </div>
            <div class="header-actions">
              <button v-if="tab === 'logs'" class="hd-btn" title="清空日志" @click="clearLogs">🗑️</button>
              <button class="hd-btn" title="关闭" @click="close">✕</button>
            </div>
          </div>

          <div v-if="tab === 'logs'" class="drawer-filters">
            <button
              v-for="(meta, key) in typeMeta"
              :key="key"
              class="filter-chip"
              :class="{ active: filter === key }"
              :style="{ '--chip-color': meta.color }"
              @click="filter = key as DebugLog['type']"
            >
              {{ meta.icon }} {{ meta.label }}
              <span class="chip-count">{{ counts[key] || 0 }}</span>
            </button>
            <button class="filter-chip all" :class="{ active: filter === 'all' }" @click="filter = 'all'">
              全部 <span class="chip-count">{{ counts.all || 0 }}</span>
            </button>
          </div>

          <div class="drawer-body">
            <template v-if="tab === 'logs'">
            <div v-if="filteredLogs.length === 0" class="empty">
              暂无日志，发送消息后这里会显示 Agent 的完整上下文、工具调用等信息
            </div>

            <div v-for="(log, idx) in filteredLogs" :key="idx" class="log-item">
              <div class="log-head">
                <span class="log-type" :style="{ background: typeMeta[log.type].color }">
                  {{ typeMeta[log.type].icon }} {{ typeMeta[log.type].label }}
                </span>
                <span v-if="log.source" class="log-source">↳ {{ log.source }}</span>
                <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              </div>

              <div class="log-body">
                <!-- 上下文：模型配置 + 工具列表 + 消息列表 -->
                <template v-if="log.type === 'context'">
                  <div class="kv-grid">
                    <div class="kv"><span class="k">模型</span><span class="v">{{ log.data.model }}</span></div>
                    <div class="kv"><span class="k">温度</span><span class="v">{{ log.data.temperature }}</span></div>
                    <div class="kv"><span class="k">MaxTokens</span><span class="v">{{ log.data.maxTokens }}</span></div>
                    <div class="kv"><span class="k">消息数</span><span class="v">{{ log.data.totalMessages }}</span></div>
                  </div>
                  <div class="section-label">工具 ({{ log.data.tools?.length || 0 }})</div>
                  <div class="chip-row">
                    <span v-for="t in log.data.tools" :key="t" class="tool-chip">{{ t }}</span>
                  </div>
                  <div class="section-label">上下文消息</div>
                  <div class="msg-list">
                    <div v-for="(m, mi) in log.data.messages" :key="mi" class="msg-row">
                      <span class="msg-role" :style="{ background: roleOf(m.type).color }">{{ roleOf(m.type).label }}</span>
                      <span class="msg-text">{{ m.content }}</span>
                    </div>
                  </div>
                </template>

                <!-- LLM 请求：轮次 + 消息列表 -->
                <template v-else-if="log.type === 'llm_request'">
                  <div class="badge-row">
                    <span class="badge">第 {{ log.data.round }} 轮</span>
                    <span v-if="log.data.model" class="badge muted">{{ log.data.model }}</span>
                    <span class="badge muted">{{ (log.data.messages || []).length }} 条消息</span>
                    <span v-if="log.data.tools?.length" class="badge muted">{{ log.data.tools.length }} 工具</span>
                    <button class="view-toggle" @click="toggleBody(idx)">
                      {{ bodyExpanded.has(idx) ? '🗂 卡片视图' : '📋 请求体' }}
                    </button>
                  </div>
                  <div v-if="!bodyExpanded.has(idx)" class="msg-list">
                    <div v-for="(m, mi) in log.data.messages" :key="mi" class="msg-row">
                      <span class="msg-role" :style="{ background: roleOf(m.role).color }">{{ roleOf(m.role).label }}</span>
                      <div class="msg-detail">
                        <span v-if="m.content" class="msg-text">{{ m.content }}</span>
                        <div v-for="(tc, ti) in m.tool_calls || []" :key="ti" class="tc-inline">
                          <span class="tc-inline-name">🔧 {{ tc.function?.name || tc.name }}</span>
                          <code class="tc-inline-args">{{ tc.function?.arguments ?? tc.args }}</code>
                        </div>
                        <span v-if="m.tool_call_id" class="tc-id">↳ tool_call_id: {{ m.tool_call_id }}</span>
                      </div>
                    </div>
                  </div>
                  <pre v-else class="log-raw"><code>{{ formatJson(log.data.messages) }}</code></pre>
                </template>

                <!-- LLM 响应：内容 + 工具调用 + 用量 -->
                <template v-else-if="log.type === 'llm_response'">
                  <div class="badge-row">
                    <span class="badge">第 {{ log.data.round }} 轮</span>
                    <span v-if="log.data.toolCalls?.length" class="badge warn">🔧 {{ log.data.toolCalls.length }} 个工具调用</span>
                  </div>
                  <div v-if="log.data.content" class="resp-content">{{ log.data.content }}</div>
                  <div v-if="log.data.toolCalls?.length" class="tc-list">
                    <div v-for="(tc, ti) in log.data.toolCalls" :key="ti" class="tc-card">
                      <div class="tc-name">🔧 {{ tc.name }}</div>
                      <pre class="tc-args">{{ formatJson(tc.args) }}</pre>
                    </div>
                  </div>
                  <div v-if="log.data.usage" class="usage-row">
                    <span class="usage">prompt: {{ log.data.usage.prompt_tokens ?? '-' }}</span>
                    <span class="usage">completion: {{ log.data.usage.completion_tokens ?? '-' }}</span>
                    <span class="usage">total: {{ log.data.usage.total_tokens ?? '-' }}</span>
                  </div>
                </template>

                <!-- 工具调用 -->
                <template v-else-if="log.type === 'tool_call'">
                  <div class="tc-card inline">
                    <div class="tc-name">🔧 {{ log.data.name }}</div>
                    <pre class="tc-args">{{ formatJson(log.data.args) }}</pre>
                  </div>
                </template>

                <!-- 工具结果 -->
                <template v-else-if="log.type === 'tool_result'">
                  <div class="tc-card inline">
                    <div class="tc-name">✅ {{ log.data.name }} 结果</div>
                    <pre class="tc-args">{{ log.data.result }}</pre>
                  </div>
                </template>

                <!-- 错误 -->
                <template v-else-if="log.type === 'error'">
                  <div class="err-box">{{ log.data.tool ? `[${log.data.tool}] ` : '' }}{{ log.data.error }}</div>
                </template>
              </div>

              <div class="log-footer">
                <button class="raw-toggle" @click="toggleRaw(idx)">
                  {{ rawExpanded.has(idx) ? '收起原始 JSON' : '查看原始 JSON' }}
                </button>
                <button class="raw-toggle" @click="copyText(formatJson(log.data))">复制</button>
              </div>
              <pre v-if="rawExpanded.has(idx)" class="log-raw"><code>{{ formatJson(log.data) }}</code></pre>
            </div>
            </template>

            <!-- Agent 信息 -->
            <div v-else class="info-body">
              <div v-if="!agentInfo" class="empty">暂无信息</div>
              <template v-else>
                <div class="info-section">
                  <div class="info-title">基本信息</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">ID</span><span class="v">{{ agentInfo.id }}</span></div>
                    <div class="kv"><span class="k">模型</span><span class="v">{{ agentInfo.model || '-' }}</span></div>
                    <div class="kv"><span class="k">工具数</span><span class="v">{{ agentInfo.tools.length }}</span></div>
                    <div class="kv"><span class="k">中间件</span><span class="v">{{ agentInfo.middleware.length }}</span></div>
                  </div>
                  <div class="kv" style="margin-top: 6px"><span class="k">中间件栈</span><span class="v" style="font-size: 11px">{{ agentInfo.middleware.join(' → ') || '-' }}</span></div>
                </div>

                <div class="info-section">
                  <div class="info-title">🔧 工具 ({{ agentInfo.tools.length }})</div>
                  <div v-for="t in agentInfo.tools" :key="t.name" class="info-item">
                    <div class="info-name">{{ t.name }}</div>
                    <div class="info-desc">{{ t.description }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.skills.length" class="info-section">
                  <div class="info-title">📘 技能 ({{ agentInfo.skills.length }})</div>
                  <div v-for="s in agentInfo.skills" :key="s.name" class="info-item">
                    <div class="info-name">{{ s.name }}</div>
                    <div class="info-desc">{{ s.description }}</div>
                    <div v-if="s.whenToUse" class="info-desc muted">何时用:{{ s.whenToUse }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.windowProps.length" class="info-section">
                  <div class="info-title">🪟 可操作属性 ({{ agentInfo.windowProps.length }})</div>
                  <div v-for="w in agentInfo.windowProps" :key="w.path" class="info-item">
                    <div class="info-name">{{ w.path }}</div>
                    <div class="info-desc">{{ w.description }}</div>
                  </div>
                </div>

                <div class="info-section">
                  <div class="info-title">🧬 子 Agent</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">启用</span><span class="v">{{ agentInfo.subagent.enabled ? '是' : '否' }}</span></div>
                    <div class="kv"><span class="k">最大递归</span><span class="v">{{ agentInfo.subagent.maxDepth }}</span></div>
                    <div class="kv"><span class="k">并行上限</span><span class="v">{{ agentInfo.subagent.maxParallel }}</span></div>
                    <div class="kv"><span class="k">额外工具</span><span class="v" style="font-size: 11px">{{ agentInfo.subagent.allowedTools.length ? agentInfo.subagent.allowedTools.join(', ') : '默认只读' }}</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.verify" class="info-section">
                  <div class="info-title">✅ Verify 自检</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">启用</span><span class="v">{{ agentInfo.verify.enabled ? '是' : '否' }}</span></div>
                    <div class="kv"><span class="k">自纠上限</span><span class="v">{{ agentInfo.verify.maxAttempts }}</span></div>
                    <div class="kv"><span class="k">对抗验证</span><span class="v">{{ agentInfo.verify.adversarial ? '开启' : '关闭' }}</span></div>
                    <div v-if="agentInfo.verify.adversarial" class="kv"><span class="k">对抗模型</span><span class="v" style="font-size: 11px">{{ agentInfo.model || '-' }}(同主)</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.todos.length" class="info-section">
                  <div class="info-title">📋 任务清单 ({{ agentInfo.todos.length }})</div>
                  <div v-for="(td, i) in agentInfo.todos" :key="i" class="info-todo">
                    <span class="todo-tag" :style="{ background: (statusMeta[td.status] && statusMeta[td.status].color) || '#9ca3af' }">{{ statusLabel(td.status) }}</span>
                    <span>{{ td.content }}</span>
                  </div>
                </div>

                <div v-if="agentInfo.memory" class="info-section">
                  <div class="info-title">📝 持久指令 (memory)</div>
                  <pre class="info-pre">{{ agentInfo.memory }}</pre>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div class="drawer-mask" @click="close"></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.debug-drawer { position: fixed; inset: 0; z-index: 9000; pointer-events: none; }
.drawer-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.25); pointer-events: auto; }
.drawer-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 520px; max-width: 90vw; background: #fff;
  display: flex; flex-direction: column;
  box-shadow: -8px 0 32px rgba(0,0,0,0.15); pointer-events: auto;
  z-index: 2;
}
.drawer-mask { z-index: 1; }
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: linear-gradient(135deg, #1f2937, #111827); color: #fff;
}
.drawer-title { font-size: 15px; font-weight: 600; }
.tab-group { display: flex; gap: 4px; }
.tab-btn { padding: 4px 12px; border: none; border-radius: 6px; background: rgba(255,255,255,0.12); color: #fff; font-size: 13px; cursor: pointer; transition: background 0.2s; }
.tab-btn:hover { background: rgba(255,255,255,0.22); }
.tab-btn.active { background: rgba(255,255,255,0.45); font-weight: 600; }
.info-body { padding: 4px 0; }
.info-section { margin-bottom: 14px; }
.info-title { font-size: 12px; font-weight: 600; color: #4338ca; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #f3f4f6; }
.info-item { padding: 6px 8px; background: #f9fafb; border-radius: 6px; margin-bottom: 4px; }
.info-name { font-size: 12px; font-weight: 600; color: #1f2937; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.info-desc { font-size: 11px; color: #6b7280; line-height: 1.5; margin-top: 2px; }
.info-desc.muted { color: #9ca3af; }
.info-todo { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; padding: 4px 8px; background: #f9fafb; border-radius: 6px; margin-bottom: 4px; }
.todo-tag { font-size: 10px; color: #fff; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }
.info-pre { margin: 0; padding: 8px; background: #f9fafb; border-radius: 6px; font-size: 11px; color: #4b5563; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.header-actions { display: flex; gap: 4px; }
.hd-btn { width: 28px; height: 28px; border: none; border-radius: 6px; background: rgba(255,255,255,0.12); color: #fff; cursor: pointer; }
.hd-btn:hover { background: rgba(255,255,255,0.25); }
.drawer-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid #f3f4f6; background: #fafafa; }
.filter-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; color: #6b7280; font-size: 12px; cursor: pointer; transition: all 0.2s; }
.filter-chip:hover { border-color: var(--chip-color, #667eea); }
.filter-chip.active { background: var(--chip-color, #667eea); border-color: var(--chip-color, #667eea); color: #fff; }
.chip-count { background: rgba(0,0,0,0.08); border-radius: 8px; padding: 0 5px; font-size: 11px; }
.filter-chip.active .chip-count { background: rgba(255,255,255,0.25); }
.drawer-body { flex: 1; overflow-y: auto; padding: 12px; }
.empty { text-align: center; color: #9ca3af; font-size: 13px; padding: 40px 20px; }
.log-item { margin-bottom: 10px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; }
.log-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #f9fafb; }
.log-type { font-size: 11px; font-weight: 600; color: #fff; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.log-source { font-size: 10px; color: #7c3aed; background: #f3e8ff; padding: 2px 8px; border-radius: 4px; font-weight: 600; white-space: nowrap; }
.log-time { font-size: 11px; color: #9ca3af; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.log-body { padding: 10px 12px; }
.log-footer { display: flex; gap: 8px; padding: 6px 12px; border-top: 1px dashed #f3f4f6; }
.raw-toggle { border: none; background: none; color: #667eea; font-size: 11px; cursor: pointer; padding: 2px 4px; }
.raw-toggle:hover { text-decoration: underline; }
.log-raw { margin: 0; padding: 10px 12px; border-top: 1px solid #f3f4f6; background: #1f2937; color: #e5e7eb; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 11px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; }
.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.kv { display: flex; flex-direction: column; padding: 6px 8px; background: #f9fafb; border-radius: 6px; }
.kv .k { font-size: 10px; color: #9ca3af; text-transform: uppercase; }
.kv .v { font-size: 13px; color: #1f2937; font-weight: 600; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.section-label { font-size: 11px; color: #6b7280; font-weight: 600; margin: 10px 0 4px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.tool-chip { font-size: 11px; padding: 2px 8px; background: #eef2ff; color: #4338ca; border-radius: 10px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.msg-list { display: flex; flex-direction: column; gap: 4px; }
.msg-row { display: flex; align-items: flex-start; gap: 6px; padding: 5px 8px; background: #f9fafb; border-radius: 6px; }
.msg-role { font-size: 9px; font-weight: 700; color: #fff; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; margin-top: 1px; }
.msg-text { font-size: 12px; color: #374151; line-height: 1.5; white-space: pre-wrap; word-break: break-word; flex: 1; }
.msg-tool-hint { font-size: 10px; color: #7c3aed; flex-shrink: 0; }
.badge-row { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.badge { font-size: 11px; padding: 2px 8px; background: #e0e7ff; color: #4338ca; border-radius: 10px; font-weight: 600; }
.badge.muted { background: #f3f4f6; color: #6b7280; }
.badge.warn { background: #fef3c7; color: #92400e; }
.resp-content { font-size: 12px; color: #1f2937; background: #fffbeb; border-left: 3px solid #d97706; padding: 6px 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.tc-list { display: flex; flex-direction: column; gap: 6px; }
.tc-card { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
.tc-card.inline { margin-top: 4px; }
.tc-name { font-size: 12px; font-weight: 600; color: #4338ca; padding: 5px 8px; background: #eef2ff; }
.tc-args { margin: 0; padding: 8px; background: #1f2937; color: #e5e7eb; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }
.usage-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.usage { font-size: 11px; padding: 2px 8px; background: #ecfdf5; color: #047857; border-radius: 10px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.err-box { font-size: 12px; color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
.msg-detail { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.tc-inline { font-size: 11px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 4px; padding: 2px 6px; display: flex; gap: 4px; align-items: baseline; }
.tc-inline-name { color: #6d28d9; font-weight: 600; white-space: nowrap; }
.tc-inline-args { font-family: 'SF Mono', Monaco, Consolas, monospace; color: #4c1d95; word-break: break-all; font-size: 10px; }
.tc-id { font-size: 10px; color: #9ca3af; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.view-toggle { margin-left: auto; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer; }
.view-toggle:hover { background: #e0e7ff; }
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.25s ease; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }
</style>
