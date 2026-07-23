/**
 * Planning 中间件 —— write_todos 整表替换 + 自跟踪
 *
 * 对齐 Deep Agents 的 todoListMiddleware(langchainjs):
 *  - write_todos 工具整表替换 todos(非增量 patch,LLM 易用)
 *  - augmentPrompt 每轮注入当前 todos 清单 + 自跟踪规则
 *  - wrapToolCall 拒绝一轮内并行的多个 write_todos(整表替换语义冲突)
 *
 * 工具通过闭包维护 todos;beforeModel 每轮同步进 state(供 UI)。
 * createTodosMiddleware(initialTodos) 支持从持久化恢复注入;reset 运行期可重置。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'
import type { Todo, TodoStatus } from './state'

/** 渲染当前 todos 清单为 system prompt 段 */
function renderTodos(todos: Todo[]): string | undefined {
  if (!todos.length) return undefined
  const lines = todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)
  return [
    '## 当前任务清单(用 write_todos 工具管理)',
    lines.join('\n'),
    '规则:开始前用 write_todos 拆解;首个任务标 in_progress;完成一个立即标 completed(不批量);保持至少一个 in_progress 直到全部完成。',
  ].join('\n')
}

export function createTodosMiddleware(
  initialTodos: Todo[] = [],
): Middleware & { reset: (todos: Todo[]) => void } {
  let todos: Todo[] = initialTodos.map((t) => ({ ...t }))
  let writeTodosThisRound = 0

  const writeTodosTool = tool(
    async ({ todos: input }) => {
      todos = input
      return `已更新任务清单:${input.length} 项\n${input.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join('\n')}`
    },
    {
      name: 'write_todos',
      description:
        '更新(整表替换)任务清单。用于多步任务的拆解与进度跟踪。每次传入完整的 todos 数组(状态 pending/in_progress/completed),不要增量 patch。',
      schema: z.object({
        todos: z
          .array(
            z.object({
              content: z.string().describe('任务描述'),
              status: z.enum(['pending', 'in_progress', 'completed'] as const satisfies TodoStatus[]),
            }),
          )
          .describe('完整的任务清单(整表替换)'),
      }),
    },
  )

  const mw: Middleware & { reset: (todos: Todo[]) => void } = {
    name: 'todos',
    tools: [writeTodosTool],
    beforeAgent: () => ({ todos }),
    beforeModel: () => {
      writeTodosThisRound = 0
      return { todos } // 同步闭包 todos 进 state
    },
    augmentPrompt: () => renderTodos(todos),
    wrapToolCall: async (ctx, next) => {
      if (ctx.name === 'write_todos') {
        writeTodosThisRound++
        if (writeTodosThisRound > 1) {
          return {
            content: '错误:write_todos 不应在一轮中并行多次调用(整表替换语义)。请串行使用。',
            status: 'error' as const,
          }
        }
      }
      return next(ctx)
    },
    // 运行期重置(持久化恢复时由 createPageAgent 注入 snap.todos)
    reset: (next: Todo[]) => {
      todos = next.map((t) => ({ ...t }))
    },
  }
  return mw
}
