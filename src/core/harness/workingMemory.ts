/**
 * WorkingMemory 中间件 —— 跨压缩工作记忆(revive-cross-round-working-memory Phase 1)
 *
 * 解锁痛点:几百 K 频繁压缩 → read/query 定位的 path + read 的 hash 随 older 轮次被压缩/截断,
 * 后续轮 LLM 丢失定位(重复检索浪费 token)+ 凭记忆写导致乐观锁误冲突。
 *
 * Phase 1 最小版(解绑 C 组,独立中间件;只 pin 关键态):
 *  - 自动捕获(wrapToolCall,after next):read/query/search 结果 → locatedPaths;read 的 hash → lastHashes
 *  - augmentPrompt 每轮注入「## 工作记忆」段(最近定位 path + hash)
 *  - LRU ≤10 去重(控 context,<1KB)
 *
 * **压缩豁免(天然)**:workingMemory 经 augmentPrompt 每轮重建到 system(不在 AgentMessage[]),
 * compressInput 压的是 messages → workingMemory 不随 older 丢 —— **无需改 summarization**(同 mission)。
 * 与 preserveLastToolResults 互补:preserve 保工具结果摘要(防字段描述丢),workingMemory 保 path/hash 结构化(防定位丢)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

const MAX_ENTRIES = 10
/** read/query/search 之外的工具不捕获(只 pin 定位类) */
const CAPTURE_TOOLS = new Set(['read', 'query_data', 'search_data'])

export function createWorkingMemoryMiddleware(): Middleware & {
  getWorkingMemory: () => import('./state').WorkingMemory | undefined
  /** 重置为初始态(切会话/清空聊天):清 locatedPaths + lastHashes,防旧会话 path/hash 污染新会话(P1-5) */
  reset: () => void
} {
  // 闭包真相源(跨轮持久);state.workingMemory 是其投影(每轮 beforeModel 刷,供 augmentPrompt + inspect)
  const locatedPaths: string[] = []
  const lastHashes: Record<string, string> = {}

  const isEmpty = () => locatedPaths.length === 0 && Object.keys(lastHashes).length === 0
  const snapshot = (): import('./state').WorkingMemory => ({
    locatedPaths: [...locatedPaths],
    lastHashes: { ...lastHashes },
  })

  /** path 入 locatedPaths(LRU 去重,超 MAX 淘汰最旧) */
  function capturePath(p: string): void {
    if (!p) return
    const i = locatedPaths.indexOf(p)
    if (i >= 0) locatedPaths.splice(i, 1)
    locatedPaths.unshift(p)
    while (locatedPaths.length > MAX_ENTRIES) locatedPaths.pop()
  }
  /** path→hash 入 lastHashes(LRU,超 MAX 淘汰最旧) */
  function captureHash(path: string, hash: string): void {
    if (lastHashes[path] === hash) return
    delete lastHashes[path]
    lastHashes[path] = hash
    const keys = Object.keys(lastHashes)
    while (keys.length > MAX_ENTRIES) {
      const stale = keys.shift() as string
      delete lastHashes[stale]
    }
  }

  const mw: Middleware & {
    getWorkingMemory: () => import('./state').WorkingMemory | undefined
    reset: () => void
  } = {
    name: 'workingMemory',
    beforeAgent: () => (isEmpty() ? undefined : { workingMemory: snapshot() }),
    // 每轮模型调用前投影闭包到 state.workingMemory(wrapToolCall 捕获后,下轮 beforeModel 刷;供 augmentPrompt 读最新)
    beforeModel: () => (isEmpty() ? undefined : { workingMemory: snapshot() }),
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      const result = await next(ctx)
      if (result.status === 'done' && CAPTURE_TOOLS.has(ctx.name)) {
        const content = typeof result.content === 'string' ? result.content : ''
        if (ctx.name === 'read') {
          // read:jsonPath 参数为 path(无则 root);结果含 hash=xxx(乐观锁用)
          const jp = (ctx.args?.jsonPath as string) || ''
          const path = jp || '(root)'
          capturePath(path)
          const hashMatch = content.match(/hash=([0-9a-f]{6,})/i)
          if (hashMatch) captureHash(path, hashMatch[1])
        } else {
          // query/search:args.jsonPath + 结果中 @ xxx 命中路径(多条)
          const jp = (ctx.args?.jsonPath as string) || ''
          if (jp) capturePath(jp)
          const hits = content.match(/@\s([a-zA-Z0-9_.[\]]+)/g)
          if (hits) hits.forEach((m) => capturePath(m.replace(/^@\s/, '')))
        }
      }
      return result
    },
    augmentPrompt: (state) => {
      const w = state.workingMemory
      if (!w || (w.locatedPaths.length === 0 && Object.keys(w.lastHashes).length === 0)) return undefined
      const lines = ['## 工作记忆(跨压缩保留,勿重复检索)']
      if (w.locatedPaths.length) lines.push('最近定位:' + w.locatedPaths.join(', '))
      if (Object.keys(w.lastHashes).length) {
        lines.push('最近 hash:' + Object.entries(w.lastHashes).map(([p, h]) => `${p}=${h.slice(0, 8)}`).join(', '))
      }
      return lines.join('\n')
    },
    getWorkingMemory: () => (isEmpty() ? undefined : snapshot()),
    /** 重置为初始态(切会话/清空聊天):清空闭包 locatedPaths + lastHashes,防旧会话定位/hash 污染新会话 */
    reset: () => {
      locatedPaths.length = 0
      for (const k of Object.keys(lastHashes)) delete lastHashes[k]
    },
  }
  return mw
}
