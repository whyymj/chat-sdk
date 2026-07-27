<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChat } from '../composables/useChat'
import { copyText } from '../utils/clipboard'
import MessageContent from './MessageContent.vue'
import DebugDrawer from './DebugDrawer.vue'
import type { DebugLog } from '../harness/createAgent'
import type { AgentMessage, AgentInfo, StreamHandler, ToolStep } from '../types'
import type { PendingConflict } from '../sdk/createChatSdk'
import type { ConflictResolution } from '../tools/dataOps'

const props = withDefaults(defineProps<{
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  title?: string
  placeholder?: string
  /** 调试日志(响应式数组),传入则显示调试按钮 */
  debugLogs?: DebugLog[]
  /** 初始消息(持久化恢复,与父级共享响应式引用) */
  initialMessages?: AgentMessage[]
  /** 一轮完成后持久化回调 */
  onPersist?: (messages: AgentMessage[]) => void
  /** 清空时回调(新建会话) */
  onClear?: () => void
  /** 获取 agent 详细信息(debug 窗口「Agent 信息」tab) */
  getInfo?: () => AgentInfo
  /** 回退到上次正常 checkpoint(checkpoint 选项开启时注入) */
  onUndo?: () => boolean
  /** 是否有可回退的 checkpoint(checkpoint 选项开启时注入) */
  canUndo?: () => boolean
  /** 显示头像(默认 true;false → 隐藏 🤖/👤 emoji 头像,更克制) */
  showAvatar?: boolean
  /** 显示打字动画(默认 true;false → 用「思考中…」文字替代三点动画) */
  showTyping?: boolean
  /** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);core.pendingConflict 解包值,有冲突时非 null */
  pendingConflict?: PendingConflict | null
  /** 冲突解决回调:用户点「保留外部」/「强制覆盖」/「回退」→ 收口挂起的 conflict */
  onResolveConflict?: (action: ConflictResolution['action']) => void
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);传给 DebugDrawer 触发 agentInfo 重新拉取,实时反映动态 skill/data */
  infoTick?: Ref<number>
  /** 读取 skill 全文(DebugDrawer 展开 skill 时调,优先缓存);返回 null 表示无内容或读取失败 */
  getSkillContent?: (name: string) => Promise<string | null>
  /** 抽屉模式:从右侧滑入 + 遮罩 + 关闭按钮(替代收起下箭头);点击遮罩/关闭按钮 emit 'close',由集成方(sdk)调 unmount */
  drawer?: boolean
}>(), {
  title: 'AI 助手',
  placeholder: '输入消息,Enter 发送...',
  showAvatar: true,
  showTyping: true,
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { state, scrollContainer, pendingApproval, sendMessage, clearMessages, stop, retry, regenerate, resolveApproval, onScroll, onWheel } = useChat({
  fetchResponse: props.fetchResponse,
  fetchStream: props.fetchStream,
  messages: props.initialMessages,
  onPersist: props.onPersist,
  onClear: props.onClear,
})

/** 待确认工具调用的参数预览(截断长 JSON,便于用户判断) */
const approvalArgsPreview = computed(() => {
  const a = pendingApproval.value?.args
  if (a == null) return ''
  try {
    const s = typeof a === 'string' ? a : JSON.stringify(a, null, 2)
    return s.length > 400 ? s.slice(0, 400) + '\n…(已截断)' : s
  } catch {
    return String(a)
  }
})

/** 冲突预览:agent 想写的值 / 外部改后的当前值(截断 JSON,便于用户对比决策) */
const conflictAgentPreview = computed(() => {
  const v = props.pendingConflict?.agentValue
  if (v === undefined) return ''
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > 400 ? s.slice(0, 400) + '\n…(已截断)' : s
  } catch {
    return String(v)
  }
})
const conflictCurrentPreview = computed(() => {
  const v = props.pendingConflict?.currentValue
  if (v == null) return ''
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > 400 ? s.slice(0, 400) + '\n…(已截断)' : s
  } catch {
    return String(v)
  }
})
const conflictExpanded = ref(false)
watch(() => props.pendingConflict, () => { conflictExpanded.value = false })

/** 是否为 LLM 主动征询(request_human_confirmation):展示问题/方案/推荐,而非工具调用确认 */
const isHumanConfirm = computed(() => pendingApproval.value?.toolName === 'request_human_confirmation')
/** 主动征询的可选方案列表(多方案时让用户选) */
const approvalOptions = computed<string[]>(() => {
  const opts = pendingApproval.value?.args?.options
  return Array.isArray(opts) ? opts.map(String) : []
})

/** 工具调用参数 JSON 默认收起,点击「查看参数」展开 */
const approvalArgsExpanded = ref(false)
watch(pendingApproval, () => { approvalArgsExpanded.value = false })

/** 是否有可回退的 checkpoint(响应式:每次 error-bar 渲染时重读) */
const canUndo = computed(() => (typeof props.canUndo === 'function' ? !!props.canUndo() : false))

/** 一键回退到上次正常 checkpoint */
function handleUndo() {
  if (props.onUndo?.()) {
    state.error = null
  }
}

const inputText = ref('')
const isExpanded = ref(true)
const debugVisible = ref(false)
/** 记录每条消息思考过程的展开状态(按消息索引) */
const reasoningExpanded = ref<Record<number, boolean>>({})

const hasMessages = computed(() => state.messages.length > 0)
const hasUserMessage = computed(() => state.messages.some((m) => m.role === 'user'))
const hasDebugLogs = computed(() => (props.debugLogs?.length ?? 0) > 0)

function toggleReasoning(idx: number) {
  reasoningExpanded.value[idx] = !reasoningExpanded.value[idx]
}

function stepStatusIcon(step: ToolStep) {
  return step.status === 'running' ? '⏳' : step.status === 'error' ? '❌' : '✅'
}

/** 相邻同名工具合并:仅合并连续同名,count>1 显示 ×N;不相邻的同名工具分别成组(顺次展示)。状态聚合(有 error→error,有 running→running,否则 done),children 合并 */
function groupedSteps(steps: ToolStep[]) {
  const groups: { name: string; count: number; hasRunning: boolean; hasError: boolean; children: ToolStep[] }[] = []
  for (const s of steps) {
    const last = groups.length ? groups[groups.length - 1] : null
    if (last && last.name === s.name) {
      last.count++
      if (s.status === 'running') last.hasRunning = true
      if (s.status === 'error') last.hasError = true
      if (s.children?.length) last.children.push(...s.children)
    } else {
      groups.push({
        name: s.name,
        count: 1,
        hasRunning: s.status === 'running',
        hasError: s.status === 'error',
        children: s.children?.length ? [...s.children] : [],
      })
    }
  }
  return groups.map((e) => ({
    name: e.name,
    count: e.count,
    status: e.hasError ? 'error' : e.hasRunning ? 'running' : 'done',
    children: e.children,
  }))
}

function groupStatusIcon(status: string) {
  return status === 'running' ? '⏳' : status === 'error' ? '❌' : '✅'
}

/** 占位 assistant 消息:流式等待首个输出时(content/reasoning 均空)→ 在该消息内显示三点,避免再叠加一个底部 loading 头像 */
function isPendingAssistant(idx: number): boolean {
  const m = state.messages[idx] as any
  return !!m && m.role === 'assistant' && state.loading && idx === state.messages.length - 1 && !m.content && !m.reasoning
}

function handleSend() {
  if (!inputText.value.trim()) return
  sendMessage(inputText.value)
  inputText.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 能力徽标摘要(MCP server 数 + 工具数,从 getInfo 拉) */
const summary = computed(() => {
  const info = props.getInfo?.()
  return { mcp: info?.mcp?.servers?.length ?? 0, tools: info?.tools?.length ?? 0 }
})
function copyTextMsg(text: string) {
  copyText(text).then((ok) => {
    if (ok) {
      copiedMsg.value = true
      setTimeout(() => (copiedMsg.value = false), 1500)
    }
  })
}
const copiedMsg = ref(false)
</script>

<template>
  <div v-if="drawer" class="chat-mask" @click="emit('close')"></div>
  <div class="chat-dialog" :class="{ collapsed: !isExpanded && !drawer, drawer }">
    <!-- 头部 -->
    <div class="chat-header">
      <div class="header-left">
        <span class="header-icon">🤖</span>
        <span class="header-title">{{ title }}</span>
        <span v-if="state.loading" class="status-dot pulse"></span>
      </div>
      <div class="header-actions">
        <button
          class="action-btn debug-btn"
          :class="{ active: debugVisible }"
          title="日志 / 执行流程 / Agent 信息"
          @click="debugVisible = true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 2v8l-3 3v2h12v-2l-3-3V2"></path>
            <path d="M9 2h6"></path>
            <path d="M9 18h6"></path>
          </svg>
          <span v-if="hasDebugLogs" class="debug-badge">{{ debugLogs?.length }}</span>
        </button>
        <button class="action-btn" title="清空对话" @click="clearMessages" :disabled="!hasMessages">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <button v-if="drawer" class="action-btn" title="关闭" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
        <button v-else class="action-btn" @click="isExpanded = !isExpanded">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path v-if="isExpanded" d="M18 15l-6-6-6 6"></path>
            <path v-else d="M6 9l6 6 6-6"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <Transition name="cs-slide">
    <div v-show="isExpanded" class="chat-body" ref="scrollContainer" @scroll="onScroll" @wheel="onWheel">
      <div v-if="!hasMessages" class="empty-state">
        <div class="empty-icon">💬</div>
        <p>有什么可以帮你的?</p>
      </div>

      <div
        v-for="(msg, idx) in state.messages"
        :key="idx"
        class="message-row"
        :class="msg.role"
        :data-msg-idx="idx"
      >
        <div v-if="showAvatar" class="message-avatar">
          {{ msg.role === 'user' ? '👤' : '🤖' }}
        </div>
        <div class="message-content">
          <!-- 思考过程(可折叠) -->
          <div
            v-if="msg.role === 'assistant' && msg.reasoning"
            class="reasoning-block"
            :class="{ expanded: reasoningExpanded[idx] }"
          >
            <div class="reasoning-header" @click="toggleReasoning(idx)">
              <span class="reasoning-icon">🧠</span>
              <span class="reasoning-title">思考过程</span>
              <span class="reasoning-toggle">{{ reasoningExpanded[idx] ? '▾' : '▸' }}</span>
            </div>
            <div v-if="reasoningExpanded[idx]" class="reasoning-body">{{ msg.reasoning }}</div>
          </div>

          <!-- 工具调用步骤 -->
          <div
            v-if="msg.role === 'assistant' && msg.steps && msg.steps.length"
            class="steps-block"
          >
            <div v-for="(step, sIdx) in groupedSteps(msg.steps)" :key="sIdx" class="step-item">
              <div class="step-head">
                <span class="step-icon">{{ groupStatusIcon(step.status) }}</span>
                <span class="step-name">{{ step.name }}</span>
                <span v-if="step.count > 1" class="step-count">×{{ step.count }}</span>
                <span v-if="step.status === 'running'" class="step-status running">执行中…</span>
              </div>
              <!-- 子 agent 工作进度(嵌套展示;紫色系与主工具青色区分) -->
              <div v-if="step.children && step.children.length" class="step-children">
                <div class="step-children-label">🧬 子 agent 进度</div>
                <div v-for="(c, cIdx) in step.children" :key="cIdx" class="step-child">
                  <span class="step-icon">{{ stepStatusIcon(c) }}</span>
                  <span class="step-name">{{ c.name }}</span>
                  <span v-if="c.status === 'running'" class="step-status running">…</span>
                </div>
              </div>
            </div>
          </div>

          <div class="message-bubble" :class="{ typing: isPendingAssistant(idx) }">
            <template v-if="isPendingAssistant(idx)">
              <template v-if="showTyping"><span class="dot"></span><span class="dot"></span><span class="dot"></span></template>
              <span v-else class="typing-text">思考中…</span>
            </template>
            <template v-else>
              <MessageContent v-if="msg.role === 'assistant'" :content="msg.content" />
              <template v-else>{{ msg.content }}</template>
            </template>
          </div>
          <span
            v-if="msg.role === 'assistant' && state.loading && idx === state.messages.length - 1 && msg.content"
            class="stream-cursor"
          ></span>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
          <!-- 最后一条 assistant(非生成中)的操作:复制 / 重新生成 -->
          <div v-if="msg.role === 'assistant' && msg.content && !state.loading && idx === state.messages.length - 1" class="msg-actions">
            <button class="msg-action-btn" :title="copiedMsg ? '已复制' : '复制'" @click="copyTextMsg(msg.content)">{{ copiedMsg ? '✓ 已复制' : '📋 复制' }}</button>
            <button class="msg-action-btn" title="重新生成" @click="regenerate">🔄 重新生成</button>
          </div>
        </div>
      </div>

      <!-- 加载指示器:仅当最后一条不是 assistant 占位时(非流式等待)才单独显示,避免与流式占位消息叠加成两个 AI 头像 -->
      <div v-if="state.loading && state.messages[state.messages.length - 1]?.role !== 'assistant'" class="message-row assistant">
        <div v-if="showAvatar" class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-bubble typing">
            <template v-if="showTyping"><span class="dot"></span><span class="dot"></span><span class="dot"></span></template>
            <span v-else class="typing-text">思考中…</span>
          </div>
        </div>
      </div>

      <!-- 错误提示 + 重试 -->
      <div v-if="state.error" class="error-bar">
        <span class="error-text">{{ state.error }}</span>
        <button v-if="hasUserMessage" class="retry-btn" @click="retry">重试</button>
        <button v-if="canUndo" class="undo-btn" title="回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)" @click="handleUndo">↩ 回退</button>
      </div>
    </div>
    </Transition>

    <!-- 人工确认:工具调用前需用户允许/拒绝(approval 中间件挂起) / LLM 主动征询(humanConfirm 工具挂起) -->
    <div v-if="pendingApproval" class="approval-bar">
      <!-- LLM 主动征询:展示问题 / 可选方案 / 推荐 -->
      <template v-if="isHumanConfirm">
        <div class="approval-head">
          <span class="approval-icon">❓</span>
          <span class="approval-title">AI 需要你确认</span>
        </div>
        <div v-if="pendingApproval.args?.question" class="approval-question">{{ pendingApproval.args.question }}</div>
        <div v-if="pendingApproval.args?.context" class="approval-context">{{ pendingApproval.args.context }}</div>
        <div v-if="pendingApproval.args?.recommendation" class="approval-recommend">💡 推荐:{{ pendingApproval.args.recommendation }}</div>
        <div class="approval-actions">
          <button class="approval-deny" @click="resolveApproval(false)">拒绝</button>
          <template v-if="approvalOptions.length">
            <button v-for="opt in approvalOptions" :key="opt" class="approval-opt" @click="resolveApproval(opt)">{{ opt }}</button>
          </template>
          <button v-else class="approval-allow" @click="resolveApproval(true)">允许</button>
        </div>
      </template>
      <!-- 工具调用确认:展示工具名 + 参数 -->
      <template v-else>
        <div class="approval-head">
          <span class="approval-icon">✋</span>
          <span class="approval-title">需确认工具调用:<code>{{ pendingApproval.toolName }}</code></span>
          <button v-if="approvalArgsPreview" class="approval-toggle" @click="approvalArgsExpanded = !approvalArgsExpanded">
            {{ approvalArgsExpanded ? '收起参数' : '查看参数' }}{{ approvalArgsExpanded ? ' ▴' : ' ▾' }}
          </button>
        </div>
        <pre v-if="approvalArgsPreview && approvalArgsExpanded" class="approval-args">{{ approvalArgsPreview }}</pre>
        <div class="approval-actions">
          <button class="approval-deny" @click="resolveApproval(false)">拒绝</button>
          <button class="approval-allow" @click="resolveApproval(true)">允许</button>
        </div>
      </template>
    </div>

    <!-- 乐观锁冲突:agent 写入时发现属性已被外部改过(expectedHash 不匹配),挂起等用户决定 -->
    <div v-if="props.pendingConflict" class="conflict-bar">
      <div class="conflict-head">
        <span class="conflict-icon">⚠️</span>
        <span class="conflict-title">写入冲突:<code>{{ props.pendingConflict.path }}</code> 已被外部修改</span>
      </div>
      <div class="conflict-detail">
        AI 基于「读取时的旧值」准备{{ props.pendingConflict.op === 'delete' ? '删除' : '写入' }},但该属性在你读取之后被外部代码/其他 agent/手动改过。
      </div>
      <button class="conflict-toggle" @click="conflictExpanded = !conflictExpanded">
        {{ conflictExpanded ? '收起对比' : '查看值对比' }}{{ conflictExpanded ? ' ▴' : ' ▾' }}
      </button>
      <div v-if="conflictExpanded" class="conflict-diff">
        <div class="conflict-diff-col">
          <div class="conflict-diff-label">AI 想写的值</div>
          <pre class="conflict-diff-pre">{{ conflictAgentPreview || '(delete 操作无值)' }}</pre>
        </div>
        <div class="conflict-diff-col">
          <div class="conflict-diff-label">外部改后的当前值</div>
          <pre class="conflict-diff-pre">{{ conflictCurrentPreview }}</pre>
        </div>
      </div>
      <div class="conflict-actions">
        <button class="conflict-keep" @click="props.onResolveConflict?.('keep_external')" title="不写入,保留外部修改后的值,AI 重新读取再改">保留外部</button>
        <button class="conflict-overwrite" @click="props.onResolveConflict?.('overwrite')" title="用 AI 的值覆盖外部修改">强制覆盖</button>
        <button class="conflict-restore" @click="props.onResolveConflict?.('restore')" title="回退到最近一次历史快照(agent 之前操作的检查点),撤销外部修改 + AI 不写入">回退</button>
      </div>
    </div>

    <!-- 输入区域 -->
    <Transition name="cs-slide">
    <div v-show="isExpanded" class="chat-footer">
      <span v-if="props.getInfo" class="cap-badge" title="能力概览(MCP / 工具数)">
        🔌{{ summary.mcp }} · 🔧{{ summary.tools }}
      </span>
      <button v-if="canUndo" class="undo-foot-btn" title="回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)" @click="handleUndo">↩ 回退</button>
      <textarea
        v-model="inputText"
        class="chat-input"
        :placeholder="placeholder"
        rows="1"
        @keydown="handleKeydown"
      ></textarea>
      <button
        class="send-btn"
        :class="{ 'stop-btn': state.loading }"
        :disabled="!state.loading && !inputText.trim()"
        :title="state.loading ? '停止生成' : '发送'"
        @click="state.loading ? stop() : handleSend()"
      >
        <svg v-if="state.loading" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
    </Transition>

    <!-- 调试抽屉 -->
    <DebugDrawer v-model:visible="debugVisible" :logs="debugLogs" :get-info="props.getInfo" :info-tick="props.infoTick" :get-skill-content="props.getSkillContent" />
  </div>
</template>

<style scoped>
/* 抽屉模式:遮罩 + 从右滑入的固定面板 */
.chat-mask {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0, 0, 0, 0.45);
  animation: cs-mask-in 0.28s ease;
}
@keyframes cs-mask-in { from { opacity: 0; } to { opacity: 1; } }
.chat-dialog.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 420px; max-width: 92vw; height: 100vh;
  z-index: 9999;
  border-radius: 0;
  animation: cs-drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes cs-drawer-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) {
  .chat-mask { animation: none; }
  .chat-dialog.drawer { animation: none; }
}

.chat-dialog {
  /* 主题变量(集成方可覆盖;默认中性主题,去 AI 风格化渐变)。在祖先元素或 :root 覆盖 --cs-* 即可换主题 */
  --cs-primary: #1f4d3a;
  --cs-primary-rgb: 31, 77, 58;
  --cs-bg: #ffffff;
  --cs-bubble-ai: #f3f4f6;
  --cs-radius: 12px;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: var(--cs-radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
  background: var(--cs-bg);
  overflow: hidden;
  transition: all 0.3s ease;
  /* 默认抽屉入场动画:挂载时从右轻微滑入 + 淡入(与卸载 cs-leaving 退出对称)。animation 仅首帧播放一次,之后 transform 由 transition 控制 */
  animation: cs-drawer-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes cs-drawer-in {
  from { opacity: 0; transform: translateX(32px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .chat-dialog { animation: none; }
}
.chat-dialog.collapsed { height: 52px; }

/* 收起/展开过渡:chat-body 与 chat-footer 淡入淡出 + 轻微平移 */
.cs-slide-enter-active, .cs-slide-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.cs-slide-enter-from, .cs-slide-leave-to { opacity: 0; transform: translateY(-6px); }

/* 卸载退出过渡:sdk.unmount() 在根元素加 cs-leaving class,触发淡出 + 缩放,动画结束再卸载 DOM */
.chat-dialog.cs-leaving { opacity: 0; transform: scale(0.96) translateY(8px); pointer-events: none; }
/* 抽屉模式卸载:向右滑出而非缩小 */
.chat-dialog.drawer.cs-leaving { transform: translateX(100%); }
.chat-mask.cs-leaving { opacity: 0; }
/* 抽屉模式隐藏(sdk.hide()):不卸载,保留 agent/历史/生成进程;opacity+visibility 保留 transition,再 show 恢复 */
.chat-dialog.cs-hidden, .chat-mask.cs-hidden { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease, visibility 0s 0.2s; }

.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: var(--cs-primary);
  color: #fff; cursor: pointer; user-select: none;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-icon { font-size: 20px; }
.header-title { font-size: 15px; font-weight: 600; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
.status-dot.pulse { animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.header-actions { display: flex; gap: 4px; }
.action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: rgba(255, 255, 255, 0.15); color: #fff; cursor: pointer;
  transition: background 0.2s;
}
.action-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.3); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.action-btn.debug-btn { position: relative; } /* 与其他 action-btn 一致(28x28);badge 绝对定位角标 */
.action-btn.debug-btn.active { background: rgba(255, 255, 255, 0.45); }
.debug-badge {
  position: absolute; top: -2px; right: -2px;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: #ef4444; color: #fff; font-size: 10px; line-height: 16px; font-weight: 600;
}

.chat-body { flex: 1; overflow-y: auto; padding: 16px; min-height: 0; overscroll-behavior: contain; }
/* 注:不设 scroll-behavior:smooth —— 流式生成频繁 scrollToBottom,smooth 动画会与 @scroll 的 stick-to-bottom 判定竞争(动画中段被误判为用户上滑),导致"划走又返回" */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 200px; color: #9ca3af;
}
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-state p { font-size: 14px; }

.message-row { display: flex; gap: 10px; margin-bottom: 16px; align-items: flex-start; }
.message-row.user { flex-direction: row-reverse; }
.message-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #f3f4f6;
  display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
}
.message-row.user .message-avatar { background: #ecf5ef; }
.message-content { max-width: 80%; min-width: 0; }
.message-bubble {
  padding: 9px 13px; border-radius: 12px; font-size: 13px; line-height: 1.6;
  overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;
}
.message-row.assistant .message-bubble { background: #f3f4f6; color: #1f2937; border-bottom-left-radius: 4px; white-space: normal; overflow-wrap: anywhere; }
.message-row.user .message-bubble { background: var(--cs-primary); color: #fff; border-bottom-right-radius: 4px; }
.message-row.user .message-content { display: flex; flex-direction: column; align-items: flex-end; }
.message-time { font-size: 11px; color: #9ca3af; margin-top: 4px; padding: 0 4px; }

.typing { display: flex; gap: 4px; padding: 12px 16px; }
.typing .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; animation: bounce 1.4s infinite ease-in-out; }
.typing .dot:nth-child(2) { animation-delay: 0.2s; }
.typing .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
.typing-text { font-size: 13px; color: #9ca3af; }

.reasoning-block { margin-bottom: 6px; border: 1px dashed #b8d4c5; border-radius: 8px; overflow: hidden; background: #f0f7f3; }
.reasoning-header { display: flex; align-items: center; gap: 6px; padding: 5px 10px; cursor: pointer; user-select: none; font-size: 12px; color: #2d5a47; }
.reasoning-icon { font-size: 13px; }
.reasoning-title { font-weight: 600; }
.reasoning-toggle { margin-left: auto; }
.reasoning-body { padding: 8px 10px; border-top: 1px dashed #b8d4c5; font-size: 12px; line-height: 1.6; color: #16402f; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; }

.steps-block { margin-bottom: 6px; display: flex; flex-direction: column; gap: 4px; }
.step-item { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; align-self: flex-start; padding: 2px 8px; border-radius: 10px; background: #ecfeff; border: 1px solid #a5f3fc; font-size: 11px; color: #0e7490; max-width: 100%; }
.step-head { display: inline-flex; align-items: center; gap: 5px; }
.step-icon { font-size: 11px; }
.step-name { font-family: 'SF Mono', Monaco, Consolas, monospace; }
.step-count { font-size: 10px; color: #0891b2; font-weight: 600; }
.step-status.running { color: #0891b2; }
.step-children { padding: 4px 8px 4px 10px; border-left: 2px solid #c4b5fd; border-radius: 0 8px 8px 0; background: #faf5ff; display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.step-children-label { font-size: 10px; font-weight: 600; color: #7c3aed; letter-spacing: 0.3px; }
.step-child { display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border-radius: 8px; background: #ede9fe; border: 1px solid #ddd6fe; font-size: 10px; color: #6d28d9; }
.step-child .step-name { color: #6d28d9; }
.step-child .step-status.running { color: #8b5cf6; }

.stream-cursor, .typing-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: text-bottom; background: var(--cs-primary); animation: blink 1s steps(2) infinite; }
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

.error-bar { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; margin-top: 8px; }
.error-text { flex: 1; min-width: 0; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; max-height: 120px; overflow-y: auto; }
.error-bar .retry-btn, .error-bar .undo-btn { flex-shrink: 0; margin-top: 1px; }
.retry-btn { flex-shrink: 0; padding: 3px 12px; border: none; border-radius: 6px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.retry-btn:hover { background: #b91c1c; }

.chat-footer { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #f3f4f6; background: #fafafa; }
.chat-input {
  flex: 1; resize: none; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 9px 12px; font-size: 13px; font-family: inherit; line-height: 1.5;
  outline: none; transition: border-color 0.2s; max-height: 100px; overflow-y: auto;
  overflow-wrap: anywhere; word-break: break-word;
}
.chat-input:focus { border-color: var(--cs-primary); box-shadow: 0 0 0 2px rgba(var(--cs-primary-rgb), 0.1); }
.send-btn {
  display: flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border: none; border-radius: 8px;
  background: var(--cs-primary); color: #fff; cursor: pointer;
  transition: opacity 0.2s, transform 0.1s; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.05); }
.send-btn:active:not(:disabled) { transform: scale(0.95); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop-btn { background: #9ca3af; }
.send-btn.stop-btn:hover:not(:disabled) { background: #6b7280; transform: none; }

/* 能力徽标(footer 左,纯展示 MCP/工具数;位置预留后续拓展) */
.cap-badge { flex-shrink: 0; align-self: center; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb; color: #6b7280; font-size: 11px; white-space: nowrap; user-select: none; }

/* 最后一条 assistant 操作(复制/重新生成,hover 显示) */
.msg-actions { display: flex; gap: 6px; margin-top: 4px; opacity: 0; transition: opacity 0.2s; }
.message-row.assistant:hover .msg-actions { opacity: 1; }
.msg-action-btn { padding: 2px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.msg-action-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: #f0f7f3; }

/* 回退按钮(error-bar 内 + footer 常驻;checkpoint 选项开启时显示) */
.undo-btn { margin-left: 6px; padding: 2px 10px; border: 1px solid #f59e0b; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.undo-btn:hover { background: #fde68a; }
.undo-foot-btn { flex-shrink: 0; align-self: center; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb; color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.undo-foot-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: #f0f7f3; }

/* 人工确认条(approval 中间件挂起时显示) */
.approval-bar { margin: 8px 12px; padding: 10px 12px; border: 1px solid #f59e0b; border-radius: 10px; background: #fffbeb; }
.approval-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #92400e; }
.approval-icon { font-size: 15px; }
.approval-title code { padding: 1px 6px; border-radius: 4px; background: #fef3c7; color: #78350f; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.approval-toggle { margin-left: auto; padding: 2px 8px; border: none; background: transparent; color: #92400e; font-size: 12px; cursor: pointer; border-radius: 4px; }
.approval-toggle:hover { background: #fef3c7; }
.approval-args { margin: 8px 0; padding: 8px; max-height: 140px; overflow: auto; border-radius: 6px; background: #fff; border: 1px solid #fde68a; font-size: 12px; color: #57534e; white-space: pre-wrap; word-break: break-all; }
.approval-actions { display: flex; gap: 8px; justify-content: flex-end; }
.approval-actions button { padding: 5px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
.approval-deny { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.approval-deny:hover { background: #e5e7eb; color: #374151; }
.approval-allow { background: var(--cs-primary); color: #fff; }
.approval-allow:hover { opacity: 0.9; }
.approval-question { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #fff; border: 1px solid #fde68a; font-size: 13px; color: #57534e; line-height: 1.5; white-space: pre-wrap; }
.approval-context { margin: 4px 0 8px; font-size: 12px; color: #92400e; line-height: 1.5; }
.approval-recommend { margin: 4px 0 8px; font-size: 12px; color: #1f4d3a; }
.approval-opt { padding: 5px 14px; border: 1px solid var(--cs-primary); border-radius: 6px; background: #fff; color: var(--cs-primary); font-size: 13px; cursor: pointer; transition: all 0.2s; }
.approval-opt:hover { background: var(--cs-primary); color: #fff; }

/* 乐观锁冲突条(dataOps 写入时 expectedHash 不匹配,挂起等用户决定) */
.conflict-bar { margin: 8px 12px; padding: 10px 12px; border: 1px solid #dc2626; border-radius: 10px; background: #fef2f2; }
.conflict-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #991b1b; }
.conflict-icon { font-size: 15px; }
.conflict-title code { padding: 1px 6px; border-radius: 4px; background: #fee2e2; color: #7f1d1d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.conflict-detail { margin: 6px 0 8px; font-size: 12px; color: #7f1d1d; line-height: 1.5; }
.conflict-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.conflict-actions button { padding: 5px 14px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
.conflict-keep { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.conflict-keep:hover { background: #e5e7eb; color: #374151; }
.conflict-overwrite { background: #dc2626; color: #fff; }
.conflict-overwrite:hover { opacity: 0.9; }
.conflict-restore { background: #fff; color: #dc2626; border: 1px solid #dc2626; }
.conflict-restore:hover { background: #fee2e2; }
.conflict-toggle { margin: 2px 0 6px; padding: 2px 8px; border: none; background: transparent; color: #991b1b; font-size: 12px; cursor: pointer; border-radius: 4px; }
.conflict-toggle:hover { background: #fee2e2; }
.conflict-diff { display: flex; gap: 8px; margin: 4px 0 8px; }
.conflict-diff-col { flex: 1; min-width: 0; }
.conflict-diff-label { font-size: 11px; color: #7f1d1d; margin-bottom: 2px; }
.conflict-diff-pre { margin: 0; padding: 6px; max-height: 140px; overflow: auto; border-radius: 6px; background: #fff; border: 1px solid #fecaca; font-size: 11px; color: #57534e; white-space: pre-wrap; word-break: break-all; }
</style>
