<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChat } from '../composables/useChat'
import MessageContent from './MessageContent.vue'
import DebugDrawer from './DebugDrawer.vue'
import type { DebugLog } from '../harness/createAgent'
import type { AgentMessage, AgentInfo, StreamHandler, ToolStep } from '../types'

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
  /** 显示头像(默认 true;false → 隐藏 🤖/👤 emoji 头像,更克制) */
  showAvatar?: boolean
  /** 显示打字动画(默认 true;false → 用「思考中…」文字替代三点动画) */
  showTyping?: boolean
}>(), {
  title: 'AI 助手',
  placeholder: '输入消息,Enter 发送...',
  showAvatar: true,
  showTyping: true,
})

const { state, scrollContainer, sendMessage, clearMessages, stop, retry, regenerate } = useChat({
  fetchResponse: props.fetchResponse,
  fetchStream: props.fetchStream,
  messages: props.initialMessages,
  onPersist: props.onPersist,
  onClear: props.onClear,
})

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
function copyText(text: string) {
  navigator.clipboard.writeText(text)
}
</script>

<template>
  <div class="chat-dialog" :class="{ collapsed: !isExpanded }">
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
          title="请求日志(查看上下文历史)"
          @click="debugVisible = true"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 2v8l-3 3v2h12v-2l-3-3V2"></path>
            <path d="M9 2h6"></path>
            <path d="M9 18h6"></path>
          </svg>
          <span class="debug-label">日志</span>
          <span v-if="hasDebugLogs" class="debug-badge">{{ debugLogs?.length }}</span>
        </button>
        <button class="action-btn" title="清空对话" @click="clearMessages" :disabled="!hasMessages">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        <button class="action-btn" @click="isExpanded = !isExpanded">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path v-if="isExpanded" d="M18 15l-6-6-6 6"></path>
            <path v-else d="M6 9l6 6 6-6"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div v-show="isExpanded" class="chat-body" ref="scrollContainer">
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
            <div v-for="(step, sIdx) in msg.steps" :key="sIdx" class="step-item">
              <div class="step-head">
                <span class="step-icon">{{ stepStatusIcon(step) }}</span>
                <span class="step-name">{{ step.name }}</span>
                <span v-if="step.status === 'running'" class="step-status running">执行中…</span>
              </div>
              <!-- 子 agent 工作进度(嵌套展示) -->
              <div v-if="step.children && step.children.length" class="step-children">
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
            <button class="msg-action-btn" title="复制" @click="copyText(msg.content)">📋 复制</button>
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
      </div>
    </div>

    <!-- 输入区域 -->
    <div v-show="isExpanded" class="chat-footer">
      <button v-if="props.getInfo" class="cap-badge" title="查看 Agent 信息(MCP / 工具)" @click="debugVisible = true">
        🔌{{ summary.mcp }} · 🔧{{ summary.tools }}
      </button>
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

    <!-- 调试抽屉 -->
    <DebugDrawer v-model:visible="debugVisible" :logs="debugLogs" :get-info="props.getInfo" />
  </div>
</template>

<style scoped>
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
}
.chat-dialog.collapsed { height: 52px; }

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
.action-btn.debug-btn { position: relative; width: auto; padding: 0 10px; gap: 4px; font-size: 12px; font-weight: 600; }
.action-btn.debug-btn .debug-label { font-size: 12px; line-height: 1; }
.action-btn.debug-btn.active { background: rgba(255, 255, 255, 0.45); }
.debug-badge {
  position: absolute; top: -2px; right: -2px;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: #ef4444; color: #fff; font-size: 10px; line-height: 16px; font-weight: 600;
}

.chat-body { flex: 1; overflow-y: auto; padding: 16px; min-height: 0; scroll-behavior: smooth; }
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
.message-content { max-width: 75%; }
.message-bubble {
  padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5;
  word-break: break-word; white-space: pre-wrap;
}
.message-row.assistant .message-bubble { background: #f3f4f6; color: #1f2937; border-bottom-left-radius: 4px; white-space: normal; }
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

.steps-block { margin-bottom: 6px; display: flex; flex-direction: column; gap: 3px; }
.step-item { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; align-self: flex-start; padding: 2px 8px; border-radius: 10px; background: #ecfeff; border: 1px solid #a5f3fc; font-size: 11px; color: #0e7490; }
.step-head { display: inline-flex; align-items: center; gap: 5px; }
.step-icon { font-size: 11px; }
.step-name { font-family: 'SF Mono', Monaco, Consolas, monospace; }
.step-status.running { color: #0891b2; }
.step-children { padding-left: 12px; border-left: 2px solid #b8d4c5; display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.step-child { display: inline-flex; align-items: center; gap: 5px; padding: 1px 6px; border-radius: 8px; background: #f8fafc; font-size: 10px; color: #64748b; }

.stream-cursor, .typing-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: text-bottom; background: var(--cs-primary); animation: blink 1s steps(2) infinite; }
@keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

.error-bar { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 8px 12px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; margin-top: 8px; }
.error-text { flex: 1; }
.retry-btn { flex-shrink: 0; padding: 3px 12px; border: none; border-radius: 6px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.retry-btn:hover { background: #b91c1c; }

.chat-footer { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #f3f4f6; background: #fafafa; }
.chat-input {
  flex: 1; resize: none; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 10px 12px; font-size: 14px; font-family: inherit; line-height: 1.4;
  outline: none; transition: border-color 0.2s; max-height: 100px; overflow-y: auto;
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

/* 能力徽标(footer 左,MCP/工具数,点击开 Agent 信息) */
.cap-badge { flex-shrink: 0; align-self: center; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb; color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.cap-badge:hover { border-color: var(--cs-primary); color: var(--cs-primary); }

/* 最后一条 assistant 操作(复制/重新生成,hover 显示) */
.msg-actions { display: flex; gap: 6px; margin-top: 4px; opacity: 0; transition: opacity 0.2s; }
.message-row.assistant:hover .msg-actions { opacity: 1; }
.msg-action-btn { padding: 2px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.msg-action-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: #f0f7f3; }
</style>
