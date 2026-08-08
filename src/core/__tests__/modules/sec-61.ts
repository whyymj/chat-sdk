/**
 * sec-61:placeholder-protected-read-write Phase 4(跨压缩 pin + usageHints 资源段)
 * resourcesPin 中间件 augmentPrompt 注入「受保护资源」段 + usageHints 第 4 参 hasResources 门控资源段。
 */
import type { TestCtx } from './_ctx'
import { createResourcesPinMiddleware } from '../../harness/resourcesPin'
import { createUsageHintsMiddleware } from '../../harness/usageHints'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pinPrompt(snap: { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[]): string {
  const mw = createResourcesPinMiddleware({ getResourcesSnapshot: () => snap })
  return (mw.augmentPrompt as any)?.({} as any) ?? ''
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hintPrompt(hasResources: boolean): string {
  const mw = createUsageHintsMiddleware({}, true, 'advanced', hasResources)
  return (mw.augmentPrompt as any)?.({} as any) ?? ''
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== resourcesPin 中间件注入「受保护资源」段 =====
  const p1 = pinPrompt([{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim', handle: 'abc12345' }])
  assert(/受保护资源/.test(p1), '✓ resourcesPin → 注入「受保护资源(跨压缩保留)」段')
  assert(/id.*freeze/.test(p1), '✓ resourcesPin → 含 freeze 路径(id)')
  assert(/token.*verbatim/.test(p1) && /⟦res:abc12345⟧/.test(p1), '✓ resourcesPin → 含 verbatim 路径 + 句柄')
  assert(/resource_get/.test(p1), '✓ resourcesPin → 含 resource_get 取真值引导')
  assert(/FROZEN_FIELD/.test(p1) && /VERBATIM_MISMATCH/.test(p1), '✓ resourcesPin → 含错误码应对引导')
  // 空资源清单 → undefined(不注入)
  assert(pinPrompt([]) === undefined || pinPrompt([]) === '', '✓ resourcesPin → 空清单不注入段')

  // ===== usageHints 第 4 参 hasResources 门控资源段 =====
  const uh1 = hintPrompt(true)
  assert(/受保护资源·精确值保护/.test(uh1), '✓ usageHints hasResources=true → 注入资源段')
  assert(/⟦frozen:path⟧/.test(uh1) && /⟦res:handle⟧/.test(uh1), '✓ usageHints → 含占位符语义')
  assert(/resource_get/.test(uh1), '✓ usageHints → 含 resource_get 引导')
  assert(/RESOURCE_EVICTED/.test(uh1), '✓ usageHints → 含淘汰检测引导')
  const uh2 = hintPrompt(false)
  assert(!/受保护资源·精确值保护/.test(uh2), '✓ usageHints hasResources=false → 不注入资源段')
  // 默认(未传 hasResources)→ false
  const mwDef = createUsageHintsMiddleware({}, true, 'advanced')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uhDef = (mwDef.augmentPrompt as any)?.({} as any) ?? ''
  assert(!/受保护资源·精确值保护/.test(uhDef), '✓ usageHints 默认 hasResources=false → 不注入(向后兼容)')
}
