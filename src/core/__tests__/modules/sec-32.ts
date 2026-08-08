import type { TestCtx } from './_ctx'
import { tokenize, estimateMessageTokens, recallRounds, indexSummarize } from '../../composables/contextIndex'
import { createConflictManager } from '../../sdk/conflictManager'
import { trimMemoryMessagesImpl, composeTrimSummary, MEMORY_SUMMARY_PREFIX } from '../../utils/rounds'
import { extractVfsRefs, gcVfsLargeResults } from '../../utils/vfsGc'

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

  // recallRounds 召回纳入 steps.result(recall-and-trim-llm 方向1,解 B2:跨轮工具结果可被关键词召回)
  const roundsWithSteps = [
    { round: 1, startIdx: 0, userMsg: { role: 'user', content: '查一下配置' }, assistantMsgs: [{ role: 'assistant', content: '好的', steps: [{ name: 'read', result: '主题色是薰衣草紫 lavender' }] }] },
    { round: 2, startIdx: 2, userMsg: { role: 'user', content: '另一个话题' }, assistantMsgs: [{ role: 'assistant', content: '无关内容' }] },
  ] as any[]
  const recSteps = recallRounds(roundsWithSteps, '薰衣草', 2)
  assert(recSteps.length === 1 && recSteps[0].round === 1, 'recallRounds → 召回纳入 steps.result(按工具结果关键词命中轮 1)')
  assert(!recSteps.some((r) => r.round === 2), 'recallRounds → 不含工具结果关键词的轮次不召回(轮 2)')

  // trimMemoryMessagesImpl 返回 older/prevSeg + composeTrimSummary(recall-and-trim-llm 方向2:trim 异步 LLM 增强)
  const manyMsgs: any[] = []
  for (let i = 0; i < 4; i++) {
    manyMsgs.push({ role: 'user', content: `问题${i}`, timestamp: i })
    manyMsgs.push({ role: 'assistant', content: `回答${i}`, timestamp: i })
  }
  const trim4 = trimMemoryMessagesImpl(manyMsgs, 2) // 4 轮保留最近 2 轮
  assert(trim4.trimmed === true, 'trimMemoryMessagesImpl → 超限触发 trim')
  if (trim4.trimmed) {
    assert(Array.isArray(trim4.older) && trim4.older.length === 2, 'trimMemoryMessagesImpl → 返回被裁 older 轮次(2 轮,供异步增强复用)')
    assert(trim4.prevSeg === null, 'trimMemoryMessagesImpl → 无头部旧摘要时 prevSeg=null')
    // composeTrimSummary:LLM 重摘要正文 + prevSeg 重组为 system 消息内容
    const enhanced = composeTrimSummary(trim4.older, trim4.prevSeg, 'LLM 生成的连贯摘要')
    assert(enhanced.startsWith(MEMORY_SUMMARY_PREFIX), 'composeTrimSummary → 输出含摘要前缀标记(供下轮 parseSummarySegment 识别)')
    assert(enhanced.includes('LLM 生成的连贯摘要'), 'composeTrimSummary → 输出含 LLM 摘要正文')
    const enhancedWithPrev = composeTrimSummary(trim4.older, { body: '更早的历史', rounds: 3, cumulative: true } as any, '新摘要')
    assert(enhancedWithPrev.includes('更早的历史') && enhancedWithPrev.includes('新摘要'), 'composeTrimSummary → prevSeg 累积正文在前 + LLM 正文在后(不丢累积)')
  }

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

  // vfsGc:引用扫描 + 可达性 GC(context-persist-resilience 功能B —— 解 vfs 孤儿堆积/引用悬空)
  const gcMsgs = [
    { role: 'assistant', content: '结果见 vfs_read({ path: "large_results/read-abc.txt" })', steps: [{ name: 'read', result: '另有 large_results/read-def.txt 引用' }] },
  ] as any
  const refs = extractVfsRefs(gcMsgs)
  assert(refs.has('large_results/read-abc.txt') && refs.has('large_results/read-def.txt'), 'extractVfsRefs → 扫 content + steps.result 提 large_results 地址')
  const gcFiles = { 'large_results/read-abc.txt': { content: 'x' }, 'large_results/orphan.txt': { content: 'y' }, 'drafts/d1.txt': { content: 'z' }, 'userFiles/u.txt': { content: 'w' } }
  const remove = gcVfsLargeResults(gcFiles as any, refs)
  assert(remove.length === 1 && remove[0] === 'large_results/orphan.txt', 'gcVfsLargeResults → 只删 large_results 不可达(orphan);保留可达 + 非 large_results 池(drafts/userFiles 不动)')
  assert(!gcVfsLargeResults(gcFiles as any, new Set(['large_results/read-abc.txt', 'large_results/orphan.txt'])).length, 'gcVfsLargeResults → 全在引用集 → 不删(空)')
}
