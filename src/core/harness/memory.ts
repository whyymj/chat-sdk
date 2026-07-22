/**
 * Memory 中间件 —— AGENTS.md 风格持久指令注入
 *
 * 对齐 Deep Agents 的 memory middleware:一段持久指令(偏好/约定/项目指引),
 * 作为 system prompt 前段始终注入。
 */
import type { Middleware } from './middleware'

export function createMemoryMiddleware(memory: string): Middleware {
  return {
    name: 'memory',
    beforeAgent: () => ({ memory }),
    augmentPrompt: (state) => (state.memory ? `## 持久指令(Memory)\n${state.memory}` : undefined),
  }
}
