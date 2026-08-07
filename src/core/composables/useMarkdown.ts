/**
 * Markdown 渲染 composable
 *
 * 将 AI 回复的 markdown 文本解析为 HTML，并對代码块应用 highlight.js 语法高亮。
 * 同时提取代码块信息，便于前端添加"复制/预览"操作按钮。
 *
 * 安全(主流程审查 P0-2):marked v18 默认不净化 HTML,AI 回复经 v-html 渲染 = XSS sink
 * (fetchDoc 抓取的恶意文档经 LLM 回显即可在宿主 origin 执行脚本)。所有 marked 输出经
 * DOMPurify.sanitize 剥事件属性/危险协议(javascript:),保留 data-*(code-block 交互依赖)。
 */
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

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
  // data-lang 就地 HTML 转义:lang 来自代码围栏 info string,可含 "/</>,不转义可逃逸属性边界(P0-2)
  const safeLang = escapeHtmlAttr(language)
  return `<pre class="code-block" data-lang="${safeLang}" data-code="${encoded}"><code class="hljs language-${safeLang}">${highlighted}</code></pre>`
}

/** HTML 属性值转义(防属性边界逃逸)。供 renderer.code 的 data-lang 用,可单测。 */
export function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// sanitize 配置:DOMPurify 默认白名单已剥 onerror/onload 等事件属性 + javascript: 协议 href;
// data-* 默认放行(DATA_ATTR=true),此处显式 ADD_ATTR data-code/data-lang 双保险 ——
// MessageContent 的复制/预览/下载按钮依赖这两个属性,防未来默认白名单收紧时静默丢失。
const SANITIZE_CONFIG: Record<string, unknown> = {
  ADD_ATTR: ['data-code', 'data-lang', 'target', 'rel'],
}

/** 净化 marked 输出的 HTML:剥事件属性/危险协议,保留 data-*(code-block 交互)。纯函数,browser E2E 测过滤行为。 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

export function useMarkdown(content: () => string) {
  const html = computed(() => sanitizeMarkdownHtml(marked.parse(content() || '', { renderer }) as string))

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
