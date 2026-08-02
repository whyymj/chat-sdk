/**
 * 对话状态管理 composable(通用)
 *
 * 管理消息列表、loading 状态、错误信息,并提供发送消息的入口。
 * 支持流式(fetchStream)与非流式(fetchResponse)两种模式。纯状态管理,不耦合任何业务工具。
 *
 * messages/onPersist/onClear 为持久化集成预留(由 createChatSdk 注入):
 *  - messages:外部共享响应式数组,与父级共用同一引用(刷新恢复时灌入)
 *  - onPersist:一轮完成后回调(落盘)
 *  - onClear:清空时回调(新建会话)
 *
 * sendMessage / regenerate 共用 runAssistantStream:前者先 push user,后者移除旧 assistant 后以历史重发。
 */
import { reactive, ref } from 'vue'
import type { AgentMessage, AgentState, StreamHandler, ToolStep } from '../types'
import { isAbort } from '../harness/retry'

type FetchFn = (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>
type StreamFn = (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>

/** 待确认的工具调用(approval_request 事件挂起,等用户点「允许/拒绝/选方案」) */
export interface PendingApproval {
  toolName: string
  args: any
  resolve: (approved: boolean | string) => void
}

export function useChat(
  opts: {
    fetchResponse?: FetchFn
    fetchStream?: StreamFn
    /** 外部共享的消息数组(持久化恢复时传入,与父级共用同一响应式引用) */
    messages?: AgentMessage[]
    /** 一轮对话完成后回调(用于持久化);可返回 Promise,sendMessage 会 await 确保落盘后再关 loading */
    onPersist?: (messages: AgentMessage[]) => void | Promise<void>
    /** 清空对话时回调(用于新建会话) */
    onClear?: () => void
  } = {},
) {
  const { fetchResponse, fetchStream, onPersist, onClear } = opts

  /** 对话状态:消息列表 + loading + 错误(messages 可与父级共享同一引用) */
  const state = reactive<AgentState>({
    messages: (opts.messages ?? []) as AgentMessage[],
    loading: false,
    error: null,
  })

  /** 消息列表容器 DOM 引用,用于自动滚动 */
  const scrollContainer = ref<HTMLElement | null>(null)

  /** 是否"吸附底部":用户向上滚查看历史时停止自动跟随,滚回底部附近恢复跟随 */
  const isStickyBottom = ref(true)
  /** 距底部多少像素内视为"在底部"(吸附判定阈值,用于滚回底部恢复跟随) */
  const STICKY_THRESHOLD = 64

  /** 当前生成的 AbortController(stop() 中止用;每次 sendMessage/regenerate 新建,停止不影响后续发送) */
  let currentController: AbortController | null = null
  /** 排队待发的任务内容(生成中用户又发消息 → 入队显示在排队区,生成完依次自动 addMessage+执行;
   * 不先进 messages 避免多条排队时打乱"最后 user"定位;可撤销/修改;stop 清空) */
  const queuedTasks = ref<string[]>([])

  /** 待确认的工具调用(人工确认挂起中);一次只挂一个,确认完清空 */
  const pendingApproval = ref<PendingApproval | null>(null)

  // stick-to-bottom 完全由 onWheel(用户滚轮意图)管;onScroll 不再改 isStickyBottom ——
  // 否则程序 scrollToBottom(流式跟随)触发 onScroll 会把 isStickyBottom 重设为 true,
  // 覆盖用户上滑设的 false,致"生成中上滑被拉回底部"震颤。
  function onScroll() { /* no-op:保留给 @scroll 绑定;sticky 由 onWheel 管 */ }

  /** wheel 事件处理:用户滚轮意图驱动 stick-to-bottom。
   *  上滑(deltaY<0)→ 立即停止跟随(看历史);下滑(deltaY>0)→ 接近底部时恢复跟随(滚回底部重新吸附)。 */
  function onWheel(e: WheelEvent) {
    const el = scrollContainer.value
    if (e.deltaY < 0) {
      isStickyBottom.value = false
    } else if (el) {
      isStickyBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
    }
  }

  /** 滚到底部:仅在用户吸附底部时跟随;用 rAF 确保 DOM 增量已渲染,且执行前二次检查 sticky(用户可能在此期间上滑) */
  function scrollToBottom() {
    if (!scrollContainer.value) return
    requestAnimationFrame(() => {
      const el = scrollContainer.value
      if (!el || !isStickyBottom.value) return
      el.scrollTop = el.scrollHeight
    })
  }

  function addMessage(role: AgentMessage['role'], content: string) {
    state.messages.push({ role, content, timestamp: Date.now() })
    // 新消息默认跟随到底部(addMessage 用于 user 消息 + 非流式 assistant 回复)
    isStickyBottom.value = true
    scrollToBottom()
  }

  /**
   * 跑一轮 assistant 生成(sendMessage / regenerate 共用)。
   * 历史已含待回复的最后一条 user;占位 assistant push 到末尾,fetchStream 传 slice(0,-1) = 历史。
   * 流式优先,否则非流式 fallback。abort 不计入 error;失败移除空占位。
   */
  async function runAssistantStream(signal: AbortSignal) {
    // 新一轮生成默认跟随到底部(sendMessage 经 addMessage 已设;regenerate/retry 路径在此补设)
    isStickyBottom.value = true
    if (fetchStream) {
      const assistantMsg = reactive({
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
        reasoning: '',
        steps: [] as ToolStep[],
      })
      // 轮次分隔:多轮工具循环中模型每轮的 text/reasoning 直接拼接会连成一段("我来查一下根据结果…"),
      // 在 round>1 的首个 delta 前插一个换行,保持轮次边界可读
      let pendingSep = false
      state.messages.push(assistantMsg)
      try {
        await fetchStream(state.messages.slice(0, -1), (event) => {
          switch (event.type) {
            case 'round_start':
              if (event.round > 1 && (assistantMsg.content || assistantMsg.reasoning)) pendingSep = true
              break
            case 'reasoning':
              if (pendingSep) { assistantMsg.reasoning += '\n'; pendingSep = false }
              assistantMsg.reasoning += event.delta
              break
            case 'text':
              if (pendingSep) { assistantMsg.content += '\n'; pendingSep = false }
              assistantMsg.content += event.delta
              break
            case 'tool_call':
              assistantMsg.steps.push({ name: event.name, args: event.args, status: 'running' })
              break
            case 'tool_result': {
              for (let i = assistantMsg.steps.length - 1; i >= 0; i--) {
                if (assistantMsg.steps[i].name === event.name && assistantMsg.steps[i].status === 'running') {
                  assistantMsg.steps[i].result = event.result
                  assistantMsg.steps[i].status = event.status
                  break
                }
              }
              break
            }
            case 'subagent': {
              const spawnStep = assistantMsg.steps[assistantMsg.steps.length - 1]
              if (!spawnStep) break
              if (!spawnStep.children) spawnStep.children = []
              const fullName = event.label ? `[${event.label}] ${event.name}` : event.name
              if (event.kind === 'tool_call') {
                spawnStep.children.push({ name: fullName, args: event.args, status: 'running' })
              } else {
                for (let i = spawnStep.children.length - 1; i >= 0; i--) {
                  if (spawnStep.children[i].status === 'running' && spawnStep.children[i].name === fullName) {
                    spawnStep.children[i].result = event.result
                    spawnStep.children[i].status = event.status || 'done'
                    break
                  }
                }
              }
              break
            }
            case 'approval_request': {
              // 挂起等用户确认;resolve 由 resolveApproval 调用,清空后 agent 继续
              pendingApproval.value = {
                toolName: event.toolName,
                args: event.args,
                resolve: event.resolve,
              }
              break
            }
          }
          scrollToBottom()
        }, signal)
      } catch (err: any) {
        if (!isAbort(err, signal)) state.error = err.message || '请求失败,请重试'
        // 失败/abort 时移除空占位(已生成内容则保留)
        if (!assistantMsg.content && !assistantMsg.reasoning) {
          const idx = state.messages.indexOf(assistantMsg)
          if (idx >= 0) state.messages.splice(idx, 1)
        }
      } finally {
        await finishRound()
      }
      return
    }

    // 非流式模式
    try {
      const fetchFn = fetchResponse || defaultFetch
      const response = await fetchFn(state.messages, signal)
      addMessage('assistant', response)
    } catch (err: any) {
      if (!isAbort(err, signal)) state.error = err.message || '请求失败,请重试'
    } finally {
      await finishRound()
    }
  }

  /** 一轮结束收口:持久化 + 关 loading + 排队续跑(生成中用户又发了消息,可能多条 → 依次自动执行,每条是独立后续任务) */
  async function finishRound() {
    // 持久化当前轮(失败/慢不阻塞排队续跑 —— onPersist 抛错时仍 shift 续跑下一轮,防生成中排队被持久化故障卡死)
    try { await onPersist?.(state.messages) } catch { /* onPersist 抛错忽略,不阻塞续跑 */ }
    state.loading = false
    currentController = null
    // 取队首任务:此时才 addMessage 进 messages(保证它是"最后 user",runAssistantStream 正确定位,不被后续排队任务干扰)
    const nextContent = queuedTasks.value.shift()
    if (nextContent !== undefined) {
      addMessage('user', nextContent)
      state.loading = true
      state.error = null
      currentController = new AbortController()
      await runAssistantStream(currentController.signal)
    }
  }

  /** 撤销排队中的任务(未执行,从排队区移除;已执行的在 messages 里,不在此) */
  function removeQueuedTask(idx: number) {
    queuedTasks.value.splice(idx, 1)
  }

  /**
   * 发送消息:添加用户消息 → 跑 assistant 生成。
   * 每次新建 AbortController;stop() 可中止,abort 不计入 error。
   */
  async function sendMessage(content: string) {
    if (!content.trim()) return
    // 生成中(loading):入排队区(不先进 messages,避免多条排队时打乱"最后 user"定位);生成完 finishRound 依次自动执行。
    // 修 bug:旧版 loading 时直接 return 不发,但 ChatDialog 已清空 inputText → 输入内容丢失 + 无反馈。排队区可撤销/修改
    if (state.loading) {
      queuedTasks.value.push(content.trim())
      return
    }
    addMessage('user', content.trim())
    state.loading = true
    state.error = null
    currentController = new AbortController()
    await runAssistantStream(currentController.signal)
  }

  /** 重新生成最后一条 assistant 回复:移除它(及尾部)→ 以当前历史(含最后 user)重发 */
  async function regenerate() {
    if (state.loading) return
    const msgs = state.messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs.splice(i) // 移除该 assistant 及其后所有
        break
      }
    }
    // 需有 user 可重发
    if (!msgs.some((m) => m.role === 'user')) return
    state.loading = true
    state.error = null
    currentController = new AbortController()
    await runAssistantStream(currentController.signal)
  }

  /** 内置模拟回复(开发调试用,未接入 API 时的 fallback) */
  async function defaultFetch(messages: AgentMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()
    return `收到你的消息:"${lastUserMsg?.content}"。这是一个模拟回复,请接入实际的 AI API。`
  }

  function clearMessages() {
    onClear?.()
    state.messages.splice(0, state.messages.length)
    state.error = null
  }

  /** 停止当前生成(abort) + 清空排队(用户主动停,不再续跑后续排队任务) */
  function stop() {
    queuedTasks.value = []
    currentController?.abort()
  }

  /** 人工确认:用户点「允许」(true) / 「拒绝」(false) / 选某方案(string) → 收口挂起的 approval_request */
  function resolveApproval(approved: boolean | string) {
    const p = pendingApproval.value
    if (!p) return
    pendingApproval.value = null
    p.resolve(approved)
  }

  /** 重试最后一条用户消息:移除其后所有消息(失败占位),清错误,重发 */
  async function retry() {
    if (!state.error) return // 仅出错时重试
    const msgs = state.messages
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return
    const content = msgs[lastUserIdx].content
    msgs.splice(lastUserIdx) // 移除该 user 及其后所有消息(失败的 assistant 占位)
    state.error = null
    await sendMessage(content)
  }

  return { state, scrollContainer, pendingApproval, queuedTasks, sendMessage, removeQueuedTask, clearMessages, stop, retry, regenerate, resolveApproval, onScroll, onWheel }
}
