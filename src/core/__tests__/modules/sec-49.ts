/**
 * sec-49:deriveTitle 会话标题自动生成(session-history,首条 user 截取)
 * - 首条 user 短 → 全文;超 30 字 → 截断 + …
 * - 跳过 assistant;无 user → undefined;content parts 数组 → 取 text;换行 → 空格;空白 → undefined
 */
import { deriveTitle } from '../../sdk/llmResolver'
import type { AgentMessage } from '../../types'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[sec-49] deriveTitle 会话标题自动生成(session-history)')

  const mk = (role: string, content: unknown): AgentMessage => ({ role, content }) as AgentMessage

  // ✓ 首条 user 短 → 全文 title
  assert(deriveTitle([mk('user', '帮我改下首页标题为红色按钮')]) === '帮我改下首页标题为红色按钮', '✓ 首条 user 短 → 全文 title')

  // ✓ 超 30 字 → 截断 + …
  const long = '这是一个非常长的用户消息用来测试标题截断功能超过三十个字的时候应该被截断加上省略号'
  const t = deriveTitle([mk('user', long)])
  assert(!!t && t.length === 31 && t.endsWith('…'), '✓ 超 30 字 → 截断首 30 + …')

  // ✓ 跳过 assistant,取首条 user
  assert(deriveTitle([mk('assistant', '你好'), mk('user', '查一下数据')]) === '查一下数据', '✓ 跳过 assistant,取首条 user')

  // ✓ 无 user / 空 → undefined
  assert(deriveTitle([mk('assistant', '你好')]) === undefined, '✓ 无 user → undefined')
  assert(deriveTitle([]) === undefined, '✓ 空 messages → undefined')

  // ✓ content 是 parts 数组 → 取 .text 拼接
  assert(deriveTitle([mk('user', [{ type: 'text', text: 'parts 消息' }])]) === 'parts 消息', '✓ content parts 数组 → 取 text')

  // ✓ 换行 → 空格
  assert(deriveTitle([mk('user', '第一行\n第二行')]) === '第一行 第二行', '✓ 换行 → 空格')

  // ✓ 纯空白 → undefined
  assert(deriveTitle([mk('user', '   \n  ')]) === undefined, '✓ 纯空白 → undefined')
}
