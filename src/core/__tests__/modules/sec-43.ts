/**
 * sec-43:structured-todos-tier(Phase 2 层级依赖)
 * - write_todos 层级输入(parentId/deps/criteria/evidence)+ ensureIds 透传(不丢字段)
 * - renderTodos 递归(有 parentId 缩进 + deps ✓/⏳ 阻塞标注 + evidence)/ 扁平 fallback(无 parentId)
 * - update_todo 改 deps/parentId/criteria/evidence(增量)
 */
import { z } from 'zod'
import { createTodosMiddleware, renderTodos } from '../../harness/todos'
import { runBeforeAgent, runBeforeModel } from '../../harness/middleware'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  console.log('\n[todos-tier · 层级依赖]')
  const mw = createTodosMiddleware([])
  const tools = mw.tools!
  const byName = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, any>

  // ===== write_todos 层级输入(parentId/deps/criteria/evidence)+ ensureIds 透传 =====
  {
    const r = await invoke(byName['write_todos'], {
      todos: [
        { id: 't-a', content: '父任务', status: 'in_progress' },
        { content: '子任务1(依赖 t-a)', status: 'pending', parentId: 't-a', deps: ['t-a'], criteria: '父完成' },
        { content: '子任务2', status: 'pending', parentId: 't-a', evidence: '已有初步结果' },
      ],
    })
    // ensureIds 给无 id 的生成(t-b/t-c);parentId/deps 透传
    assert(r.includes('#t-a'), '✓ write_todos 层级输入 → ensureIds 给无 id 的生成')
    assert(r.includes('子任务1'), '✓ write_todos → 子任务透传(不丢)')

    // augmentPrompt 递归渲染(层级缩进 + deps ✓/⏳ + evidence)
    const state = runBeforeAgent([mw], { todos: [] } as any)
    runBeforeModel([mw], { messages: [], state } as any)
    const seg = mw.augmentPrompt?.(state as any) || ''
    assert(seg.includes('- #t-a'), '✓ renderTodos 递归 → 根节点渲染')
    assert(seg.includes('  -'), '✓ renderTodos 递归 → 子节点缩进(  -)')
    assert(seg.includes('⏳'), '✓ renderTodos → deps 阻塞标注(⏳ 未完成)')
    assert(seg.includes('证据'), '✓ renderTodos → evidence 渲染')
    assert(seg.includes('标准'), '✓ renderTodos → criteria 渲染')
  }

  // ===== update_todo 改 deps/parentId/criteria/evidence(增量) =====
  {
    const r = await invoke(byName['update_todo'], { id: 't-a', status: 'completed', evidence: '父任务已完成' })
    assert(r.includes('已更新任务 #t-a'), '✓ update_todo → 改 status + evidence')

    // 再渲染:deps 全 completed → ✓
    const state2 = runBeforeAgent([mw], { todos: [] } as any)
    runBeforeModel([mw], { messages: [], state: state2 } as any)
    const seg2 = mw.augmentPrompt?.(state2 as any) || ''
    assert(seg2.includes('✓'), '✓ renderTodos → deps 完成后标 ✓(t-a completed)')
  }

  // ===== 扁平 fallback(无 parentId → 现状扁平渲染) =====
  {
    const mwFlat = createTodosMiddleware([])
    const toolsF = mwFlat.tools!
    const byNameF = Object.fromEntries(toolsF.map((t) => [t.name, t])) as Record<string, any>
    await invoke(byNameF['write_todos'], {
      todos: [
        { content: '任务1', status: 'completed' },
        { content: '任务2', status: 'in_progress' },
      ],
    })
    const stateF = runBeforeAgent([mwFlat], { todos: [] } as any)
    runBeforeModel([mwFlat], { messages: [], state: stateF } as any)
    const segF = mwFlat.augmentPrompt?.(stateF as any) || ''
    assert(segF.includes('1. #t-1'), '✓ 扁平 fallback → 无 parentId 走扁平渲染(1. #t-1)')
    assert(!segF.includes('  -'), '✓ 扁平 fallback → 无缩进')
  }

  // ===== hydrate 旧数据(无 parentId/deps → undefined,扁平 fallback) =====
  {
    const mwHydrate = createTodosMiddleware([
      { id: 'old-1', content: '旧任务', status: 'pending' }, // 无 parentId/deps
    ])
    const stateH = runBeforeAgent([mwHydrate], { todos: [] } as any)
    runBeforeModel([mwHydrate], { messages: [], state: stateH } as any)
    const segH = mwHydrate.augmentPrompt?.(stateH as any) || ''
    assert(segH.includes('#old-1'), '✓ hydrate 旧数据(无层级字段)→ 扁平渲染(向后兼容)')
  }

  // ===== renderTodos 成环/异常 parentId 不栈溢出(seen 防护 + 单值 parentId 天然树结构) =====
  {
    // 自指 a→a:a 有 parentId 不在 roots → 不渲染但安全返回 string(无 RangeError)
    let seg = renderTodos([{ id: 'a', content: '自指', status: 'pending', parentId: 'a' }] as any)
    assert(typeof seg === 'string', '✓ renderTodos 自指 parentId(a→a)安全返回 string(不栈溢出)')
    // 互指 a↔b:都不在 roots → 空段,不溢出
    seg = renderTodos([
      { id: 'a', content: 'A', status: 'pending', parentId: 'b' },
      { id: 'b', content: 'B', status: 'pending', parentId: 'a' },
    ] as any)
    assert(typeof seg === 'string', '✓ renderTodos 互指 parentId(a↔b)安全返回(不栈溢出)')
    // 正常 3 层链(根 → 子1 → 子2)
    seg = renderTodos([
      { id: 'r', content: '根', status: 'in_progress' },
      { id: 'c1', content: '子1', status: 'pending', parentId: 'r' },
      { id: 'c2', content: '子2', status: 'pending', parentId: 'c1' },
    ] as any) || ''
    assert(seg.includes('#r') && seg.includes('#c1') && seg.includes('#c2'), '✓ renderTodos 正常 3 层链渲染(根→子1→子2)')
  }
}
