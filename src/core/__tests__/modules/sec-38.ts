/**
 * sec-38:跨压缩工作记忆(revive-cross-round-working-memory Phase 1)
 * - read 捕获 path(无 jsonPath→root)+ hash;query/search 捕获 path(结果 @ xxx);其他工具不捕获
 * - LRU ≤10 去重(重复 path 提前,超 10 淘汰最旧);augmentPrompt 注入段 / 空 undefined;getWorkingMemory 快照
 */
import { createWorkingMemoryMiddleware } from '../../harness/workingMemory'
import type { ToolCallContext, ToolExecResult } from '../../harness/middleware'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  const mw = createWorkingMemoryMiddleware()

  /** 模拟工具调用:走 wrapToolCall,next 返回固定 content */
  const call = async (name: string, args: Record<string, unknown>, content: string): Promise<ToolExecResult> => {
    const ctxT = { id: '1', name, args, state: { messages: [] } } as unknown as ToolCallContext
    return (mw.wrapToolCall as (c: ToolCallContext, n: (c: ToolCallContext) => Promise<ToolExecResult>) => Promise<ToolExecResult>)(
      ctxT,
      async () => ({ content, status: 'done' as const }),
    )
  }

  // ✓ read 无 jsonPath → locatedPaths 含 (root) + hash 捕获
  await call('read', {}, '主数据 = {...} (hash=abc123def456)')
  let wm = mw.getWorkingMemory()!
  assert(wm.locatedPaths.includes('(root)'), '✓ read(无 jsonPath)→ locatedPaths 含 (root)')
  assert(wm.lastHashes['(root)'] === 'abc123def456', '✓ read hash= → lastHashes[(root)]')

  // ✓ read 带 jsonPath → locatedPaths + lastHashes[path]
  await call('read', { jsonPath: 'components.0.props' }, '主数据 @ components.0.props = {...} (hash=fff000)')
  wm = mw.getWorkingMemory()!
  assert(wm.locatedPaths.includes('components.0.props'), '✓ read(jsonPath)→ locatedPaths 含 path')
  assert(wm.lastHashes['components.0.props'] === 'fff000', '✓ read jsonPath 的 hash → lastHashes[path]')

  // ✓ query/search 捕获:args.jsonPath + 结果中 @ xxx 命中多条
  await call('query_data', { jsonPath: 'components' }, '命中 2 条:\n组件 @ components.0\n组件 @ components.5')
  wm = mw.getWorkingMemory()!
  assert(wm.locatedPaths.includes('components'), '✓ query_data jsonPath → locatedPaths')
  assert(wm.locatedPaths.includes('components.0') && wm.locatedPaths.includes('components.5'), '✓ query 结果 @ xxx → locatedPaths(多条)')

  // ✓ 其他工具(write)不捕获(即使结果含 hash=)
  const beforeKeys = Object.keys(mw.getWorkingMemory()!.lastHashes)
  await call('write', { value: 1 }, '已设置 (新 hash=shouldNotCapture)')
  const afterKeys = Object.keys(mw.getWorkingMemory()!.lastHashes)
  assert(afterKeys.length === beforeKeys.length && !afterKeys.includes('shouldNotCapture'), '✓ write 不捕获(非 read/query/search)')

  // ✓ LRU ≤10 + 去重:连续读 12 个不同 path,只留最近 10
  for (let i = 0; i < 12; i++) {
    await call('read', { jsonPath: `p${i}` }, `主数据 @ p${i} = x (hash=h${i})`)
  }
  wm = mw.getWorkingMemory()!
  assert(wm.locatedPaths.length <= 10, '✓ LRU ≤10(12 个 path 只留 10)')
  assert(wm.locatedPaths.includes('p11') && !wm.locatedPaths.includes('p0'), '✓ LRU 淘汰最旧(p0 出,p11 留)')
  assert(Object.keys(wm.lastHashes).length <= 10, '✓ lastHashes LRU ≤10')

  // ✓ augmentPrompt:有 workingMemory(state.workingMemory 投影)→ 注入段
  const aug = mw.augmentPrompt?.({ workingMemory: mw.getWorkingMemory() } as any)
  assert(!!aug && aug.includes('工作记忆'), '✓ augmentPrompt → 含「工作记忆」段')
  assert(aug!.includes('p11'), '✓ augmentPrompt 含最近定位 path(p11)')

  // ✓ augmentPrompt:空 workingMemory → undefined(不注入空段)
  const emptyMw = createWorkingMemoryMiddleware()
  assert(emptyMw.augmentPrompt?.({} as any) === undefined, '✓ augmentPrompt 空 workingMemory → undefined')
  assert(emptyMw.getWorkingMemory() === undefined, '✓ getWorkingMemory 空 → undefined')

  // ✓ P1-5:reset() 清空 locatedPaths + lastHashes(切会话/清空聊天防旧 path/hash 污染新会话)
  {
    const mwr = createWorkingMemoryMiddleware()
    const callR = async (name: string, args: Record<string, unknown>, content: string): Promise<ToolExecResult> => {
      const ctxT = { id: '1', name, args, state: { messages: [] } } as unknown as ToolCallContext
      return (mwr.wrapToolCall as (c: ToolCallContext, n: (c: ToolCallContext) => Promise<ToolExecResult>) => Promise<ToolExecResult>)(
        ctxT,
        async () => ({ content, status: 'done' as const }),
      )
    }
    await callR('read', { jsonPath: 'a.b' }, '值 (hash=deadbeef)')
    assert(mwr.getWorkingMemory()!.locatedPaths.includes('a.b'), '✓ reset 前置:read 捕获 path a.b + hash')
    mwr.reset()
    assert(mwr.getWorkingMemory() === undefined, '✓ reset() → 清空 locatedPaths + lastHashes(getWorkingMemory undefined)')
    // reset 后重新捕获无残留(只含新 path,旧 path 不在)
    await callR('read', { jsonPath: 'c.d' }, '值 (hash=cafef00d)')
    const wm2 = mwr.getWorkingMemory()!
    assert(wm2.locatedPaths.includes('c.d') && !wm2.locatedPaths.includes('a.b'), '✓ reset() 后重新捕获无残留(只含新 path c.d)')
    assert(wm2.lastHashes['c.d'] === 'cafef00d' && !('a.b' in wm2.lastHashes), '✓ reset() 后 lastHashes 无残留(只含新 hash)')
  }
}
