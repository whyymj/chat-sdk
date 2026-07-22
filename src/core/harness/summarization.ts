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
 */
import type { AgentMessage } from '../types'
import { useContextManager, type ContextManagerOptions } from '../composables/useContextManager'
import type { Middleware } from './middleware'

export function createSummarizationMiddleware(
  opts: Partial<ContextManagerOptions> = {},
): Middleware {
  const ctxManager = useContextManager(opts)

  return {
    name: 'summarization',
    compressInput: async (messages: AgentMessage[]) => {
      const { messages: compressed, stats } = await ctxManager.compress(messages)
      return { messages: compressed, stats }
    },
  }
}
