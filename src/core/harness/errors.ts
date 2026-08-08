/**
 * 上下文超限错误识别(harden-context-resilience,P3 反应性重试用)
 *
 * langchain 已把 OpenAI(`context_length_exceeded`)/ Anthropic(`prompt is too long`)的 400
 * 包装成 `ContextOverflowError`;这里复用其静态 `isInstance` + 兜底正则(未走 wrap* 的裸 provider 错误、
 * 直连 OpenAI 兼容端点等)。
 *
 * 职责正交:**不进 `isRetryable`**(超限重试同样输入无意义,瞬时重试只会再次超限);
 * 专供 `coreModelCall` 迭代 catch 识别后做「压缩 → 单次重试」(P3)。
 */
import { ContextOverflowError } from '@langchain/core/errors'

/**
 * 判定错误是否为「上下文超限」(模型输入 token 超过 contextWindow)。
 * 识别链:langchain ContextOverflowError → lc_error_code → error.code → status 400 + message 正则。
 */
export function isContextLengthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  // 优先:langchain 标准包装(OpenAI/Anthropic 经 wrap* 后都变 ContextOverflowError)
  try {
    if (ContextOverflowError.isInstance(err)) return true
  } catch {
    /* 旧版 @langchain/core 无 ContextOverflowError 时降级下面的字段/正则判定 */
  }
  const e = err as { lc_error_code?: string; code?: string; status?: number; message?: string }
  // langchain 包装码(Anthropic wrap 设 lc_error_code='CONTEXT_OVERFLOW')
  if (e.lc_error_code === 'CONTEXT_OVERFLOW') return true
  // OpenAI 原生 error.code
  if (e.code === 'context_length_exceeded') return true
  // 兜底:未走 langchain 包装的裸 provider 错误(直连端点),靠 message 关键词
  if (e.status === 400 && typeof e.message === 'string') {
    return /context_length_exceeded|prompt is too long|maximum context length|exceeds the context window/i.test(e.message)
  }
  return false
}
