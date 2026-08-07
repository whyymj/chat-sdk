/**
 * sec-52:useChat.reset() 会话切换状态收口(主流程审查 P1-b)
 * - 切会话/新建时 reset 清 loading/queuedTasks/error/pendingApproval + abort,防 ghost 流续烧 token + 跨会话残留
 *
 * useChat 是 Vue composable(reactive/ref),Vue 3 响应式在 node+tsx 可跑(纯 Proxy 无需 DOM)。
 * 此处测 reset 纯逻辑(清状态);ChatDialog 的 handleNewSession/handleOpenSession wrapper 经 browser session-history 覆盖。
 */
import { useChat } from '../../composables/useChat'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[useChat.reset · 会话切换状态收口(P1-b)]')
  const { state, queuedTasks, pendingApproval, reset } = useChat({} as any)
  // 模拟生成中残留:ghost 流 loading + 排队任务 + 错误 + 待确认(切会话时这些若不清则跨会话泄漏)
  ;(state as any).loading = true
  ;(state as any).error = '生成失败残留'
  ;(queuedTasks as any).value = ['排队任务A', '排队任务B']
  ;(pendingApproval as any).value = { toolName: 'write', args: { x: 1 }, resolve: () => {} }
  reset()
  assert(state.loading === false, '✓ P1-b reset:清 loading(切会话 ghost 流状态不残留)')
  assert(state.error === null, '✓ P1-b reset:清 error')
  assert(queuedTasks.value.length === 0, '✓ P1-b reset:清 queuedTasks(排队任务不跨会话泄漏)')
  assert(pendingApproval.value === null, '✓ P1-b reset:清 pendingApproval(待确认不跨会话残留)')
}
