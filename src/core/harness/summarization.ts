/**
 * Summarization 中间件 —— 复用 useContextManager 做跨轮历史压缩
 *
 * 对齐 Deep Agents 的 summarization middleware:
 *  - 触发:默认按轮数阈值(索引摘要,零 LLM 成本);可选 enableLLMSummary 用 LLM 段落摘要
 *  - 通过 compressInput 钩子接入 createAgent(构建上下文前压缩 AgentMessage[])
 *  - 配合关键词召回,保留与当前问题相关的早期对话
 *
 * 注:单轮 ReAct 内的工具结果裁剪(trimToolResults)仍由 createAgent 侧处理,
 * 这里聚焦跨轮历史压缩。
 *
 * controller(harden-context-resilience):setContextWindow 供 createChatSdk setLlm 后集中回灌新窗口,
 * compress 读 ctxManager.config 共享引用,下轮即按新阈值触发(无需重建中间件)。
 */
import type { AgentMessage } from '../types'
import { useContextManager, type ContextManagerOptions } from '../composables/useContextManager'
import type { Middleware } from './middleware'

/** summarization 中间件 + controller(setLlm 后回灌 contextWindow) */
export type SummarizationMiddleware = Middleware & {
  /** 更新 contextWindow(下轮 compress 即用新阈值);config 共享引用,compress 读取即生效 */
  setContextWindow(cw: number): void
}

export function createSummarizationMiddleware(
  opts: Partial<ContextManagerOptions> = {},
): SummarizationMiddleware {
  const ctxManager = useContextManager(opts)

  const middleware: Middleware = {
    name: 'summarization',
    compressInput: async (messages: AgentMessage[]) => {
      const { messages: compressed, stats } = await ctxManager.compress(messages)
      return { messages: compressed, stats }
    },
  }

  // controller:setLlm 后由 createChatSdk 集中回灌新 contextWindow(compress 读 config 共享引用即生效)
  return Object.assign(middleware, {
    setContextWindow(cw: number) {
      ctxManager.config.contextWindow = cw
    },
  })
}
