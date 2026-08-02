/**
 * 资源预算中间件(automation-layer Phase 4)。
 *
 * 调研确认:usage 只累计不强制(createChatSdk.ts afterModel 累加 token,无任何超限停止逻辑)。
 * 本中间件在 wrapModelCall(每轮 model 调用前)检查 token/time 预算,超限 → 返回 aborted response
 * (createAgent 检查 response.aborted → 停止 agent,不调 model)+ emit BUDGET_EXCEEDED。
 *
 * 挂载:capabilities.automation 开时,createChatSdk 装载本中间件。
 * 设计:不改 createAgent while 循环 / HarnessState(纯中间件,aborted response 复用现有 abort 语义)。
 */
import { AIMessage } from '@langchain/core/messages'
import type { Middleware } from './middleware'
import type { ModelResponse } from './middleware'
import type { TokenUsage } from '../types'

export interface BudgetOptions {
  /** token 预算上限(累计 total_tokens 超过 → 停止) */
  tokenBudget?: number
  /** 时间预算(ms,从 beforeAgent 开始计时,超过 → 停止) */
  timeBudgetMs?: number
}

/**
 * @param usage 累计 token(sdk-events afterModel 累加的核心.usage 引用,中间件读取最新)
 * @param opts 预算配置
 * @param emit 事件广播(createChatSdk 的 emit,超限时 emit BUDGET_EXCEEDED)
 */
export function createBudgetMiddleware(
  usage: TokenUsage,
  opts: BudgetOptions,
  emit: (e: any) => void,
): Middleware {
  let startTime = 0
  return {
    name: 'budget',
    beforeAgent: () => {
      startTime = Date.now()
    },
    wrapModelCall: async (req, next): Promise<ModelResponse> => {
      const { tokenBudget, timeBudgetMs } = opts
      const tokenExceeded = tokenBudget != null && (usage.total_tokens ?? 0) > tokenBudget
      const timeExceeded = timeBudgetMs != null && Date.now() - startTime > timeBudgetMs
      if (tokenExceeded || timeExceeded) {
        const reason = tokenExceeded
          ? `token 超限(累计 ${usage.total_tokens ?? 0} > 上限 ${tokenBudget})`
          : `时间超限(${Date.now() - startTime}ms > 上限 ${timeBudgetMs}ms)`
        emit({
          type: 'error',
          severity: 'observable',
          code: 'BUDGET_EXCEEDED',
          message: `资源预算超限:${reason},agent 已停止(未完成部分可用 restoreLastCheckpoint 回退)。`,
        })
        return {
          message: new AIMessage({ content: '' }),
          content: '',
          toolCalls: [],
          aborted: true,
        }
      }
      return next(req)
    },
  }
}
