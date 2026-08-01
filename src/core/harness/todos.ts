/**
 * Planning 中间件 —— write_todos 整表替换 + update_todo 增量 + 规划阶段防死循环
 *
 * 对齐 Deep Agents 的 todoListMiddleware(langchainjs),扩展(add-adaptive-planning):
 *  - write_todos 整表替换 todos(非增量 patch,LLM 易用);项无 id 时框架按 index 生成 t-N
 *  - update_todo({id, content?, status?}) 按 id 增量更新单项(执行中动态修订,不必重传整个清单)
 *  - maxPlanRevisions:规划阶段总轮次预算(防"光规划不执行"死循环),与 maxIterations 总闸正交
 *
 * 工具通过闭包维护 todos + 规划阶段状态;beforeModel 每轮同步进 state(供 UI)。
 * createTodosMiddleware(initialTodos, { maxPlanRevisions }) 支持从持久化恢复注入;reset 运行期可重置。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'
import type { Todo, TodoStatus } from './state'

/** 退出规划阶段的主数据写工具(开始执行);eval_script 本期不列入(transform/query 语义混合,见 design §4) */
const PLAN_EXIT_TOOLS = new Set(['write', 'set_data', 'edit_data', 'delete_data'])

/** todos 入参形状(id 可选,框架补全);兼容 write_todos zod 推导类型 / Todo / hydrate 旧数据 */
type TodoInput = { id?: string; content: string; status: TodoStatus }

/** 补全 todos 的 id(无 id 的项按 index 生成 t-N);hydrate 旧数据 / write_todos 入参兼容 */
function ensureIds(list: TodoInput[]): Todo[] {
  return list.map((t, i) => ({ id: t.id || `t-${i + 1}`, content: t.content, status: t.status }))
}

/** 渲染当前 todos 清单为 system prompt 段(带 id 供 LLM 引用 update_todo) */
function renderTodos(todos: Todo[]): string | undefined {
  if (!todos.length) return undefined
  const lines = todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`)
  return [
    '## 当前任务清单(write_todos 整表替换 / update_todo 按 id 增量改单项)',
    lines.join('\n'),
    '规则:开始前用 write_todos 拆解;首个任务标 in_progress;完成一个立即 update_todo({id, status:"completed"}) 标完成(不必重传整个清单);保持至少一个 in_progress 直到全部完成。',
  ].join('\n')
}

export interface TodosMiddlewareOptions {
  /** 规划阶段总轮次预算(默认 5);planning 状态下超限 → write_todos/update_todo 回灌提示(不强制终止,maxIterations 兜底) */
  maxPlanRevisions?: number
}

export function createTodosMiddleware(
  initialTodos: Todo[] = [],
  opts: TodosMiddlewareOptions = {},
): Middleware & {
  reset: (todos: Todo[]) => void
  getPlanPhase: () => { inPlanning: boolean; rounds: number; limit: number }
} {
  let todos: Todo[] = ensureIds(initialTodos)
  let writeTodosThisRound = 0
  // 规划阶段防死循环状态机(与 maxIterations 总闸正交):首次 write_todos 进入,主数据写工具成功退出
  let inPlanning = false
  let planPhaseRounds = 0
  const maxPlanRevisions = opts.maxPlanRevisions ?? 5

  const writeTodosTool = tool(
    async ({ todos: input }) => {
      // 规划阶段预算:首次进入;已进入且超限 → 回灌不执行(防光规划不执行)
      if (!inPlanning) {
        inPlanning = true
        planPhaseRounds = 1
      } else if (planPhaseRounds > maxPlanRevisions) {
        return `规划阶段已达上限(${maxPlanRevisions} 轮)。停止调研/修订,基于当前清单开始执行(用 write/set_data/edit_data 落地)。当前清单:\n${todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`).join('\n') || '(空)'}`
      }
      todos = ensureIds(input)
      return `已更新任务清单:${todos.length} 项\n${todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`).join('\n')}`
    },
    {
      name: 'write_todos',
      description:
        '更新(整表替换)任务清单。用于多步任务的拆解与进度跟踪。每次传入完整的 todos 数组(状态 pending/in_progress/completed),不要增量 patch——增量改单项用 update_todo。',
      schema: z.object({
        todos: z
          .array(
            z.object({
              id: z.string().optional().describe('任务 id(可选;不传框架自动生成 t-1/t-2...)'),
              content: z.string().describe('任务描述'),
              status: z.enum(['pending', 'in_progress', 'completed'] as const satisfies TodoStatus[]),
            }),
          )
          .describe('完整的任务清单(整表替换)'),
      }),
    },
  )

  const updateTodoTool = tool(
    async ({ id, content, status }) => {
      // planning 状态下同样受预算约束(防用 update_todo 绕过)
      if (inPlanning && planPhaseRounds > maxPlanRevisions) {
        return `规划阶段已达上限(${maxPlanRevisions} 轮)。停止修订,基于当前清单开始执行。当前任务 id:${todos.map((t) => t.id).join(', ') || '(空)'}`
      }
      const idx = todos.findIndex((t) => t.id === id)
      if (idx < 0) {
        return `错误:找不到 id="${id}" 的任务(TODO_NOT_FOUND)。当前任务 id:${todos.map((t) => t.id).join(', ') || '(空)'}`
      }
      if (content !== undefined) todos[idx].content = content
      if (status !== undefined) todos[idx].status = status
      return `已更新任务 #${id}:[${todos[idx].status}] ${todos[idx].content}`
    },
    {
      name: 'update_todo',
      description:
        '按 id 增量更新单个任务(改 content/status,不必重传整个清单)。id 见当前任务清单渲染(如 t-1)。执行中动态修订步骤用此工具;与 write_todos 不可同轮调用。',
      schema: z.object({
        id: z.string().describe('目标任务 id(见当前任务清单)'),
        content: z.string().optional().describe('新任务描述(不传则不改)'),
        status: z.enum(['pending', 'in_progress', 'completed'] as const satisfies TodoStatus[]).optional().describe('新状态(不传则不改)'),
      }),
    },
  )

  const mw: Middleware & {
    reset: (todos: Todo[]) => void
    getPlanPhase: () => { inPlanning: boolean; rounds: number; limit: number }
  } = {
    name: 'todos',
    tools: [writeTodosTool, updateTodoTool],
    beforeAgent: () => ({ todos }),
    beforeModel: () => {
      writeTodosThisRound = 0
      if (inPlanning) planPhaseRounds++ // 规划阶段每轮计数(含 read/query/search 调研轮)
      return { todos } // 同步闭包 todos 进 state
    },
    augmentPrompt: () => renderTodos(todos),
    wrapToolCall: async (ctx, next) => {
      // 拒一轮内 write_todos + update_todo 混用(整表替换与增量更新语义冲突);也拒同工具并行多次
      if (ctx.name === 'write_todos' || ctx.name === 'update_todo') {
        writeTodosThisRound++
        if (writeTodosThisRound > 1) {
          return {
            content: '错误:write_todos 与 update_todo 不应在一轮中并行/混用(整表替换与增量更新语义冲突)。请串行使用。',
            status: 'error' as const,
          }
        }
      }
      const result = await next(ctx)
      // 主数据写工具成功 → 退出规划阶段(开始执行了)
      if (PLAN_EXIT_TOOLS.has(ctx.name) && result?.status !== 'error') {
        inPlanning = false
        planPhaseRounds = 0
      }
      return result
    },
    // 运行期重置(持久化恢复 / checkpoint restore 由 createChatSdk 注入 snap.todos)
    reset: (next: Todo[]) => {
      todos = ensureIds(next.map((t) => ({ ...t })))
      inPlanning = false
      planPhaseRounds = 0
    },
    getPlanPhase: () => ({ inPlanning, rounds: planPhaseRounds, limit: maxPlanRevisions }),
  }
  return mw
}
