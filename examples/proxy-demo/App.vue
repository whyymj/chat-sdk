<script setup lang="ts">
/**
 * 代理连接示例 —— page-agent-sdk 用 createProxyLlm 走代理模式,防 apiKey 泄露。
 *
 * 运行(两个进程):
 *   1. npm run proxy:mock   → LLM 代理 server @ http://localhost:3002
 *   2. npm run dev          → 访问 http://localhost:3000/examples/proxy-demo/
 *
 * 浏览器只持 userToken(demo-token-xxx),代理 server 注入真实 apiKey 转发到 LLM API。
 * 切换 token 类型可演示:
 *   - demo-token-xxx        → 正常工作
 *   - demo-token-expired    → 401,触发 refreshToken 自动刷新重试
 *
 * 对话框里随便问问题,Agent 经代理调用 LLM(真实 apiKey 在服务端,浏览器不可见)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, createProxyLlm, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 演示用 token(可切换):demo-token-xxx 正常 / demo-token-expired 触发刷新
const tokenType = ref<'normal' | 'expired'>('normal')
const refreshTokenCount = ref(0)

function currentToken(): string {
  return tokenType.value === 'expired' ? 'demo-token-expired' : 'demo-token-xxx'
}

function buildAgent() {
  agent?.unmount()
  agent = createChatSdk({
    container: root.value!,
    id: 'proxy-demo',
    storage: 'memory',
    llm: createProxyLlm({
      mode: 'proxy',
      // 代理地址(同源避免 CORS;此处演示跨域,代理已开 CORS)
      baseUrl: 'http://localhost:3002',
      userToken: currentToken(),
      model: import.meta.env.VITE_AI_MODEL || 'deepseek-chat',
      temperature: 0.3,
      // token 过期自动刷新:401 时调一次,返回新 token 重试
      refreshToken: async () => {
        refreshTokenCount.value++
        const r = await fetch('http://localhost:3002/api/refresh', { method: 'POST' })
        const data = await r.json()
        return data.token as string
      },
      // 附加 headers(演示透传到代理)
      headers: { 'X-Tenant': 'demo-tenant' },
    }),
    systemPrompt: '你是一个简洁的对话助手。用一两句话回答。',
    appendReliableWriteRules: false,
    debug: true,
    dialog: {
      title: '代理连接示例(防 apiKey 泄露)',
      placeholder: '随便问:你好 / 介绍下你自己',
    },
  })
  agent.mount()
}

function switchToken() {
  tokenType.value = tokenType.value === 'normal' ? 'expired' : 'normal'
  refreshTokenCount.value = 0
  buildAgent()
}

onMounted(() => buildAgent())
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🔐 代理连接示例</h2>
      <p class="hint">
        浏览器只持 <code>userToken</code>,真实 <code>apiKey</code> 在代理 server(服务端),DevTools 抓不到。
        Agent 经代理调用 LLM,响应透传回浏览器。
      </p>

      <div class="steps">
        <div class="step">
          <b>① 启动代理 server</b>
          <code>npm run proxy:mock</code>
          <span class="muted">→ http://localhost:3002</span>
        </div>
        <div class="step">
          <b>② 访问本页</b>
          <span class="muted">浏览器只持 userToken,无真实 apiKey</span>
        </div>
        <div class="step">
          <b>③ 对话</b>
          <span class="muted">请求 → 代理注入 key → 上游 LLM → 透传回浏览器</span>
        </div>
      </div>

      <div class="token-panel">
        <div class="token-row">
          <span class="label">当前 token:</span>
          <code class="token" :class="{ expired: tokenType === 'expired' }">{{ currentToken() }}</code>
        </div>
        <div class="token-row">
          <span class="label">刷新次数:</span>
          <code>{{ refreshTokenCount }}</code>
        </div>
        <button class="btn" @click="switchToken">
          切换为 {{ tokenType === 'normal' ? '过期 token(演示刷新)' : '正常 token' }}
        </button>
        <p class="muted small">
          切到「过期」后发消息 → 代理返 401 → SDK 自动调 refreshToken 拿新 token 重试(刷新次数 +1)
        </p>
      </div>

      <div class="arch">
        <div class="arch-line">
          <span class="arch-box browser">浏览器</span>
          <span class="arch-arrow">→ userToken</span>
          <span class="arch-box proxy">代理 server</span>
          <span class="arch-arrow">→ 真实 apiKey</span>
          <span class="arch-box llm">LLM API</span>
        </div>
        <p class="muted small">真实 apiKey 只在「代理 server → LLM API」这一段,浏览器全程不可见</p>
      </div>
    </aside>

    <main ref="root" class="pane pane-right"></main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  width: 100%;
}
.pane {
  height: 100vh;
  overflow: auto;
}
.pane-left {
  width: 380px;
  padding: 64px 20px 20px;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
}
.pane-right {
  flex: 1;
  position: relative;
}
h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.hint {
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
  margin: 0 0 16px;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}
.step {
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
}
.step b {
  display: block;
  margin-bottom: 4px;
  color: #1e293b;
}
.step code {
  display: inline-block;
  padding: 2px 6px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 4px;
  font-size: 12px;
}
.token-panel {
  padding: 14px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  margin-bottom: 20px;
}
.token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}
.token-row .label {
  color: #64748b;
  min-width: 72px;
}
.token {
  padding: 2px 8px;
  background: #ecfdf5;
  color: #047857;
  border-radius: 4px;
  font-size: 12px;
}
.token.expired {
  background: #fef2f2;
  color: #b91c1c;
}
.btn {
  width: 100%;
  padding: 8px 12px;
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  margin: 8px 0;
}
.btn:hover {
  background: #4338ca;
}
.muted {
  color: #94a3b8;
  font-size: 12px;
}
.small {
  font-size: 11px;
  line-height: 1.5;
  margin: 6px 0 0;
}
.arch {
  padding: 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.arch-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
}
.arch-box {
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: 600;
}
.arch-box.browser {
  background: #dbeafe;
  color: #1e40af;
}
.arch-box.proxy {
  background: #fef3c7;
  color: #92400e;
}
.arch-box.llm {
  background: #dcfce7;
  color: #166534;
}
.arch-arrow {
  color: #94a3b8;
  font-size: 10px;
}
</style>
