/**
 * sec-51:Markdown 安全纯函数(主流程审查 P0-2)
 * - escapeHtmlAttr:代码围栏 info string → data-lang 属性值转义(防属性边界逃逸注入 onerror/onload)
 *
 * 注:DOMPurify.sanitize 的实际过滤行为(<img onerror> 被剥 / data-code·data-lang 保留 / javascript: href 被拦)
 *    依赖 DOM 环境,归 browser E2E(tests/browser)验证;selftest 只覆盖不依赖 DOM 的纯函数。
 *    sec-51 仅 import escapeHtmlAttr(不触发 DOMPurify.sanitize),node 下加载 dompurify 模块顶层有 typeof window
 *    守护不会抛错。
 */
import { escapeHtmlAttr } from '../../composables/useMarkdown'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[security: markdown 属性转义(P0-2)]')
  assert(escapeHtmlAttr('javascript') === 'javascript', '✓ escapeHtmlAttr: 无特殊字符原样返回')
  assert(escapeHtmlAttr('a"b') === 'a&quot;b', '✓ escapeHtmlAttr: " 转义(防 data-lang 属性值逃逸)')
  assert(escapeHtmlAttr('a<b>&c') === 'a&lt;b&gt;&amp;c', '✓ escapeHtmlAttr: & < > 全转义')
  assert(/&quot;/.test(escapeHtmlAttr('" onload=alert(1)')), '✓ escapeHtmlAttr: 攻击串的 " 被转义,无法逃逸属性边界注入 onerror/onload')
}
