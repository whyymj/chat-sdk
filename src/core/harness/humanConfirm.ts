/**
 * 人工确认工具 + 中间件 —— LLM 主动征询用户(human-in-the-loop 的"主动"侧)
 *
 * 与 approval 中间件(集成方预声明工具白名单,工具调用前被动确认)互补:
 *  本工具由 LLM 在"不确定 / 多方案 / 高风险不可逆"时**主动调用**,经 wrapToolCall 拦截 →
 *  发 approval_request 事件(带 options)→ 用户在 UI 选方案或允许/拒绝 → resolve 回传选择 → 工具结果回 LLM。
 *
 * 默认提示词由 usageHints 中间件注入(见 createUsageHintsMiddleware 的 humanConfirm 分支)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export const HUMAN_CONFIRM_TOOL_NAME = 'request_human_confirmation'

const schema = z.object({
  question: z
    .string()
    .describe('要征询用户的问题/方案描述。清晰具体:说明当前情况、为什么需要确认、确认什么。'),
  options: z
    .array(z.string())
    .optional()
    .describe('可选方案列表(2-4 个)。用户从中选一个。不传则用户只回答允许/拒绝。'),
  recommendation: z
    .string()
    .optional()
    .describe('你推荐的方案(优先在 options 中选一个)及推荐理由,帮用户快速决策。'),
  context: z
    .string()
    .optional()
    .describe('补充上下文:已做了什么、约束、影响范围等,帮用户判断。'),
})

/**
 * 创建 request_human_confirmation 工具。
 * 工具执行体由 createHumanConfirmMiddleware 拦截,不会走到此 handler;此 handler 仅作兜底(中间件未装载时)。
 */
export function createHumanConfirmTool(): StructuredToolInterface {
  return tool(
    async () => '人工确认中间件未装载,无法征询用户。请直接向用户说明情况并等待回复。',
    {
      name: HUMAN_CONFIRM_TOOL_NAME,
      description: [
        '当遇到以下情况时,主动调用本工具征询用户确认后再继续(不要默默猜测后直接执行高风险动作):',
        '1) 不确定用户意图、需求有歧义;',
        '2) 存在多种可行方案且取舍影响较大;',
        '3) 即将执行高风险或不可逆操作(删除、覆盖、批量改动、对外发布等);',
        '4) 操作超出原始指令范围。',
        '入参:question=问题/方案描述;options=可选方案列表(多方案时给);recommendation=你推荐的方案及理由。',
        '用户选择后,据其回答继续;若用户拒绝,停止当前操作并询问如何调整。',
      ].join(''),
      schema,
    },
  )
}

/** 创建人工确认中间件:拦截 request_human_confirmation,发 approval_request 事件,await 用户选择 */
export function createHumanConfirmMiddleware(): Middleware {
  return {
    name: 'humanConfirm',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      if (ctx.name !== HUMAN_CONFIRM_TOOL_NAME) return next(ctx)

      return new Promise<ToolExecResult>((resolve) => {
        let settled = false
        const cleanup: Array<() => void> = []

        const finish = (choice: boolean | string) => {
          if (settled) return
          settled = true
          cleanup.forEach((fn) => fn())
          if (choice === false) {
            resolve({
              content: '用户拒绝了该方案。请停止当前操作,询问用户希望如何调整,不要擅自执行。',
              status: 'done' as const,
            })
          } else if (choice === true) {
            const rec = ctx.args?.recommendation ? `(${ctx.args.recommendation})` : ''
            resolve({ content: `用户同意了方案${rec}。请继续执行。`, status: 'done' as const })
          } else {
            resolve({ content: `用户选择了:${choice}。请据此方案继续。`, status: 'done' as const })
          }
        }

        // abort 联动:进入时已 abort 或用户停止生成 → 视为拒绝(防永久挂起)
        if (ctx.signal) {
          if (ctx.signal.aborted) return finish(false)
          const onAbort = () => finish(false)
          ctx.signal.addEventListener('abort', onAbort, { once: true })
          cleanup.push(() => ctx.signal?.removeEventListener('abort', onAbort))
        }

        ctx.emit?.({ type: 'approval_request', toolName: ctx.name, args: ctx.args, resolve: finish })
      })
    },
  }
}
