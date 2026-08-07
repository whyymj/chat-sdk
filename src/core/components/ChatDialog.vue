<script setup lang="ts">
import { ref, computed, watch, type Ref } from 'vue'
import { useChat } from '../composables/useChat'
import { copyText } from '../utils/clipboard'
import MessageContent from './MessageContent.vue'
import DebugDrawer from './DebugDrawer.vue'
import SkillPanel from './SkillPanel.vue'
import type { DebugLog } from '../harness/createAgent'
import type { AgentMessage, AgentInfo, StreamHandler, ToolStep } from '../types'
import type { PendingConflict } from '../sdk/createChatSdk'
import type { ConflictResolution } from '../tools/dataOps'
import type { SessionMeta } from '../backends/storage'

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
  /** ChatDialog 内创建 skill 面板提交时调 → sdk.addSkill(持久化 + 入 agent) */
  onAddSkill?: (skill: { name: string; description: string; getContent: () => string }) => void
  /** ChatDialog 内删除用户 skill 时调 → sdk.removeSkill */
  onRemoveSkill?: (name: string) => boolean
  /** 列出用户创建的 skill 名(SkillPanel 刷新列表时调) */
  getUserSkillNames?: () => string[]
  /** 读取用户创建的 skill 详情(SkillPanel 编辑时调) */
  onGetSkill?: (name: string) => { name: string; description: string; content: string } | undefined
  /** 抽屉模式:从右侧滑入 + 遮罩 + 关闭按钮(替代收起下箭头);点击遮罩/关闭按钮 emit 'close',由集成方(sdk)调 unmount */
  drawer?: boolean
  /** 抽屉模式宽度(像素或 CSS 字符串,如 500 / '500px' / '40vw');默认 420px。仅 drawer:true 生效 */
  drawerWidth?: number | string
  /** 抽屉模式默认隐藏(mount 后不显示,需 sdk.show() 才显示);由 sdk 在 mount 后调 hide() 实现,此 prop 仅用于样式控制(隐藏时禁用滑入动画) */
  drawerHidden?: boolean
  /** 输入框行数(可见高度,textarea rows 属性);默认 2(2 行初始高度,自动扩展至 max-height:50vh)。设 1 则单行;设 >2 则更高 */
  inputRows?: number
  /** 历史会话列表(storage 开启时由 SDK 注入;不传则隐藏「新建/历史」按钮) */
  sessions?: SessionMeta[]
  /** 当前会话 id(供历史列表高亮当前项) */
  currentSessionId?: string
  /** 新建会话回调(→ sdk.switchSession()) */
  onNewSession?: () => void
  /** 切到指定历史会话(→ sdk.switchSession(id)) */
  onOpenSession?: (sessionId: string) => void
  /** 删除历史会话(→ sdk.deleteSession(id)) */
  onRemoveSession?: (sessionId: string) => void
}>(), {
  title: 'AI 助手',
  placeholder: '输入消息,Enter 发送...',
  showAvatar: true,
  showTyping: true,
  inputRows: 2,
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { state, scrollContainer, pendingApproval, queuedTasks, sendMessage, removeQueuedTask, clearMessages, stop, retry, regenerate, resolveApproval, onScroll, onWheel } = useChat({
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
const skillPanelVisible = ref(false)
const moreOpen = ref(false)   // 「更多」下拉(调试 / skill / 清空 合并,减少头部按钮平铺)
const historyOpen = ref(false)   // 历史会话面板(sessions 注入时,点「历史」展开)
function fmtSessionTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + '分钟前'
  return new Date(ts).toLocaleString()
}
/** 记录每条消息思考过程的展开状态(按消息索引);默认展开(undefined = 展开),用户手动折叠后存 false */
const reasoningExpanded = ref<Record<number, boolean>>({})

const hasMessages = computed(() => state.messages.length > 0)
const hasUserMessage = computed(() => state.messages.some((m) => m.role === 'user'))
const hasDebugLogs = computed(() => (props.debugLogs?.length ?? 0) > 0)

/** 思考过程是否展开:默认 true(undefined),用户显式折叠后 false */
function isReasoningExpanded(idx: number): boolean {
  return reasoningExpanded.value[idx] !== false
}

function toggleReasoning(idx: number) {
  reasoningExpanded.value[idx] = !isReasoningExpanded(idx)
}

/** 步骤状态中文标签(running/done/error → 执行中/成功/失败),配合色块 status-dot 使用(Figma 风格) */
function statusLabel(status: 'running' | 'done' | 'error'): string {
  return status === 'running' ? '执行中' : status === 'error' ? '失败' : '成功'
}

/** 相邻同名工具合并:仅合并连续同名,count>1 显示 ×N;不相邻的同名工具分别成组(顺次展示)。状态聚合(有 error→error,有 running→running,否则 done),children 合并,耗时求和 */
function groupedSteps(steps: ToolStep[]) {
  const groups: { name: string; count: number; hasRunning: boolean; hasError: boolean; children: ToolStep[]; totalMs: number }[] = []
  for (const s of steps) {
    const last = groups.length ? groups[groups.length - 1] : null
    if (last && last.name === s.name) {
      last.count++
      if (s.status === 'running') last.hasRunning = true
      if (s.status === 'error') last.hasError = true
      if (s.durationMs) last.totalMs += s.durationMs
      if (s.children?.length) last.children.push(...s.children)
    } else {
      groups.push({
        name: s.name,
        count: 1,
        hasRunning: s.status === 'running',
        hasError: s.status === 'error',
        children: s.children?.length ? [...s.children] : [],
        totalMs: s.durationMs ?? 0,
      })
    }
  }
  return groups.map((e) => ({
    name: e.name,
    count: e.count,
    status: e.hasError ? 'error' : e.hasRunning ? 'running' : 'done',
    children: e.children,
    durationMs: e.totalMs || undefined,
  }))
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

/** 修改排队中的任务:填回输入框(用户编辑)+ 从队列移除(改完回车重新入队/发送) */
function editQueued(idx: number) {
  inputText.value = queuedTasks.value[idx] || ''
  removeQueuedTask(idx)
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

/** 抽屉模式宽度样式(像素或 CSS 字符串归一化为 CSS 值) */
const drawerWidthStyle = computed(() => {
  if (!props.drawer || props.drawerWidth == null) return null
  const w = props.drawerWidth
  // 纯数字 → px;字符串(含 '500px'/'40vw'/'50%')原样透传
  return typeof w === 'number' ? `${w}px` : w
})
</script>

<template>
  <div v-if="drawer" class="chat-mask" @click="emit('close')"></div>
  <div class="chat-dialog" :class="{ collapsed: !isExpanded && !drawer, drawer }" :style="drawerWidthStyle ? { width: drawerWidthStyle, maxWidth: drawerWidthStyle } : null">
    <!-- 头部 -->
    <div class="chat-header">
      <div class="header-left">
        <span class="header-icon">🤖</span>
        <span class="header-title">{{ title }}</span>
        <span v-if="state.loading" class="status-dot pulse"></span>
      </div>
      <div class="header-actions">
        <!-- 内置会话管理(sessions 注入 = storage 开启;不传则隐藏按钮)-->
        <button v-if="sessions" class="action-btn" data-test="new-chat" title="新建会话" @click="onNewSession?.()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>
        </button>
        <button v-if="sessions" class="action-btn" :class="{ active: historyOpen }" data-test="toggle-history" title="历史记录" @click.stop="moreOpen = false; historyOpen = !historyOpen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg>
        </button>
        <!-- 历史面板(弹出;点外部关)-->
        <div v-if="sessions && historyOpen" class="cs-history-menu" @click.stop>
          <div
            v-for="s in sessions"
            :key="s.sessionId"
            class="hist-item"
            :class="{ active: currentSessionId === s.sessionId }"
            :data-sid="s.sessionId"
            @click="onOpenSession?.(s.sessionId)"
          >
            <div class="hist-title">{{ s.title || '会话 ' + s.sessionId.slice(-6) }}</div>
            <div class="hist-meta">
              <span>{{ fmtSessionTime(s.lastAccessed) }}</span>
              <button v-if="currentSessionId !== s.sessionId" class="hist-del" data-test="del-btn" @click.stop="onRemoveSession?.(s.sessionId)">✕</button>
            </div>
          </div>
        </div>
        <!-- 更多按钮(调试 / skill / 清空 合并下拉,减少头部按钮平铺)-->
        <button
          class="action-btn more-btn"
          :class="{ active: moreOpen }"
          title="更多"
          @click.stop="historyOpen = false; moreOpen = !moreOpen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle>
          </svg>
          <span v-if="hasDebugLogs" class="debug-badge">{{ debugLogs?.length }}</span>
        </button>
        <!-- 下拉菜单 -->
        <div v-if="moreOpen" class="more-menu" @click.stop>
          <button class="more-item" title="日志 / 执行流程 / Agent 信息" @click="debugVisible = true; moreOpen = false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 2v8l-3 3v2h12v-2l-3-3V2"></path><path d="M9 2h6"></path><path d="M9 18h6"></path>
            </svg>
            <span>调试 / 日志</span>
            <span v-if="hasDebugLogs" class="more-item-badge">{{ debugLogs?.length }}</span>
          </button>
          <button v-if="props.onAddSkill" class="more-item" title="创建 / 管理自定义 Skill" @click="skillPanelVisible = true; moreOpen = false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.8 5.7 21l2.3-7.2-6-4.4h7.6z"></path>
            </svg>
            <span>Skill 管理</span>
          </button>
          <button class="more-item" title="清空对话" @click="clearMessages(); moreOpen = false" :disabled="!hasMessages">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>清空对话</span>
          </button>
        </div>
        <!-- 关闭/展开(常用,留头部)-->
        <button v-if="drawer" class="action-btn" title="关闭" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <!-- 下拉遮罩(点外部关闭:更多菜单 / 历史面板)-->
      <div v-if="moreOpen || historyOpen" class="more-overlay" @click="moreOpen = false; historyOpen = false"></div>
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
          <!-- 思考过程(可折叠,默认展开:生成中实时可见;色块 + 收起/展开文字,Figma 风格) -->
          <div
            v-if="msg.role === 'assistant' && msg.reasoning"
            class="reasoning-block"
            :class="{ expanded: isReasoningExpanded(idx) }"
          >
            <div class="reasoning-header" @click="toggleReasoning(idx)">
              <span class="status-dot ok"></span>
              <span class="reasoning-title">思考过程</span>
              <span class="reasoning-toggle">{{ isReasoningExpanded(idx) ? '收起' : '展开' }}</span>
            </div>
            <div v-if="isReasoningExpanded(idx)" class="reasoning-body">{{ msg.reasoning }}</div>
          </div>

          <!-- 工具调用步骤(色块 + 名称 + 状态标签 + 耗时,Figma 风格) -->
          <div
            v-if="msg.role === 'assistant' && msg.steps && msg.steps.length"
            class="steps-block"
          >
            <div v-for="(step, sIdx) in groupedSteps(msg.steps)" :key="sIdx" class="step-item" :class="step.status">
              <div class="step-head">
                <span class="status-dot" :class="step.status"></span>
                <span class="step-name">{{ step.name }}</span>
                <span v-if="step.count > 1" class="step-count">×{{ step.count }}</span>
                <span class="step-status" :class="step.status">{{ statusLabel(step.status) }}</span>
                <span v-if="step.durationMs != null && step.status !== 'running'" class="step-duration">{{ step.durationMs }}ms</span>
              </div>
              <!-- 子 agent 工作进度(嵌套展示;紫色系与主工具区分) -->
              <div v-if="step.children && step.children.length" class="step-children">
                <div class="step-children-label">🧬 子 agent 进度</div>
                <div v-for="(c, cIdx) in step.children" :key="cIdx" class="step-child" :class="c.status">
                  <span class="status-dot sm" :class="c.status"></span>
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

    <!-- 排队区:生成中用户又发的任务(未执行,生成完后自动执行);可撤销/修改 -->
    <div v-if="queuedTasks.length" class="queued-bar">
      <div class="queued-head">
        <span class="queued-icon">📋</span>
        <span class="queued-title">排队中 · 生成完后自动执行</span>
        <span class="queued-count">{{ queuedTasks.length }}</span>
      </div>
      <div v-for="(task, qIdx) in queuedTasks" :key="qIdx" class="queued-item">
        <span class="queued-idx">{{ qIdx + 1 }}</span>
        <span class="queued-text">{{ task }}</span>
        <button class="queued-act" title="修改(填回输入框编辑)" @click="editQueued(qIdx)">✏️</button>
        <button class="queued-act queued-del" title="撤销该任务" @click="removeQueuedTask(qIdx)">✕</button>
      </div>
    </div>

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
      <button v-if="canUndo" class="undo-foot-btn" title="回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)" @click="handleUndo">↩ 回退</button>
      <div class="chat-input-wrap">
        <textarea
          v-model="inputText"
          class="chat-input"
          :placeholder="placeholder"
          :rows="props.inputRows"
          @keydown="handleKeydown"
        ></textarea>
        <div class="input-actions">
          <span class="send-hint">Enter 发送 · Shift+Enter 换行</span>
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
      </div>
    </div>
    </Transition>

    <!-- 调试抽屉 -->
    <DebugDrawer v-model:visible="debugVisible" :logs="debugLogs" :get-info="props.getInfo" :info-tick="props.infoTick" :get-skill-content="props.getSkillContent" />
    <SkillPanel
      :visible="skillPanelVisible"
      :on-add-skill="props.onAddSkill"
      :on-remove-skill="props.onRemoveSkill"
      :get-user-skill-names="props.getUserSkillNames"
      :on-get-skill="props.onGetSkill"
      @close="skillPanelVisible = false"
    />
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
  /* 思考过程块(默认浅绿;深色主题覆盖 --cs-reason-* 即可) */
  --cs-reason-bg: #f0f7f3;
  --cs-reason-border: #b8d4c5;
  --cs-reason-head: #2d5a47;
  --cs-reason-text: #41544c;
  --cs-reason-toggle: #6b8c79;
  /* 工具步骤块(中性卡片,跨状态) */
  --cs-step-bg: #f4f6f8;
  --cs-step-border: #e2e6ea;
  --cs-step-text: #374151;
  --cs-step-meta: #9ca3af;
  /* 语义状态色(跨主题;深色主题可适当提亮) */
  --cs-ok: #16a34a; --cs-ok-rgb: 22, 163, 74;
  --cs-warn: #d97706; --cs-warn-rgb: 217, 119, 6;
  --cs-err: #dc2626; --cs-err-rgb: 220, 38, 38;
  /* 子 agent 紫色系 */
  --cs-sub-bg: #faf5ff;
  --cs-sub-border: #c4b5fd;
  --cs-sub-text: #6d28d9;
  /* markdown 渲染(表格边框/th 背景/inline code;MessageContent.vue 消费) */
  --cs-md-border: #e5e7eb;
  --cs-md-th-bg: #f9fafb;
  --cs-md-code-bg: rgba(102, 126, 234, 0.1);
  --cs-md-code-text: #4338ca;
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
  flex-shrink: 0;
  position: relative; z-index: 16;  /* 高于 more-overlay(15):头部按钮(新建/历史/更多)可点,不被历史/更多面板的遮罩挡 */
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-icon { font-size: 20px; }
.header-title { font-size: 15px; font-weight: 600; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
.status-dot.pulse { animation: pulse 1.5s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.header-actions { display: flex; gap: 4px; position: relative; z-index: 20; }  /* z 高于 more-overlay(15):头部按钮(新建/历史/更多)可点,不被菜单/历史面板的遮罩挡 */
.action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: rgba(255, 255, 255, 0.15); color: #fff; cursor: pointer;
  transition: background 0.2s;
}
.action-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.3); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
/* 「更多」下拉菜单(调试 / skill / 清空 合并,减少头部按钮平铺) */
.more-btn { position: relative; }
.more-btn.active { background: rgba(255, 255, 255, 0.45); }
.more-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  min-width: 168px; padding: 4px;
  background: #fff; color: #1f2937;   /* 固定白底深字:浮层菜单跨主题清晰(不继承 .chat-header 白字;深色主题浮层仍浅,标准做法) */
  border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.more-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border: none; background: none;
  font: inherit; font-size: 13px; color: inherit; cursor: pointer; border-radius: 6px; text-align: left;
}
.more-item:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
.more-item:disabled { opacity: 0.4; cursor: not-allowed; }
.more-item svg { opacity: 0.7; flex-shrink: 0; }
.more-item-badge { margin-left: auto; background: var(--cs-primary, #1f4d3a); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 999px; }
.more-overlay { position: fixed; inset: 0; z-index: 15; }  /* 透明遮罩:点外部关菜单(zIndex 低于 menu 的 20) */
/* 历史会话面板(内置;复用 more-menu 风格,跟 --cs-* 主题深浅自适应) */
.cs-history-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  min-width: 220px; max-height: 320px; overflow-y: auto; padding: 4px;
  background: #fff; color: #1f2937;   /* 固定白底深字:历史面板跨主题清晰(同 more-menu) */
  border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.hist-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.hist-item:hover { background: rgba(0, 0, 0, 0.06); }
.hist-item.active { background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.15); border-left: 2px solid var(--cs-primary, #1f4d3a); }
.hist-title { font-size: 13px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.6; }
.hist-del { background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; padding: 0 4px; }
.hist-del:hover { opacity: 1; color: #dc2626; }
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
  padding: 9px 13px; border-radius: 12px; font-size: 12px; line-height: 1.7;
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

/* 状态色块(8×8 圆角;成功/运行/失败 三色,跨主题跟 --cs-ok/warn/err) */
.status-dot { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; background: var(--cs-step-meta); }
.status-dot.ok, .status-dot.done { background: var(--cs-ok); }
.status-dot.running { background: var(--cs-warn); }
.status-dot.error { background: var(--cs-err); }
.status-dot.sm { width: 6px; height: 6px; border-radius: 2px; }

.reasoning-block { margin-bottom: 6px; border: 1px solid var(--cs-reason-border); border-radius: 8px; overflow: hidden; background: var(--cs-reason-bg); }
.reasoning-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; user-select: none; font-size: 12px; color: var(--cs-reason-head); }
.reasoning-title { font-weight: 600; }
.reasoning-toggle { margin-left: auto; font-size: 12px; color: var(--cs-reason-toggle); }
.reasoning-body { padding: 8px 10px; border-top: 1px solid var(--cs-reason-border); font-size: 12px; line-height: 1.6; color: var(--cs-reason-text); white-space: pre-wrap; word-break: break-word; }

.steps-block { margin-bottom: 6px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.step-item { display: flex; flex-direction: column; gap: 3px; align-self: flex-start; padding: 5px 10px; border-radius: 8px; background: var(--cs-step-bg); border: 1px solid var(--cs-step-border); font-size: 11px; color: var(--cs-step-text); max-width: 100%; }
.step-head { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.step-name { font-family: 'SF Mono', Monaco, Consolas, monospace; font-weight: 600; }
.step-count { font-size: 10px; color: var(--cs-step-meta); font-weight: 600; }
/* 状态文字标签(色块同色,低 alpha 底,跨主题跟 --cs-ok/warn/err-rgb) */
.step-status { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.2px; }
.step-status.done { color: var(--cs-ok); background: rgba(var(--cs-ok-rgb), 0.12); }
.step-status.running { color: var(--cs-warn); background: rgba(var(--cs-warn-rgb), 0.12); }
.step-status.error { color: var(--cs-err); background: rgba(var(--cs-err-rgb), 0.12); }
.step-duration { font-size: 10px; color: var(--cs-step-meta); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.step-children { padding: 4px 8px 4px 10px; border-left: 2px solid var(--cs-sub-border); border-radius: 0 6px 6px 0; background: var(--cs-sub-bg); display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.step-children-label { font-size: 10px; font-weight: 600; color: var(--cs-sub-text); letter-spacing: 0.3px; }
.step-child { display: inline-flex; align-items: center; gap: 5px; padding: 1px 4px; border-radius: 6px; font-size: 10px; color: var(--cs-sub-text); }
.step-child .step-name { color: var(--cs-sub-text); font-weight: 400; }
.step-child .step-status.running { color: var(--cs-sub-text); background: rgba(108, 92, 231, 0.12); }

.stream-cursor, .typing-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: text-bottom; background: var(--cs-primary); animation: blink 1s steps(2) infinite; }
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

.error-bar { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; margin-top: 8px; }
.error-text { flex: 1; min-width: 0; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; max-height: 120px; overflow-y: auto; }
.error-bar .retry-btn, .error-bar .undo-btn { flex-shrink: 0; margin-top: 1px; }
.retry-btn { flex-shrink: 0; padding: 3px 12px; border: none; border-radius: 6px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.retry-btn:hover { background: #b91c1c; }

.chat-footer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 12px 16px;
  /* 底部安全区:防止输入框底部贴边/被遮挡;移动端 safe-area 适配 */
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  
  /* footer 不收缩不溢出:textarea 撑高时由 chat-body(flex:1, min-height:0)吸收,避免容器竖向滚动 */
  flex-shrink: 0;
}
/* 输入框容器:relative,容纳 textarea + 右下角 input-actions(发送按钮 + 提示紧挨) */
.chat-input-wrap { flex: 1; position: relative; min-width: 0; }
.chat-input {
  width: 100%; resize: vertical; border: 1px solid rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2); border-radius: 8px;
  padding: 9px 12px 38px 12px; font-size: 13px; font-family: inherit; line-height: 1.5; color: var(--cs-bg-text, inherit);
  background: transparent; outline: none; transition: border-color 0.2s; min-height: 38px; max-height: 50vh; overflow-y: auto;
  overflow-wrap: anywhere; word-break: break-word;
}
.chat-input::placeholder { color: var(--cs-bg-muted, #9ca3af); opacity: 0.7; }
.chat-input:focus { border-color: var(--cs-primary); box-shadow: 0 0 0 2px rgba(var(--cs-primary-rgb), 0.1); }
/* 输入框右下角:提示 + 发送按钮(紧挨,Figma) */
.input-actions { position: absolute; bottom: 10px; right: 10px; display: flex; align-items: center; gap: 8px; }
.send-hint { font-size: 10px; color: var(--cs-bg-muted, #9ca3af); opacity: 0.6; pointer-events: none; white-space: nowrap; }
.send-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 50%;   /* 圆形,内置输入框右下角 */
  background: var(--cs-primary); color: #fff; cursor: pointer;
  transition: opacity 0.2s, transform 0.1s; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.05); }
.send-btn:active:not(:disabled) { transform: scale(0.95); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop-btn { background: #9ca3af; }
.send-btn.stop-btn:hover:not(:disabled) { background: #6b7280; transform: none; }

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

/* 排队区:生成中用户又发的任务(未执行,生成完后自动执行);可撤销/修改 */
.queued-bar { margin: 10px 12px; padding: 10px 12px; border: 1px solid #e5e7eb; border-left: 3px solid var(--cs-primary); border-radius: 10px; background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04); }
.queued-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b7280; margin-bottom: 6px; letter-spacing: 0.2px; }
.queued-icon { font-size: 13px; }
.queued-title { font-weight: 600; color: #4b5563; }
.queued-count { margin-left: auto; min-width: 18px; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--cs-primary); color: #fff; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
.queued-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; margin-top: 6px; border-radius: 8px; background: #fff; border: 1px solid #eef0f3; transition: border-color 0.2s, box-shadow 0.2s; animation: queued-in 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.queued-item:hover { border-color: #d1d5db; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05); }
.queued-idx { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: rgba(var(--cs-primary-rgb), 0.1); color: var(--cs-primary); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.queued-text { flex: 1; min-width: 0; font-size: 12px; color: #1f2937; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queued-act { flex-shrink: 0; width: 22px; height: 22px; border: none; border-radius: 6px; background: transparent; color: #9ca3af; font-size: 11px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; opacity: 0.55; }
.queued-item:hover .queued-act { opacity: 1; }
.queued-act:hover { background: #f3f4f6; color: #1f2937; }
.queued-act.queued-del:hover { background: #fef2f2; color: #dc2626; }
@keyframes queued-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .queued-item { animation: none; } }

/* 人工确认条(approval 中间件挂起时显示) */
.approval-bar { margin: 10px 12px; padding: 12px 14px; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; border-radius: 10px; background: linear-gradient(180deg, #fffbeb 0%, #fffef5 100%); box-shadow: 0 2px 8px rgba(245, 158, 11, 0.08); }
.approval-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #92400e; }
.approval-icon { font-size: 18px; }
.approval-title { flex: 1; min-width: 0; }
.approval-title code { padding: 2px 7px; border-radius: 5px; background: #fef3c7; color: #78350f; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.approval-toggle { padding: 3px 10px; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
.approval-toggle:hover { background: #fef3c7; border-color: #f59e0b; }
.approval-args { margin: 10px 0; padding: 10px; max-height: 160px; overflow: auto; border-radius: 8px; background: #fff; border: 1px solid #fde68a; font-size: 12px; color: #57534e; white-space: pre-wrap; word-break: break-all; line-height: 1.5; }
.approval-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.approval-actions button { padding: 6px 18px; border: none; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.approval-deny { background: #fff; color: #6b7280; border: 1px solid #e5e7eb; }
.approval-deny:hover { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
.approval-allow { background: var(--cs-primary); color: #fff; box-shadow: 0 1px 3px rgba(var(--cs-primary-rgb), 0.3); }
.approval-allow:hover { opacity: 0.92; transform: translateY(-1px); }
.approval-question { margin: 10px 0; padding: 10px 12px; border-radius: 8px; background: #fff; border: 1px solid #fde68a; font-size: 13px; color: #1f2937; line-height: 1.6; white-space: pre-wrap; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); }
.approval-context { margin: 6px 0 10px; padding: 0 2px; font-size: 12px; color: #92400e; line-height: 1.6; }
.approval-recommend { margin: 8px 0 10px; padding: 8px 12px; border-radius: 8px; background: rgba(var(--cs-primary-rgb), 0.06); border-left: 3px solid var(--cs-primary); font-size: 12px; color: var(--cs-primary); line-height: 1.6; }
.approval-opt { padding: 6px 16px; border: 1px solid var(--cs-primary); border-radius: 7px; background: #fff; color: var(--cs-primary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.approval-opt:hover { background: var(--cs-primary); color: #fff; transform: translateY(-1px); }

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
