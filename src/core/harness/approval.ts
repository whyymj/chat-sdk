/**
 * Approval 中间件 —— 工具调用前人工确认(human-in-the-loop)
 *
 * 经 wrapToolCall 拦截需确认的工具调用,发 approval_request 事件(带 resolve 回调),
 * UI 收到后弹确认框,用户「允许/拒绝」调 resolve → 中间件 Promise 收口:允许则执行,拒绝则返回 error。
 *
 * - 不需确认的工具直接放行(next)
 * - abort 联动:用户停止生成(signal.aborted)→ 自动拒绝,不永久挂起
 * - 超时(timeoutMs)→ 自动拒绝(默认 0 = 不超时,等用户)
 * - 拒绝时返回结构化 error,LLM 可据此改方案(如换路径、改只读)
 *
 * 装载顺序:在 permissions 之后(白名单先自动拒,幸存的写操作再人工确认)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export interface ApprovalOptions {
  /** 需确认的工具名列表;不传 confirm 且不传 tools → 所有工具都确认 */
  tools?: string[]
  /** 自定义判定(优先于 tools);返回 true 需确认 */
  confirm?: (name: string, args: any) => boolean
  /** 超时毫秒(用户未响应自动拒绝);0 = 不超时(默认) */
  timeoutMs?: number
}

export function createApprovalMiddleware(opts: ApprovalOptions = {}): Middleware {
  const needConfirm = (name: string, args: any): boolean => {
    if (opts.confirm) return !!opts.confirm(name, args)
    // tools 显式给出(含空数组)→ 仅确认列表内;未给 tools → 确认所有
    if (opts.tools !== undefined) return opts.tools.includes(name)
    return true
  }

  return {
    name: 'approval',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      if (!needConfirm(ctx.name, ctx.args)) return next(ctx)

      return new Promise<ToolExecResult>((resolve) => {
        let settled = false
        const cleanup: Array<() => void> = []

        const finish = (approved: boolean | string) => {
          if (settled) return
          settled = true
          cleanup.forEach((fn) => fn())
          if (approved === false) {
            resolve({
              content: `用户拒绝了 ${ctx.name} 调用${ctx.args?.path ? `(path=${ctx.args.path})` : ''}。请改用只读工具、调整路径或换方案后再试。`,
              status: 'error' as const,
            })
          } else {
            // true 或 string(选方案)→ 视为允许,执行工具
            next(ctx).then(resolve, (e: any) =>
              resolve({ content: `工具执行失败:${e?.message ?? e}`, status: 'error' as const }),
            )
          }
        }

        // abort 联动:进入时已 abort → 立即拒绝;否则监听 abort(用户停止生成 → 自动拒绝,防永久挂起)
        if (ctx.signal) {
          if (ctx.signal.aborted) return finish(false)
          const onAbort = () => finish(false)
          ctx.signal.addEventListener('abort', onAbort, { once: true })
          cleanup.push(() => ctx.signal?.removeEventListener('abort', onAbort))
        }

        // 超时自动拒绝
        if (opts.timeoutMs && opts.timeoutMs > 0) {
          const timer = setTimeout(() => finish(false), opts.timeoutMs)
          cleanup.push(() => clearTimeout(timer))
        }

        // 发确认请求事件:UI 调 resolve(approved) 收口
        ctx.emit?.({
          type: 'approval_request',
          toolName: ctx.name,
          args: ctx.args,
          resolve: finish,
        })
      })
    },
  }
}
