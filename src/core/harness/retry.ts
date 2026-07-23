/**
 * LLM 调用重试 + abort 判定(纯函数,可单测)
 *
 * 错误识别基于 openai SDK 经 @langchain/openai 的 wrapOpenAIClientError 包装后的事实
 * (包装后 abort/timeout 是普通 Error,不再 instanceof 原类,靠 .name/.status/.lc_error_code 判定):
 *  - 用户 abort / 模型被 signal 中止 → 普通 Error,name === 'AbortError'(status undefined)
 *  - 超时 → 普通 Error,name === 'TimeoutError'(status undefined)
 *  - 429 → err.status === 429 或 lc_error_code === 'MODEL_RATE_LIMIT'
 *  - 5xx → err.status >= 500
 *  - 网络错误 → err.status === undefined 且非 abort/timeout
 *
 * 关键:AbortError 的 status 也是 undefined,判定可重试前必须先排除 abort,
 * 否则用户停止会被误判为网络错误而无限重试。
 */

/** 判定是否为 abort(用户主动停止)。signal.aborted 兜底覆盖 ModelAbortError 等场景 */
export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError'
}

/** 判定错误是否可重试(网络 / 超时 / 429 / 5xx)。abort 与 4xx(除 429)不重试 */
export function isRetryable(err: unknown, signal?: AbortSignal): boolean {
  if (isAbort(err, signal)) return false
  const e = err as { name?: string; status?: number; lc_error_code?: string } | null
  if (!e) return false
  // 网络错误 / 超时:无 HTTP status
  if (e.name === 'TimeoutError' || e.status === undefined) return true
  // 429 限流(openai 直接 status 或 langchain 包装码)
  if (e.status === 429 || e.lc_error_code === 'MODEL_RATE_LIMIT') return true
  // 5xx 服务端错误
  if (e.status >= 500) return true
  // 其他 4xx(400/401/403/404/422):参数/权限/未找到,重试无意义
  return false
}

/** 构造标准 AbortError(供 delay 打断使用) */
function makeAbortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

/** sleep;可被 signal 提前打断(abort 时 reject AbortError,不再继续退避等待) */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(makeAbortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface RetryOptions {
  signal?: AbortSignal
  /** 最大重试次数(默认 2,即最多 3 次尝试) */
  maxRetries?: number
  /** 退避基数 ms(默认 500),第 n 次重试等待 = base * 2^n + jitter */
  baseDelayMs?: number
  /** 每次重试前回调(记日志) */
  onRetry?: (info: { attempt: number; error: unknown; waitMs: number }) => void
}

/**
 * 带重试执行 fn:失败时按 isRetryable 决定是否重试,指数退避 + jitter。
 * abort(用户停止 / signal 触发)立即抛 AbortError,不重试。
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2
  const base = opts.baseDelayMs ?? 500
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (isAbort(err, opts.signal)) throw err
      if (attempt >= maxRetries || !isRetryable(err, opts.signal)) throw err
      // 指数退避 + jitter(避免同源请求并发重试踩同一节拍)
      const waitMs = base * 2 ** attempt + Math.floor(Math.random() * base * 0.5)
      opts.onRetry?.({ attempt: attempt + 1, error: err, waitMs })
      await delay(waitMs, opts.signal)
      attempt++
    }
  }
}
