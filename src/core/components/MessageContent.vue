<script setup lang="ts">
import { ref, computed, onMounted, onUpdated, nextTick, watch } from 'vue'
import { useMarkdown, type CodeBlock } from '../composables/useMarkdown'
import CodePreview from './CodePreview.vue'
import { copyText } from '../utils/clipboard'

const props = defineProps<{
  content: string
}>()

const { html, codeBlocks } = useMarkdown(() => props.content)

const containerRef = ref<HTMLElement | null>(null)
const previewCode = ref<CodeBlock | null>(null)

/** 可预览的代码语言 */
const previewableLangs = ['html', 'htm', 'vue', 'javascript', 'js', 'css']

function isPreviewable(lang: string) {
  return previewableLangs.includes(lang.toLowerCase())
}

/** 根据语言推断文件扩展名并下载代码 */
function downloadCode(lang: string, code: string) {
  const extMap: Record<string, string> = {
    html: 'html', htm: 'html', css: 'css', javascript: 'js', js: 'js',
    typescript: 'ts', ts: 'ts', vue: 'vue', python: 'py', json: 'json',
    xml: 'xml', markdown: 'md', md: 'md', shell: 'sh', bash: 'sh',
  }
  const ext = extMap[lang.toLowerCase()] || 'txt'
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `code-${Date.now()}.${ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 为渲染后的代码块注入操作按钮（复制/预览）。
 * 由于 marked 输出静态 HTML，这里在 DOM 渲染后手动增强交互。
 */
async function enhanceCodeBlocks() {
  await nextTick()
  const container = containerRef.value
  if (!container) return

  const blocks = container.querySelectorAll<HTMLElement>('pre.code-block')
  blocks.forEach((pre, index) => {
    if (pre.querySelector('.code-toolbar')) return

    const lang = pre.dataset.lang || 'plaintext'
    const rawCode = decodeURIComponent(pre.dataset.code || '')

    const toolbar = document.createElement('div')
    toolbar.className = 'code-toolbar'

    const langLabel = document.createElement('span')
    langLabel.className = 'code-lang'
    langLabel.textContent = lang
    toolbar.appendChild(langLabel)

    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-action-btn'
    copyBtn.innerHTML = '复制'
    copyBtn.onclick = async () => {
      const ok = await copyText(rawCode)
      copyBtn.innerHTML = ok ? '已复制 ✓' : '复制失败'
      setTimeout(() => (copyBtn.innerHTML = '复制'), 1500)
    }
    toolbar.appendChild(copyBtn)

    const dlBtn = document.createElement('button')
    dlBtn.className = 'code-action-btn'
    dlBtn.innerHTML = '⬇ 下载'
    dlBtn.title = '下载为文件'
    dlBtn.onclick = () => downloadCode(lang, rawCode)
    toolbar.appendChild(dlBtn)

    if (isPreviewable(lang)) {
      const previewBtn = document.createElement('button')
      previewBtn.className = 'code-action-btn preview-btn'
      previewBtn.innerHTML = '▶ 运行预览'
      previewBtn.onclick = () => {
        previewCode.value = { lang, code: rawCode }
      }
      toolbar.appendChild(previewBtn)
    }

    pre.appendChild(toolbar)
  })
}

onMounted(enhanceCodeBlocks)
onUpdated(enhanceCodeBlocks)
watch(() => props.content, enhanceCodeBlocks)
</script>

<template>
  <div class="message-md" ref="containerRef" v-html="html"></div>

  <Teleport to="body">
    <CodePreview
      v-if="previewCode"
      :code="previewCode.code"
      :lang="previewCode.lang"
      @close="previewCode = null"
    />
  </Teleport>
</template>

<style>
.message-md {
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-md p {
  margin: 0 0 8px;
}

.message-md p:last-child {
  margin-bottom: 0;
}

.message-md table {
  display: block; max-width: 100%; overflow-x: auto;
  border-collapse: collapse; margin: 8px 0;
}
.message-md th, .message-md td {
  border: 1px solid var(--cs-md-border, #e5e7eb); padding: 4px 8px; font-size: 12px; white-space: nowrap;
}
.message-md th { background: var(--cs-md-th-bg, #f9fafb); }
.message-md img { max-width: 100%; }

.message-md ul,
.message-md ol {
  margin: 6px 0;
  padding-left: 20px;
}

.message-md li {
  margin: 2px 0;
}

.message-md h1,
.message-md h2,
.message-md h3 {
  margin: 10px 0 6px;
  font-weight: 600;
}

.message-md h1 { font-size: 18px; }
.message-md h2 { font-size: 16px; }
.message-md h3 { font-size: 15px; }

.message-md a {
  color: #667eea;
  text-decoration: underline;
}

.message-md code:not(.hljs) {
  background: var(--cs-md-code-bg, rgba(102, 126, 234, 0.1));
  color: var(--cs-md-code-text, #4338ca);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
}

.message-md .code-block {
  position: relative;
  margin: 10px 0;
  padding: 0;
  background: #1f2937;
  border-radius: 8px;
  overflow: hidden;
}

.message-md .code-block code {
  display: block;
  padding: 12px 14px;
  overflow-x: auto;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #e5e7eb;
  background: transparent;
}

.message-md .code-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.message-md .code-lang {
  font-size: 11px;
  color: #9ca3af;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  text-transform: lowercase;
}

.message-md .code-action-btn {
  margin-left: auto;
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #e5e7eb;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.message-md .code-action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.message-md .code-action-btn.preview-btn {
  margin-left: 4px;
  background: #667eea;
  color: #fff;
}

.message-md .code-action-btn.preview-btn:hover {
  background: #5568d3;
}

/* highlight.js 主题简化 */
.message-md .hljs { color: #e5e7eb; }
.message-md .hljs-keyword { color: #c084fc; }
.message-md .hljs-string { color: #86efac; }
.message-md .hljs-comment { color: #6b7280; font-style: italic; }
.message-md .hljs-number { color: #fca5a5; }
.message-md .hljs-function .hljs-title,
.message-md .hljs-title { color: #93c5fd; }
.message-md .hljs-tag { color: #fca5a5; }
.message-md .hljs-attr { color: #fcd34d; }
.message-md .hljs-built_in { color: #67e8f9; }
</style>
