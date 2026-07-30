/**
 * Memory 中间件 —— AGENTS.md 风格持久指令注入
 *
 * 对齐 Deep Agents 的 memory middleware:一段持久指令(偏好/约定/项目指引),
 * 作为 system prompt 前段始终注入。
 * reset 支持运行期重置(持久化恢复时由 createChatSdk 注入)。
 */
import type { Middleware } from './middleware'

export function createMemoryMiddleware(
  memory = '',
): Middleware & { reset: (memory: string) => void; get: () => string } {
  let mem = memory
  const mw: Middleware & { reset: (memory: string) => void; get: () => string } = {
    name: 'memory',
    beforeAgent: () => ({ memory: mem }),
    augmentPrompt: (state) => (state.memory ? `## 持久指令(Memory)\n${state.memory}` : undefined),
    // 运行期重置(持久化恢复时由 createChatSdk 注入:options.memory 优先,snap.memory 兜底;setMemory 也用此)
    reset: (m: string) => {
      mem = m
    },
    // 读取当前 memory(setMemory 后 / inspect 反映最新)
    get: () => mem,
  }
  return mw
}
