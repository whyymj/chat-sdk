/**
 * 上下文检查中间件(context-inspector)—— 每轮 wrapModelCall 快照「实际发给 LLM 的消息」构成。
 *
 * 采集点 wrapModelCall(非 beforeModel):beforeModel 在 replaceSystem / trimContextIfNeeded 之前,
 * 拿不到最终消息;wrapModelCall 的 req.messages 是 replaceSystem + trim 后的最终消息(createAgent modelHandler 入参)。
 *
 * 快照经闭包持有(每轮覆盖,不累积),inspectContext() / inspect().context 从 getSnapshot() 读。
 * 不进 HarnessState:wrapModelCall 无 state update 机制(返回 ModelResponse,非 StateUpdate),
 * 且 snapshot 仅供 inspect 展示、无需跨中间件共享 —— 闭包更简洁。
 * 压缩统计由 createChatSdk 在 inspect 时从 state.lastCompression 注入(复用现有留存,非新增写入路径)。
 */
import type { Middleware, ModelRequest, ModelResponse } from './middleware'
import { analyzeContext, type ContextSnapshot } from '../utils/contextAnalysis'

export interface ContextInspectorOptions {
  /** 模型上下文窗口(modelCaps;occupancy = totalTokens / contextWindow) */
  contextWindow?: number
  /** 压缩触发阈值占比(进度条色阶:绿 < 阈值 < 黄 < 1 < 红) */
  thresholdRatio?: number
}

export interface ContextInspectorMiddleware extends Middleware {
  /** 读最近一次 wrapModelCall 快照(供 inspectContext / inspect().context) */
  getSnapshot(): ContextSnapshot | undefined
}

/**
 * 创建上下文检查中间件。capabilities.contextInspector(默认开)控制装载;关 → 不装、inspectContext 返 undefined。
 * wrapModelCall 每轮覆盖快照(对最终消息 analyzeContext),零 LLM 成本(纯 estimateTokens 计算)。
 */
export function createContextInspectorMiddleware(opts: ContextInspectorOptions = {}): ContextInspectorMiddleware {
  let snapshot: ContextSnapshot | undefined
  return {
    name: 'context-inspector',
    async wrapModelCall(req: ModelRequest, next: (req: ModelRequest) => Promise<ModelResponse>): Promise<ModelResponse> {
      snapshot = analyzeContext(req.messages, opts)
      return next(req)
    },
    getSnapshot: () => snapshot,
  }
}
