/**
 * sec-56:focus-auto-switch Phase 1(usageHints focus 引导)
 *  - advanced + focus 开 → 注入「上下文聚焦」段(set_focus/clear_focus + 局部/全局分流)
 *  - simple / minimal → 不注入(与 set_focus 工具 advanced-only 暴露一致)
 *  - capabilities.focus:false → 不注入;默认 opt-out 开 → 注入
 *  - 与 planning 段共存 + 「## 能力使用提示」包裹结构不破
 */
import type { TestCtx } from './_ctx'
import { createUsageHintsMiddleware } from '../../harness/usageHints'

/** 构造 usageHints 中间件,取其 augmentPrompt 输出(state 不参与,传空对象) */
function hintPrompt(caps: any, hasDataOps: boolean, toolMode: 'simple' | 'advanced' | 'minimal'): string {
  const mw = createUsageHintsMiddleware(caps, hasDataOps, toolMode)
  return (mw.augmentPrompt as any)?.({} as any) ?? ''
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== advanced + focus 开 → 注入「上下文聚焦」引导 =====
  const adv = hintPrompt({ focus: true }, true, 'advanced')
  assert(/上下文聚焦/.test(adv), '✓ usageHints → advanced + focus 开 注入「上下文聚焦」段')
  assert(/set_focus/.test(adv) && /clear_focus/.test(adv), '✓ usageHints → focus 段含 set_focus/clear_focus 引导')
  assert(/局部任务/.test(adv) && /全局任务/.test(adv), '✓ usageHints → focus 段含局部/全局任务分流引导')

  // ===== simple 模式 → 不注入(simple 不暴露 set_focus 工具,门控一致)=====
  const sim = hintPrompt({ focus: true }, true, 'simple')
  assert(!/上下文聚焦/.test(sim), '✓ usageHints → simple 模式 不注入 focus 段(工具也不暴露)')

  // ===== capabilities.focus:false → 不注入 =====
  const off = hintPrompt({ focus: false }, true, 'advanced')
  assert(!/上下文聚焦/.test(off), '✓ usageHints → capabilities.focus:false 不注入')

  // ===== 默认 {} → focus 默认开(opt-out)注入 =====
  const def = hintPrompt({}, true, 'advanced')
  assert(/上下文聚焦/.test(def), '✓ usageHints → 默认(focus opt-out 默认开)注入 focus 段')

  // ===== 与 planning 段共存 + 「## 能力使用提示」包裹结构保持 =====
  const both = hintPrompt({ planning: true, focus: true }, true, 'advanced')
  assert(/自适应规划/.test(both) && /上下文聚焦/.test(both), '✓ usageHints → planning + focus 段共存')
  assert(/^## 能力使用提示/.test(both), '✓ usageHints → 「## 能力使用提示」包裹结构保持')

  // ===== minimal 模式(同 simple,不注入)=====
  const mini = hintPrompt({ focus: true }, true, 'minimal')
  assert(!/上下文聚焦/.test(mini), '✓ usageHints → minimal 模式 不注入 focus 段(与 simple 一致)')
}
