<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChat } from '../composables/useChat'
import type { AgentMessage } from '../types'

const props = withDefaults(defineProps<{
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>
  title?: string
  placeholder?: string
}>(), {
  title: 'AI 助手',
  placeholder: '输入消息，Enter 发送...',
})

const { state, scrollContainer, sendMessage, clearMessages } = useChat(props.fetchResponse)

const inputText = ref('')
const isExpanded = ref(true)

const hasMessages = computed(() => state.messages.length > 0)

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
        <p>有什么可以帮你的？</p>
      </div>

      <div
        v-for="(msg, idx) in state.messages"
        :key="idx"
        class="message-row"
        :class="msg.role"
      >
        <div class="message-avatar">
          {{ msg.role === 'user' ? '👤' : '🤖' }}
        </div>
        <div class="message-content">
          <div class="message-bubble">{{ msg.content }}</div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="state.loading" class="message-row assistant">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-bubble typing">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="state.error" class="error-bar">
        {{ state.error }}
      </div>
    </div>

    <!-- 输入区域 -->
    <div v-show="isExpanded" class="chat-footer">
      <textarea
        v-model="inputText"
        class="chat-input"
        :placeholder="placeholder"
        rows="1"
        @keydown="handleKeydown"
      ></textarea>
      <button
        class="send-btn"
        :disabled="!inputText.trim() || state.loading"
        @click="handleSend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-dialog {
  display: flex;
  flex-direction: column;
  width: 420px;
  max-height: 600px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
  background: #fff;
  overflow: hidden;
  transition: all 0.3s ease;
}

.chat-dialog.collapsed {
  max-height: 52px;
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  cursor: pointer;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 20px;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
}

.status-dot.pulse {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Body */
.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-height: 300px;
  max-height: 440px;
  scroll-behavior: smooth;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #9ca3af;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state p {
  font-size: 14px;
}

/* Messages */
.message-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  align-items: flex-start;
}

.message-row.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.message-row.user .message-avatar {
  background: #ede9fe;
}

.message-content {
  max-width: 75%;
}

.message-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.message-row.assistant .message-bubble {
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}

.message-row.user .message-bubble {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message-row.user .message-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.message-time {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  padding: 0 4px;
}

/* Typing indicator */
.typing {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}

.typing .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  animation: bounce 1.4s infinite ease-in-out;
}

.typing .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}

/* Error */
.error-bar {
  padding: 8px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  text-align: center;
  margin-top: 8px;
}

/* Footer */
.chat-footer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #f3f4f6;
  background: #fafafa;
}

.chat-input {
  flex: 1;
  resize: none;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.2s;
  max-height: 100px;
  overflow-y: auto;
}

.chat-input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: scale(1.05);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
