/**
 * Markdown 渲染 composable
 *
 * 将 AI 回复的 markdown 文本解析为 HTML，
 * 并对代码块应用 highlight.js 语法高亮。
 * 同时提取代码块信息，便于前端添加"复制/预览"操作按钮。
 */
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'

export interface CodeBlock {
  lang: string
  code: string
}

marked.setOptions({
  breaks: true,
  gfm: true,
})

const renderer = new marked.Renderer()

// 自定义代码块渲染：加上语言标识和占位 hook，前端再增强交互
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = (lang || '').trim() || 'plaintext'
  let highlighted = ''
  try {
    highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    highlighted = escapeHtml(text)
  }
  const encoded = encodeURIComponent(text)
  return `<pre class="code-block" data-lang="${language}" data-code="${encoded}"><code class="hljs language-${language}">${highlighted}</code></pre>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function useMarkdown(content: () => string) {
  const html = computed(() => marked.parse(content() || '', { renderer }))

  /** 从内容中提取所有代码块（用于预览判断） */
  const codeBlocks = computed<CodeBlock[]>(() => {
    const blocks: CodeBlock[] = []
    const regex = /```(\w+)?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(content() || '')) !== null) {
      blocks.push({
        lang: (match[1] || 'plaintext').toLowerCase(),
        code: match[2],
      })
    }
    return blocks
  })

  return { html, codeBlocks }
}
