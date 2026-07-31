/**
 * Memory 中间件 —— AGENTS.md 风格持久指令注入
 *
 * 对齐 Deep Agents 的 memory middleware:一段持久指令(偏好/约定/项目指引/RAG 资料),
 * 作为 system prompt 前段始终注入。
 *
 * 支持三种 source 形态:
 *   - string:静态文本,直接注入
 *   - () => string:同步函数,每次 beforeAgent 求值(适合读运行时变量)
 *   - () => Promise<string>:异步函数,首次 beforeAgent 求值并缓存(适合异步加载 RAG 文档)
 *
 * 缓存策略:函数 source 首次求值后缓存结果,后续 beforeAgent 直接用缓存。
 * reset / setMemory 传入新 source 会清空缓存,下次 beforeAgent 重新求值。
 * refresh() 主动重新求值当前函数 source(用于 RAG 文档更新后强制刷新)。
 */
import type { Middleware } from './middleware'

/** memory 来源:静态文本 或 求值函数(同步/异步) */
export type MemorySource = string | (() => string | Promise<string>)

export function createMemoryMiddleware(
  memory: MemorySource = '',
): Middleware & {
  reset: (memory: MemorySource) => void
  get: () => string
  refresh: () => Promise<string>
} {
  let source: MemorySource = memory
  // 字符串直接缓存;函数延迟到首次 beforeAgent / refresh 求值
  let resolved: string | undefined = typeof memory === 'string' ? memory : undefined

  async function resolve(): Promise<string> {
    if (typeof source === 'string') {
      resolved = source
      return source
    }
    try {
      resolved = await source()
    } catch (e) {
      // 求值失败降级为空串,避免阻塞 agent;debug 时可观察
      console.warn('[page-agent-sdk][memory] 异步求值失败,降级为空:', e)
      resolved = ''
    }
    return resolved
  }

  const mw: Middleware & {
    reset: (memory: MemorySource) => void
    get: () => string
    refresh: () => Promise<string>
  } = {
    name: 'memory',
    beforeAgent: async () => {
      if (resolved === undefined) await resolve()
      return { memory: resolved ?? '' }
    },
    augmentPrompt: (state) => (state.memory ? `## 持久指令(Memory)\n${state.memory}` : undefined),
    // 运行期重置(持久化恢复时由 createChatSdk 注入:options.memory 优先,snap.memory 兜底;setMemory 也用此)
    reset: (m: MemorySource) => {
      source = m
      resolved = typeof m === 'string' ? m : undefined
    },
    // 读取当前已解析 memory(setMemory 后 / inspect 反映最新;函数未求值时返空串)
    get: () => resolved ?? '',
    // 主动重新求值当前函数 source(用于 RAG 文档更新后强制刷新);字符串 source 直接返回
    refresh: async () => {
      if (typeof source === 'function') {
        return resolve()
      }
      return resolved ?? ''
    },
  }
  return mw
}
