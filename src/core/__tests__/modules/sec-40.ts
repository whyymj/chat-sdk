/**
 * sec-40:useChat loading 中排队续跑 + 撤销/修改(修"生成中回车输入丢失"bug)
 * - loading 中 sendMessage → 入 queuedTasks 排队区(不进 messages,避免打乱"最后 user"定位;可见可撤销)
 * - 多条排队都保留;removeQueuedTask 撤销
 * - 生成完 finishRound 依次自动执行(shift → addMessage → runAssistantStream),顺序正确不跳条
 * - stop 清空排队 + abort
 */
import { useChat } from '../../composables/useChat'
import type { TestCtx } from './_ctx'

/** 轮询等待条件成立(容错异步时序) */
async function waitFor(fn: () => boolean, timeoutMs = 800): Promise<boolean> {
  const start = Date.now()
  while (!fn() && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 10))
  return fn()
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // ===== loading 中排队:入 queuedTasks(不进 messages)+ 撤销 =====
  console.log('\n[useChat · loading 中排队 + 撤销]')
  {
    let streamCalls = 0
    // 永不自动 resolve(模拟持续生成);监听 abort 让 stop 能终止
    const fetchStream = async (_m: any[], _oe: any, signal: any) => {
      streamCalls++
      return new Promise<string>((_, reject) => {
        if (signal) signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    const { state, queuedTasks, sendMessage, removeQueuedTask, stop } = useChat({ fetchStream: fetchStream as any })

    sendMessage('A')
    assert(state.loading === true && state.messages.length === 2, '✓ sendMessage(A) → loading + user A + assistant 占位')
    assert(streamCalls === 1 && queuedTasks.value.length === 0, '✓ sendMessage(A) → 1 次 fetchStream,排队区空')

    // 修 bug 核心:loading 中 sendMessage(B) → 入排队区(不进 messages,可见可撤销)
    sendMessage('B')
    assert(queuedTasks.value.length === 1 && queuedTasks.value[0] === 'B', '✓ loading 中 sendMessage(B) → 入排队区(保留可见)【修输入丢失 bug】')
    assert(state.messages.length === 2, '✓ loading 中 sendMessage(B) → 不进 messages(不打乱"最后 user"定位)')
    assert(streamCalls === 1, '✓ loading 中 sendMessage(B) → 不触发新 fetchStream(排队不并发)')

    sendMessage('C')
    assert(queuedTasks.value.length === 2 && queuedTasks.value[1] === 'C', '✓ loading 中 sendMessage(C) → 入排队区(多条都保留)')

    // 撤销 C(队尾 idx=1)
    removeQueuedTask(1)
    assert(queuedTasks.value.length === 1 && queuedTasks.value[0] === 'B', '✓ removeQueuedTask(1) → 撤销 C,剩 B')

    // stop → 清空排队 + abort 当前
    stop()
    assert(queuedTasks.value.length === 0, '✓ stop → 清空排队区')
    await waitFor(() => !state.loading)
    assert(state.loading === false, '✓ stop → loading=false(abort 后,排队不续跑)')
  }

  // ===== 生成完依次续跑多条(顺序正确不跳条) =====
  console.log('\n[useChat · 生成完依次续跑多条]')
  {
    const resolvers: Array<(v: string) => void> = []
    const fetchStream = async (_m: any[], onEvent: any) => {
      return new Promise<string>((resolve) => {
        resolvers.push((v: string) => { onEvent({ type: 'text', delta: v }); resolve(v) })
      })
    }
    const { state, sendMessage } = useChat({ fetchStream: fetchStream as any })

    sendMessage('A')
    sendMessage('B')
    sendMessage('C') // 两条排队(B 先 C 后)
    assert(state.messages.length === 2, '✓ A 生成中,B/C 在排队区不进 messages(只 A + 占位)')

    resolvers[0]('reply-A') // A 完 → 续跑 B
    await waitFor(() => resolvers.length >= 2)
    assert(resolvers.length === 2, '✓ A 完 → 自动续跑 B')
    assert(state.messages.filter((m) => m.role === 'user').length === 2, '✓ B 续跑时已 addMessage 进 messages(A+B 两条 user)')

    resolvers[1]('reply-B') // B 完 → 续跑 C
    await waitFor(() => resolvers.length >= 3)
    assert(resolvers.length === 3, '✓ B 完 → 自动续跑 C(依次,不跳条)')

    resolvers[2]('reply-C') // C 完
    await waitFor(() => !state.loading)
    assert(state.loading === false, '✓ 排队全跑完 → loading=false')
    const roles = state.messages.map((m) => m.role).join(',')
    assert(roles === 'user,assistant,user,assistant,user,assistant', '✓ 顺序 A→asstA→B→asstB→C→asstC(6 条,依次执行顺序正确)')
  }
}
