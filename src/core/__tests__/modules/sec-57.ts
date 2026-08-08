/**
 * sec-57:focus-auto-switch Phase 2(focus 持久化 · storage kind 往返)
 *  - SessionSnapshot.focus 存取往返(save→flush→load 深等)
 *  - 泛 kind 迭代自动覆盖:focus kind 不误写、不破坏其他 kind
 *  - (createChatSdk 层的 applySnapshot/restore 校验在 e2e focus.mjs 测)
 */
import type { TestCtx } from './_ctx'
import { createSessionStore, estimateBytes } from '../../backends/storage'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // save({focus}) → flush → load 深等(path + label)
  const s = createSessionStore({ debounceMs: 10 })
  await s.ready
  const sid = await s.createSession('a1')
  await s.save('a1', sid, { focus: { path: 'components.3', label: '导航栏' } })
  await s.flush()
  const snap1 = await s.load('a1', sid)
  assert(snap1?.focus?.path === 'components.3' && snap1?.focus?.label === '导航栏', '✓ storage focus kind → save({focus}) → load 深等(path+label)')

  // 无 label focus 也往返
  await s.save('a1', sid, { focus: { path: 'components.0' } })
  await s.flush()
  const snap2 = await s.load('a1', sid)
  assert(snap2?.focus?.path === 'components.0' && snap2?.focus?.label === undefined, '✓ storage focus kind → 无 label focus 也往返')

  // 只存其他 kind 时 focus === undefined(泛 kind 迭代不误写)
  const s2 = createSessionStore({ debounceMs: 10 })
  await s2.ready
  const sid2 = await s2.createSession('a2')
  await s2.save('a2', sid2, { memory: 'only memory' })
  await s2.flush()
  const snap3 = await s2.load('a2', sid2)
  assert(snap3?.focus === undefined, '✓ storage focus kind → 只存其他 kind 时 focus === undefined(泛 kind 迭代不误写)')

  // estimateBytes 对 focus 值 > 0(字节估算自动覆盖泛 kind)
  assert(estimateBytes({ path: 'components.3', label: '导航栏' }) > 0, '✓ storage focus kind → estimateBytes(focus 值) > 0(字节估算自动覆盖)')
}
