import type { TestCtx } from './_ctx'
import { tokenize, estimateMessageTokens, recallRounds, indexSummarize } from '../../composables/contextIndex'
import { createConflictManager } from '../../sdk/conflictManager'

/**
 * sec-32 —— contextIndex 纯函数 + conflictManager 工厂白盒单测(refactor-module-extraction 期二)。
 * contextIndex:分词/估算/召回/摘要(此前经 useContextManager.compress 间接黑盒测);
 * conflictManager:set/resolve 状态机 + 并发覆盖兜底 + conflict 事件外发。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-32] contextIndex + conflictManager 工厂白盒单测')

  // === contextIndex ===
  // tokenize:小写化 + 去停用词 + 短 token 过滤
  const tk = tokenize('Hello the World 你好 的')
  assert(tk.includes('hello') && tk.includes('world') && tk.includes('你好'), 'tokenize → 小写化 + 保留中英文 token')
  assert(!tk.includes('the') && !tk.includes('的'), 'tokenize → 去停用词(the/的)')
  assert(tokenize('a').length === 0, 'tokenize → 长度 <2 的 token 过滤')

  // estimateMessageTokens:合理估算(字符数/4 量级,< 原字符数)
  const est = estimateMessageTokens({ role: 'user', content: 'a'.repeat(100) } as any)
  assert(est > 0 && est < 100, 'estimateMessageTokens → 合理估算(0 < est < 字符数)')
  // 含 steps 的消息:args/result 计入
  const estSteps = estimateMessageTokens({ role: 'assistant', content: 'x', steps: [{ name: 'read', result: 'y'.repeat(40) }] } as any)
  assert(estSteps > est || estSteps > 0, 'estimateMessageTokens → steps.result 计入估算')

  // recallRounds:关键词召回 top K
  const rounds = [
    { round: 1, startIdx: 0, userMsg: { role: 'user', content: '关于天气的讨论' }, assistantMsgs: [{ role: 'assistant', content: '今天晴天' }] },
    { round: 2, startIdx: 2, userMsg: { role: 'user', content: '关于价格的提问' }, assistantMsgs: [{ role: 'assistant', content: '价格 100 元' }] },
    { round: 3, startIdx: 4, userMsg: { role: 'user', content: '天气预测明天' }, assistantMsgs: [{ role: 'assistant', content: '明天下雨' }] },
  ] as any[]
  const recalled = recallRounds(rounds, '天气', 2)
  assert(recalled.length === 2, 'recallRounds → 命中关键词的轮次(top K)')
  assert(recalled.every((r) => r.round === 1 || r.round === 3), 'recallRounds → 只召回含关键词的轮次(排除轮 2)')
  assert(recallRounds(rounds, '完全不存在的词xyz', 2).length === 0, 'recallRounds → 无匹配返空')

  // indexSummarize:生成每轮摘要文本
  const sum = indexSummarize(rounds)
  assert(sum.includes('第1轮') && sum.includes('第2轮') && sum.includes('第3轮'), 'indexSummarize → 含每轮标记')

  // === createConflictManager 工厂 ===
  // 初始状态
  const mgr = createConflictManager()
  assert(mgr.pendingConflict.value === null, 'createConflictManager → 初始无冲突(null)')
  assert(typeof mgr.set === 'function' && typeof mgr.resolve === 'function', 'createConflictManager → 暴露 set/resolve 方法')

  // set/resolve 状态机 + conflict 事件外发(经 getEmit)
  let emitted: any = null
  const emitFn = (e: any) => { emitted = e }
  const mgr2 = createConflictManager(() => emitFn)
  const info = { op: 'set' as const, currentValue: { a: 1 }, currentHash: 'h1', expectedHash: 'h0', snapshotId: 0 }
  const p = mgr2.set(info)
  assert(mgr2.pendingConflict.value !== null, 'createConflictManager.set → 挂起 pendingConflict')
  assert(emitted && emitted.type === 'conflict' && emitted.conflict.currentHash === 'h1', 'createConflictManager.set → 经 getEmit 外发 conflict 事件')
  assert(mgr2.pendingConflict.value!.op === 'set' && mgr2.pendingConflict.value!.expectedHash === 'h0', 'createConflictManager.set → pending 含冲突信息')
  // resolve 收口 → Promise resolve
  mgr2.resolve('keep_external')
  assert(mgr2.pendingConflict.value === null, 'createConflictManager.resolve → 清空 pending')
  const resolution = await p
  assert(resolution.action === 'keep_external', 'createConflictManager → set 的 Promise 经 resolve 收口返回 action')

  // resolve 无挂起时幂等(不抛错)
  mgr.resolve('keep_external')
  assert(mgr.pendingConflict.value === null, 'createConflictManager.resolve → 无挂起时幂等(保持 null)')

  // 并发覆盖兜底:新冲突自动按 keep_external 收口旧冲突(防旧工具永挂)
  const mgr3 = createConflictManager()
  const p1 = mgr3.set({ op: 'set', currentValue: {}, currentHash: 'h1', expectedHash: 'h0', snapshotId: 0 })
  const p2 = mgr3.set({ op: 'edit', currentValue: {}, currentHash: 'h2', expectedHash: 'h0', snapshotId: 0 })
  const r1 = await p1
  assert(r1.action === 'keep_external', 'createConflictManager → 并发新冲突自动收口旧冲突(keep_external 兜底)')
  assert(mgr3.pendingConflict.value !== null && mgr3.pendingConflict.value!.op === 'edit', 'createConflictManager → 新冲突挂起(保留)')
  mgr3.resolve('overwrite')
  const r2 = await p2
  assert(r2.action === 'overwrite', 'createConflictManager → 新冲突按 resolve 收口(overwrite)')

  // 无 getEmit:set 不外发(不抛错)
  const mgr4 = createConflictManager()
  mgr4.set({ op: 'delete', currentValue: {}, currentHash: 'h3', expectedHash: 'h0', snapshotId: 0 })
  assert(mgr4.pendingConflict.value !== null, 'createConflictManager(无 getEmit).set → 仍挂起(不依赖 emit)')
}
