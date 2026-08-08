/**
 * sec-58:placeholder-protected-read-write Phase 1(受保护资源基础设施)
 * 纯函数 + ResourceStore + 读侧替换 + 强制层(enforceSet/enforcePatches)白盒测试。
 * 覆盖:占位符/段边界匹配/handle 派生/ResourceStore 增删改查/读侧替换不污染 bind/
 *      freeze 拒+回显放行/verbatim 展开+新值拒/D1 池值自愈/C2 批量定位/C3 remove 拒/无 ctx no-op。
 */
import type { TestCtx } from './_ctx'
import { createVfs } from '../../backends/vfs'
import {
  ResourceStore,
  frozenPlaceholder, resPlaceholder, parsePlaceholder,
  normalizePath, matchProtectedEither, handleFor, deepEqual,
  renderReadPlaceholders, enforceSet, enforcePatches,
  type ResourceProtectSpec, type ProtectedCtx,
} from '../../tools/resources'

function makeMap(specs: ResourceProtectSpec[]): Map<string, ResourceProtectSpec> {
  const m = new Map<string, ResourceProtectSpec>()
  for (const s of specs) m.set(normalizePath(s.path), s)
  return m
}
function makeCtx(map: Map<string, ResourceProtectSpec>, store: ResourceStore, bind: unknown): ProtectedCtx {
  return { resourcesByPath: map, resourceStore: store, getBind: () => bind }
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 占位符生成与解析 =====
  assert(frozenPlaceholder('id') === '⟦frozen:id⟧', '✓ frozenPlaceholder(id) → ⟦frozen:id⟧')
  assert(frozenPlaceholder('a.b.c') === '⟦frozen:a.b.c⟧', '✓ frozenPlaceholder(嵌套路径) → ⟦frozen:a.b.c⟧')
  assert(resPlaceholder('a1b2c3d4') === '⟦res:a1b2c3d4⟧', '✓ resPlaceholder(handle) → ⟦res:handle⟧')
  const pf = parsePlaceholder('⟦frozen:id⟧')
  assert(pf?.type === 'frozen' && pf.path === 'id', '✓ parsePlaceholder → freeze 解析出 path')
  const pr = parsePlaceholder('⟦res:abc123⟧')
  assert(pr?.type === 'res' && pr.handle === 'abc123', '✓ parsePlaceholder → res 解析出 handle')
  assert(parsePlaceholder('普通文字') === null, '✓ parsePlaceholder → 非占位符返 null')
  assert(parsePlaceholder(undefined) === null && parsePlaceholder(123) === null, '✓ parsePlaceholder → undefined/非字符串返 null')

  // ===== normalizePath =====
  assert(normalizePath('.id') === 'id', '✓ normalizePath 去前导点')
  assert(normalizePath(' .a.b ') === 'a.b', '✓ normalizePath 去空白 + 前导点')

  // ===== matchProtectedEither 段边界匹配(§7c B1)=====
  const m1 = makeMap([{ path: 'components', mode: 'freeze' }, { path: 'id', mode: 'freeze' }])
  assert(matchProtectedEither('components', m1)?.relation === 'exact', '✓ matchProtectedEither → exact 精确匹配')
  assert(matchProtectedEither('components.0.key', m1)?.relation === 'descendant', '✓ matchProtectedEither → descendant(components 命中 components.0.key)')
  assert(matchProtectedEither('componentsExtra', m1) === undefined, '✓ matchProtectedEither → 段边界不误伤 componentsExtra')
  assert(matchProtectedEither('componentsA', m1) === undefined, '✓ matchProtectedEither → 段边界不误伤 componentsA')
  const m2 = makeMap([{ path: 'components.0.id', mode: 'freeze' }])
  assert(matchProtectedEither('components', m2)?.relation === 'ancestor', '✓ matchProtectedEither → ancestor(components 是 components.0.id 祖先)')
  assert(matchProtectedEither('components.0', m2)?.relation === 'ancestor', '✓ matchProtectedEither → ancestor(components.0 也是祖先)')
  assert(matchProtectedEither('nonexistent', m2) === undefined, '✓ matchProtectedEither → 不命中返 undefined')

  // ===== handleFor 路径派生(§7c B2:同路径稳定,不同路径不同)=====
  const h1 = handleFor('id'), h2 = handleFor('id')
  assert(h1 === h2, '✓ handleFor → 同路径返同句柄(跨轮稳定)')
  assert(h1 !== handleFor('id2'), '✓ handleFor → 不同路径返不同句柄')
  assert(/^[0-9a-f]{8}$/.test(h1), '✓ handleFor → 8 位 hex 格式')

  // ===== deepEqual =====
  assert(deepEqual(1, 1) && deepEqual('a', 'a'), '✓ deepEqual → 基本类型相等')
  assert(deepEqual({ a: 1 }, { a: 1 }), '✓ deepEqual → 对象相等')
  assert(!deepEqual({ a: 1 }, { a: 2 }), '✓ deepEqual → 对象不等')
  assert(deepEqual([1, 2], [1, 2]) && !deepEqual([1], [1, 2]), '✓ deepEqual → 数组相等/不等')

  // ===== ResourceStore(基于 vfs 第四池)=====
  const vfs = createVfs()
  const store = new ResourceStore(vfs)
  const ha = store.ensure('id', 'abc123', 'verbatim')
  assert(store.get('id')?.value === 'abc123' && store.get('id')?.mode === 'verbatim', '✓ ResourceStore ensure + get(by path)')
  assert(store.get(ha)?.value === 'abc123', '✓ ResourceStore get(by handle)')
  // 句柄稳定:同路径 ensure 两次同 handle(值变 handle 不变)
  const hb = store.ensure('id', 'changed', 'verbatim')
  assert(ha === hb, '✓ ResourceStore → 同路径 ensure 句柄不变(值变 handle 不变)')
  assert(store.get('id')?.value === 'changed', '✓ ResourceStore → ensure 覆盖值')
  // update(改值 handle 不变)
  store.update('id', 'updated')
  assert(store.get('id')?.value === 'updated' && store.get('id')?.handle === ha, '✓ ResourceStore update 改值但 handle 不变')
  // list
  store.ensure('hash', 'xyz', 'verbatim')
  const list = store.list()
  assert(list.length === 2 && list.some((r) => r.path === 'id') && list.some((r) => r.path === 'hash'), '✓ ResourceStore list 列出全部资源')
  assert(list.every((r) => r.handle && r.bytes > 0), '✓ ResourceStore list → 每项含 handle + bytes')
  // delete
  assert(store.delete('hash') === true, '✓ ResourceStore delete(by path)→ 存在返 true')
  assert(!store.get('hash'), '✓ ResourceStore delete 后 get miss')
  assert(store.delete('hash') === false, '✓ ResourceStore delete 不存在 → false')
  assert(store.get('nonexistent') === undefined, '✓ ResourceStore get 不存在 → undefined')
  // vfs 第四池归属
  assert(Object.keys(vfs.files).some((k) => k.startsWith('resources/')), '✓ ResourceStore → 写入 vfs resources/ 前缀(归第四池)')
  store.clear()
  assert(store.list().length === 0, '✓ ResourceStore clear 清空全部')
  assert(!Object.keys(vfs.files).some((k) => k.startsWith('resources/')), '✓ ResourceStore clear → vfs resources 文件清除')

  // ===== renderReadPlaceholders 读侧替换 =====
  const store2 = new ResourceStore(createVfs())
  const rmap = makeMap([{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }])
  const bind = { id: 'secret-id', token: 'tok-abc', title: '页面' }
  const r1 = renderReadPlaceholders({ jp: '', resolved: { ...bind }, resourcesByPath: rmap, resourceStore: store2 }) as Record<string, unknown>
  assert(r1.id === '⟦frozen:id⟧', '✓ renderReadPlaceholders 整体读 → freeze 路径换占位符(精确值不入消息流)')
  assert(typeof r1.token === 'string' && (r1.token as string).startsWith('⟦res:'), '✓ renderReadPlaceholders 整体读 → verbatim 路径换占位符')
  assert(r1.title === '页面', '✓ renderReadPlaceholders → 非受保护路径原值保留')
  assert(bind.id === 'secret-id', '✓ renderReadPlaceholders → 不污染 bind(替换在 clone 上)')
  assert(store2.get('token')?.value === 'tok-abc', '✓ renderReadPlaceholders → verbatim 懒注册入库')
  const r2 = renderReadPlaceholders({ jp: 'id', resolved: 'secret-id', resourcesByPath: rmap, resourceStore: store2 })
  assert(r2 === '⟦frozen:id⟧', '✓ renderReadPlaceholders 子路径读(jp===path)→ 整体换占位符')
  const r3 = renderReadPlaceholders({ jp: '', resolved: { a: 1 }, resourcesByPath: new Map(), resourceStore: store2 })
  assert((r3 as Record<string, unknown>).a === 1, '✓ renderReadPlaceholders → 无受保护路径原值返回(零开销)')
  const r4 = renderReadPlaceholders({ jp: 'title', resolved: '页面', resourcesByPath: rmap, resourceStore: store2 })
  assert(r4 === '页面', '✓ renderReadPlaceholders → read 不涉受保护子树原值返回(零 clone)')

  // ===== enforceSet set 模式强制 =====
  const sstore = new ResourceStore(createVfs())
  const smap = makeMap([{ path: 'id', mode: 'freeze' }, { path: 'hash', mode: 'verbatim' }])
  const sbind = { id: 'abc', hash: 'h0', title: '旧' }
  sstore.ensure('hash', 'h0', 'verbatim')
  assert(!enforceSet({ value: { id: 'changed', hash: 'h0' }, ctx: makeCtx(smap, sstore, sbind) }).ok, '✓ enforceSet → freeze 改值 → 拒(FROZEN_FIELD)')
  const e2 = enforceSet({ value: { id: frozenPlaceholder('id'), hash: 'h0' }, ctx: makeCtx(smap, sstore, sbind) })
  assert(e2.ok && (e2 as { value: Record<string, unknown> }).value.id === 'abc', '✓ enforceSet C1 → freeze 回显占位符 → 放行(回填当前值,不落占位符串)')
  assert(enforceSet({ value: { hash: 'h0' }, ctx: makeCtx(smap, sstore, sbind) }).ok, '✓ enforceSet → freeze 未传(undefined)→ skip 放行(merge 保留)')
  const vh = sstore.get('hash')!.handle
  const e4 = enforceSet({ value: { id: 'abc', hash: resPlaceholder(vh) }, ctx: makeCtx(smap, sstore, sbind) })
  assert(e4.ok && (e4 as { value: Record<string, unknown> }).value.hash === 'h0', '✓ enforceSet → verbatim 写句柄 → 定点展开原值放行')
  assert(enforceSet({ value: { id: 'abc', hash: 'h0' }, ctx: makeCtx(smap, sstore, sbind) }).ok, '✓ enforceSet → verbatim 写原值(resource_get 取到的)→ 放行')
  const e6 = enforceSet({ value: { id: 'abc', hash: 'h1' }, ctx: makeCtx(smap, sstore, sbind) })
  assert(!e6.ok && /VERBATIM_MISMATCH/.test(e6.error), '✓ enforceSet → verbatim 写新值≠原值 → VERBATIM_MISMATCH')
  const e7 = enforceSet({ value: { id: 'abc' }, ctx: undefined })
  assert(e7.ok && (e7 as { value: Record<string, unknown> }).value.id === 'abc', '✓ enforceSet → 无 ctx no-op(向后兼容)')
  assert(enforceSet({ value: { id: 'abc' }, ctx: makeCtx(new Map(), sstore, sbind) }).ok, '✓ enforceSet → 空受保护路径 no-op')

  // ===== D1 自愈:池值 vs bind 当前值漂移(restore/import/setData/外部改 bind 四源)=====
  const dstore = new ResourceStore(createVfs())
  dstore.ensure('hash', 'old', 'verbatim')
  const dbind = { hash: 'new' }  // bind 被外部/restore 改成 'new',池还是 'old'
  const dh = dstore.get('hash')!.handle
  const d1 = enforceSet({ value: { hash: resPlaceholder(dh) }, ctx: makeCtx(makeMap([{ path: 'hash', mode: 'verbatim' }]), dstore, dbind) })
  assert(d1.ok && (d1 as { value: Record<string, unknown> }).value.hash === 'new', '✓ enforceSet D1 自愈 → 池值≠bind,以 bind 当前值为准(不展开旧值覆盖)')
  assert(dstore.get('hash')?.value === 'new' && dstore.get('hash')?.handle === dh, '✓ enforceSet D1 自愈 → 池重注册为 bind 值,handle 不漂移')

  // ===== enforcePatches patch 模式强制(C2 定位 + C3 remove)=====
  const pstore = new ResourceStore(createVfs())
  const pmap = makeMap([{ path: 'id', mode: 'freeze' }, { path: 'components.0.verification', mode: 'verbatim' }])
  pstore.ensure('components.0.verification', 'v0', 'verbatim')
  const pbind = { id: 'abc', components: [{ verification: 'v0', title: 't' }] }
  const pctx = makeCtx(pmap, pstore, pbind)
  const p1 = enforcePatches({ patches: [{ op: 'remove', jsonPath: 'id' }], clone: { id: undefined }, ctx: pctx })
  assert(!p1.ok && /FROZEN_FIELD/.test(p1.error) && /patches\[0\]/.test(p1.error), '✓ enforcePatches C3 → remove freeze 路径 → FROZEN_FIELD + patches[0] 定位')
  const p2 = enforcePatches({ patches: [{ op: 'remove', jsonPath: 'components.0.verification' }], clone: { components: [{ title: 't' }] }, ctx: pctx })
  assert(!p2.ok && /VERBATIM_PROTECTED/.test(p2.error) && /patches\[0\]/.test(p2.error), '✓ enforcePatches C3 → remove verbatim 路径 → VERBATIM_PROTECTED + patches[0]')
  const p3 = enforcePatches({ patches: [{ op: 'set', jsonPath: 'id', value: 'new' }], clone: { id: 'new' }, ctx: pctx })
  assert(!p3.ok && /FROZEN_FIELD/.test(p3.error) && /patches\[0\]/.test(p3.error), '✓ enforcePatches → set 改 freeze → FROZEN_FIELD + patches[0](C2 定位)')
  const p4 = enforcePatches({ patches: [{ op: 'set', jsonPath: 'components.0.title', value: 'ok' }, { op: 'set', jsonPath: 'id', value: 'new' }], clone: { components: [{ title: 'ok', verification: 'v0' }], id: 'new' }, ctx: pctx })
  assert(!p4.ok && /patches\[1\]/.test(p4.error), '✓ enforcePatches C2 → 批量第 2 个 patch 违规 → patches[1] 精准定位')
  const p5 = enforcePatches({ patches: [{ op: 'set', jsonPath: 'components.0.title', value: 'new' }], clone: { components: [{ title: 'new', verification: 'v0' }] }, ctx: pctx })
  assert(p5.ok, '✓ enforcePatches → 不涉受保护路径的 patch → 放行')
  const p6 = enforcePatches({ patches: [{ op: 'set', jsonPath: 'components', value: [{ verification: 'v1' }] }], clone: { components: [{ verification: 'v1' }] }, ctx: pctx })
  assert(!p6.ok && /VERBATIM_MISMATCH/.test(p6.error), '✓ enforcePatches → ancestor 整体替换改 verbatim 后代 → VERBATIM_MISMATCH')
  assert(enforcePatches({ patches: [{ op: 'set', jsonPath: 'id', value: 'new' }], clone: { id: 'new' }, ctx: undefined }).ok, '✓ enforcePatches → 无 ctx no-op(向后兼容)')
}
