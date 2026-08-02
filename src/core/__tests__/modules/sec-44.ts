/**
 * sec-44:subagent-writable(Phase 2 子 agent 写权限 + path guard)
 * - extractWritePaths:jsonPath/patch.jsonPath/patches[].jsonPath/path 提取;整体 set 无 → 空
 * - isPathWritable:前缀匹配(精确/startsWidth('.')/startsWidth('['))
 * - wrapWithPathGuard:越界 PATH_OUT_OF_SCOPE / 前缀允许 / 整体 set 禁
 */
import { extractWritePaths, isPathWritable, wrapWithPathGuard } from '../../harness/subagent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[subagent-writable · path guard]')
  // ===== extractWritePaths:所有 jsonPath 形态提取 =====
  assert(extractWritePaths({ jsonPath: 'a.b' })[0] === 'a.b', '✓ extractWritePaths → jsonPath 直提取')
  assert(extractWritePaths({ patch: { jsonPath: 'a.b' } })[0] === 'a.b', '✓ extractWritePaths → patch.jsonPath')
  assert(extractWritePaths({ patches: [{ jsonPath: 'a.b' }, { jsonPath: 'c.d' }] }).length === 2, '✓ extractWritePaths → patches[].jsonPath 批量')
  assert(extractWritePaths({ value: { x: 1 } }).length === 0, '✓ extractWritePaths → 整体 set(无 jsonPath)→ 空(盲区)')

  // ===== isPathWritable:前缀匹配 =====
  assert(isPathWritable('components', ['components']), '✓ isPathWritable → 精确相等')
  assert(isPathWritable('components.0.title', ['components']), '✓ isPathWritable → startsWith(".")(子属性)')
  assert(isPathWritable('components[0]', ['components']), '✓ isPathWritable → startsWith("[")(数组索引)')
  assert(!isPathWritable('settings.theme', ['components']), '✓ isPathWritable → 越界拒绝(settings 不在 components)')

  // ===== wrapWithPathGuard:mock tool + 前缀允许 / 越界 / 整体 set 禁 =====
  const mockTool = { name: 'write', invoke: async (_args: any) => 'WRITE_OK' } as any
  const guarded = wrapWithPathGuard(mockTool, ['components'])
  // 前缀允许(components.0.title 在 components 下)
  const r1 = await (guarded.invoke as any)({ patch: { jsonPath: 'components.0.title', value: 'x' } })
  assert(r1 === 'WRITE_OK', '✓ wrapWithPathGuard → 前缀内允许通过(components.0.title)')
  // 越界(settings.theme 不在 components)
  const r2 = await (guarded.invoke as any)({ patch: { jsonPath: 'settings.theme', value: 'dark' } })
  assert(String(r2).includes('PATH_OUT_OF_SCOPE'), '✓ wrapWithPathGuard → 越界拒绝 PATH_OUT_OF_SCOPE(settings.theme)')
  // 整体 set(无 jsonPath → 禁)
  const r3 = await (guarded.invoke as any)({ value: { title: '整体替换' } })
  assert(String(r3).includes('PATH_OUT_OF_SCOPE'), '✓ wrapWithPathGuard → 整体 set 禁(无 jsonPath 盲区 → 拒)')
  assert(String(r3).includes('增量 patch'), '✓ wrapWithPathGuard → 整体 set 提示用增量 patch')
}
