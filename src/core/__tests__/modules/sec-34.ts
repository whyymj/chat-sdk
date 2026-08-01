/**
 * sec-34:自适应规划(add-adaptive-planning)
 *  - update_todo 增量更新 + id 生成 + TODO_NOT_FOUND
 *  - maxPlanRevisions 规划阶段状态机(进入 / beforeModel 计数 / 超限回灌 / 写工具退出 / 重入)
 *  - hydrate 补 id(reset 旧数据)+ 重置阶段
 *  - 同轮 write_todos + update_todo 混用拒
 */
import { createTodosMiddleware } from '../../harness/todos'
import { createInitialState as createState } from '../../harness/state'
import type { ToolCallContext, ToolExecResult } from '../../harness/middleware'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[sec-34] 自适应规划:update_todo 增量 + maxPlanRevisions 阶段防死循环')

  // === update_todo 增量 + id 生成 ===
  {
    const mw = createTodosMiddleware()
    const tools = byName(mw.tools!)
    const writeT = tools['write_todos']
    const updateT = tools['update_todo']

    // write_todos 项无 id → 框架生成 t-1/t-2
    let r = await invoke(writeT, { todos: [{ content: '步骤A', status: 'pending' }, { content: '步骤B', status: 'pending' }] })
    assert(/t-1/.test(r) && /t-2/.test(r), '✓ update_todo/id:write_todos 项无 id → 框架生成 t-1/t-2(渲染含 id)')

    // update_todo 按 id 改 status
    r = await invoke(updateT, { id: 't-1', status: 'completed' })
    assert(/已更新任务 #t-1/.test(r) && /completed/.test(r), '✓ update_todo 按 id 改 status → 成功(增量,不必重传清单)')

    // update_todo 改 content
    r = await invoke(updateT, { id: 't-2', content: '步骤B改' })
    assert(/已更新任务 #t-2/.test(r) && /步骤B改/.test(r), '✓ update_todo 按 id 改 content → 成功')

    // update_todo 找不到 id → TODO_NOT_FOUND
    r = await invoke(updateT, { id: 't-99', status: 'completed' })
    assert(/TODO_NOT_FOUND|找不到/.test(r), '✓ update_todo 找不到 id → TODO_NOT_FOUND(返回当前 id 列表)')

    // write_todos 显式 id 保留
    r = await invoke(writeT, { todos: [{ id: 'research', content: '调研', status: 'in_progress' }] })
    assert(/#research/.test(r), '✓ write_todos 显式 id(research)→ 保留')
  }

  // === maxPlanRevisions 阶段防死循环 ===
  {
    const mw = createTodosMiddleware([], { maxPlanRevisions: 2 })
    const tools = byName(mw.tools!)
    const writeT = tools['write_todos']
    const updateT = tools['update_todo']
    const st = createState()

    // 首次 write_todos → 进入 planning(rounds=1)
    await invoke(writeT, { todos: [{ content: 'A', status: 'in_progress' }] })
    let pp = mw.getPlanPhase()
    assert(pp.inPlanning === true && pp.rounds === 1 && pp.limit === 2, '✓ maxPlanRevisions:首次 write_todos → 进入 planning(rounds=1, limit=2)')

    // beforeModel 计数(轮2 → rounds=2)
    mw.beforeModel!({ messages: [], state: st })
    pp = mw.getPlanPhase()
    assert(pp.rounds === 2, '✓ maxPlanRevisions:planning 状态 beforeModel → rounds++(2)')

    // beforeModel(轮3 → rounds=3 > limit 2)
    mw.beforeModel!({ messages: [], state: st })
    pp = mw.getPlanPhase()
    assert(pp.rounds === 3, '✓ maxPlanRevisions:beforeModel 再 ++(3 > limit 2)')

    // 超限 → write_todos 回灌(不执行)
    const r = await invoke(writeT, { todos: [{ content: 'B', status: 'pending' }] })
    assert(/规划阶段已达上限|停止调研/.test(r), '✓ maxPlanRevisions:planning 超限 → write_todos 回灌提示(不执行)')

    // 超限 → update_todo 也回灌
    const r2 = await invoke(updateT, { id: 't-1', status: 'completed' })
    assert(/规划阶段已达上限|停止修订/.test(r2), '✓ maxPlanRevisions:planning 超限 → update_todo 也回灌(防绕过)')
  }

  // === 写工具成功退出 planning(经 wrapToolCall);error 不退出 ===
  {
    const mw = createTodosMiddleware([], { maxPlanRevisions: 5 })
    const tools = byName(mw.tools!)
    const st = createState()
    const nextDone = async (): Promise<ToolExecResult> => ({ content: 'written', status: 'done' })
    const nextErr = async (): Promise<ToolExecResult> => ({ content: '校验失败', status: 'error' })

    await invoke(tools['write_todos'], { todos: [{ content: 'A', status: 'in_progress' }] })
    assert(mw.getPlanPhase().inPlanning === true, '✓ 退出测试前置:write_todos 进入 planning')

    // write 成功 → 退出 planning
    await mw.wrapToolCall!({ id: 'c1', name: 'write', args: {}, state: st } as ToolCallContext, nextDone)
    assert(mw.getPlanPhase().inPlanning === false && mw.getPlanPhase().rounds === 0, '✓ 主数据写工具(write)成功 → wrapToolCall 退出 planning(rounds=0)')

    // 重新进入,write error → 不退出
    await invoke(tools['write_todos'], { todos: [{ content: 'B', status: 'in_progress' }] })
    await mw.wrapToolCall!({ id: 'c2', name: 'write', args: {}, state: st } as ToolCallContext, nextErr)
    assert(mw.getPlanPhase().inPlanning === true, '✓ 写工具 error → 不退出 planning(仍 inPlanning)')
  }

  // === 重入:退出后再 write_todos 重新进入(rounds 重置) ===
  {
    const mw = createTodosMiddleware([], { maxPlanRevisions: 3 })
    const tools = byName(mw.tools!)
    const st = createState()
    await invoke(tools['write_todos'], { todos: [{ content: 'A', status: 'in_progress' }] })
    mw.beforeModel!({ messages: [], state: st }) // rounds=2
    await mw.wrapToolCall!({ id: 'c1', name: 'write', args: {}, state: st } as ToolCallContext, async () => ({ content: 'ok', status: 'done' }))
    assert(mw.getPlanPhase().inPlanning === false, '✓ 重入前置:write 退出 planning')
    // 再 write_todos → 重新进入,rounds 重置为 1
    await invoke(tools['write_todos'], { todos: [{ content: 'B', status: 'in_progress' }] })
    const pp = mw.getPlanPhase()
    assert(pp.inPlanning === true && pp.rounds === 1, '✓ 重入:退出后再 write_todos → 重新进入(rounds 重置 1,允许多次规划→执行)')
  }

  // === hydrate 补 id(reset 旧数据)+ 重置阶段 ===
  {
    const mw = createTodosMiddleware([], { maxPlanRevisions: 5 })
    // 模拟 hydrate 旧 todos(无 id)——reset 按 index 补
    mw.reset([{ content: '旧A', status: 'pending' }, { content: '旧B', status: 'completed' }] as any)
    const tools = byName(mw.tools!)
    const r = await invoke(tools['update_todo'], { id: 't-1', status: 'completed' })
    assert(/已更新任务 #t-1/.test(r), '✓ hydrate 旧 todos 无 id → reset 按 index 补 t-1,update_todo 可用(向后兼容)')
    assert(mw.getPlanPhase().inPlanning === false, '✓ reset → 重置规划阶段(inPlanning=false)')
  }

  // === 同轮 write_todos + update_todo 混用 → 第二个被拒 ===
  {
    const mw = createTodosMiddleware()
    const tools = byName(mw.tools!)
    const st = createState()
    mw.beforeModel!({ messages: [], state: st }) // 重置 writeTodosThisRound=0
    // 同轮第一个:write_todos(经 wrapToolCall,next 执行工具)
    await mw.wrapToolCall!({ id: 'c1', name: 'write_todos', args: { todos: [{ content: 'A', status: 'pending' }] }, state: st } as ToolCallContext, async (c: ToolCallContext) => ({ content: await tools['write_todos'].invoke(c.args), status: 'done' }))
    // 同轮第二个:update_todo → writeTodosThisRound>1 → 拒(不调 next)
    const r2 = await mw.wrapToolCall!({ id: 'c2', name: 'update_todo', args: { id: 't-1', status: 'completed' }, state: st } as ToolCallContext, async () => ({ content: 'should not reach', status: 'done' }))
    assert(/不应在一轮中并行\/混用/.test(r2.content) && r2.status === 'error', '✓ 同轮 write_todos + update_todo 混用 → 第二个被拒(error,整表替换与增量语义冲突)')
  }
}
