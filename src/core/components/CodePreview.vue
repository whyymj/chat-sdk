<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps<{
  code: string
  lang: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const iframeRef = ref<HTMLIFrameElement | null>(null)
const mode = ref<'preview' | 'source'>('preview')
const copied = ref(false)

/** 判断是否为可预览的代码类型 */
const isPreviewable = computed(() => {
  const l = props.lang.toLowerCase()
  return ['html', 'htm', 'vue', 'javascript', 'js', 'css'].includes(l)
})

/** 组装可在 iframe 中运行的完整 HTML 文档 */
const previewDoc = computed(() => {
  const l = props.lang.toLowerCase()

  if (l === 'html' || l === 'htm') {
    return props.code
  }

  if (l === 'vue') {
    // 简易 Vue SFC 运行：提取 template/script/style，用 Vue3 全局 API 渲染
    return wrapVueSfc(props.code)
  }

  if (l === 'javascript' || l === 'js') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:16px}</style></head><body><div id="app"></div><script>${props.code}<\/script></body></html>`
  }

  if (l === 'css') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${props.code}</style></head><body><div class="demo"><h1>CSS 预览</h1><p>这是一段示例文字，用于展示 CSS 效果。</p><button>按钮</button><input placeholder="输入框"/></div></body></html>`
  }

  return props.code
})

/** 将 Vue SFC 转为可在浏览器运行的 HTML（依赖 CDN 的 Vue3 + 运行时编译） */
function wrapVueSfc(source: string): string {
  const escaped = source.replace(/<\/script>/g, '<\\/script>')
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/vue@3/dist/vue.global.js"><\/script>
<script src="https://unpkg.com/@vue/compiler-dom@3/dist/compiler-dom.global.js"><\/script>
<style>body{margin:0;font-family:sans-serif}body>div{padding:16px}</style>
</head><body><div id="app"></div>
<script>
const { createApp, defineComponent } = Vue;
const src = ${JSON.stringify(escaped)};
// 提取三段
function extract(re){const m=src.match(re);return m?m[1]:''}
const template=extract(/<template>([\\s\\S]*?)<\\/template>/);
const scriptContent=extract(/<script>([\\s\\S]*?)<\\/script>/);
const styleContent=extract(/<style[^>]*>([\\s\\S]*?)<\\/style>/);
if(styleContent){const s=document.createElement('style');s.textContent=styleContent;document.head.appendChild(s);}
let options={};
try{ const fn=new Function(scriptContent+';\\nreturn {data:typeof data!=="undefined"?data:()=>({}),methods:typeof methods!=="undefined"?methods:{},computed:typeof computed!=="undefined"?computed:{},mounted:typeof mounted!=="undefined"?mounted:undefined}'); options=fn(); }catch(e){ console.error(e); }
const app=createApp({template:template||'<div></div>',...options});
app.mount('#app');
<\/script></body></html>`
}

watch(
  () => mode.value,
  async () => {
    await nextTick()
    if (mode.value === 'preview' && iframeRef.value) {
      iframeRef.value.srcdoc = previewDoc.value
    }
  },
  { immediate: true }
)

function copyCode() {
  navigator.clipboard.writeText(props.code).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  })
}

function openInNewTab() {
  const blob = new Blob([previewDoc.value], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
</script>

<template>
  <div class="code-preview-overlay" @click.self="emit('close')">
    <div class="code-preview-modal">
      <div class="preview-header">
        <span class="preview-title">代码预览 · {{ lang }}</span>
        <div class="preview-tabs">
          <button :class="{ active: mode === 'preview' }" :disabled="!isPreviewable" @click="mode = 'preview'">预览</button>
          <button :class="{ active: mode === 'source' }" @click="mode = 'source'">源码</button>
        </div>
        <div class="preview-actions">
          <button class="icon-btn" :title="copied ? '已复制' : '复制代码'" @click="copyCode">{{ copied ? '✓' : '📋' }}</button>
          <button class="icon-btn" title="新窗口打开" @click="openInNewTab">↗</button>
          <button class="icon-btn" title="关闭" @click="emit('close')">✕</button>
        </div>
      </div>
      <div class="preview-body">
        <iframe
          v-if="mode === 'preview' && isPreviewable"
          ref="iframeRef"
          class="preview-iframe"
          sandbox="allow-scripts allow-modals allow-popups allow-forms"
          :srcdoc="previewDoc"
        ></iframe>
        <pre v-else class="preview-source"><code>{{ code }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.code-preview-modal {
  width: 90%;
  max-width: 900px;
  height: 80vh;
  background: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #1f2937;
  color: #fff;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
}

.preview-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.preview-tabs button {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.preview-tabs button.active {
  background: #667eea;
}

.preview-tabs button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.preview-body {
  flex: 1;
  overflow: hidden;
  background: #f9fafb;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.preview-source {
  margin: 0;
  padding: 16px;
  height: 100%;
  overflow: auto;
  background: #1f2937;
  color: #e5e7eb;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
