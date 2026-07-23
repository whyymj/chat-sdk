/**
 * 并发池 —— 通用并发执行器(createAgent 同轮工具并行 / subagent 多子任务并行 共用)
 *
 * - 按 limit 并发;limit<=1 退化为串行(保持原顺序语义)
 * - 结果按 items 原顺序回填(并发完成顺序无关)
 * - signal 触发时:已启动的任务不取消(无法中途abort单个工具),但不再启动新任务;
 *   未启动的槽位保持 undefined,由调用方处理
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length)
  const lim = Math.max(1, limit)
  // limit<=1:串行(等价原 for 循环;每项前检查 abort)
  if (lim === 1) {
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) break
      results[i] = await fn(items[i], i)
    }
    return results
  }
  // limit>1:并发池(最多 lim 个 worker 抢任务)
  let cursor = 0
  const workers = Array.from({ length: Math.min(lim, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) return // 不再启动新任务(已启动的让它跑完)
      const i = cursor++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
