/**
 * sec-60:placeholder-protected-read-write Phase 3(verbatim + 资源池生命周期)
 * verbatim 读占位(懒注册)/ write 句柄展开 / VERBATIM_MISMATCH / resource_get/update/list/delete /
 * D1 池值自愈 / D2 resource_update 同步 bind+标脏 / setData 清空 / controller 资源方法 / 无 vfsStore 降级。
 */
import type { TestCtx } from './_ctx'
import { createVfs } from '../../backends/vfs'
import { createDataOps } from '../../tools/dataOps'
import { z } from 'zod'

export async function run(ctx: TestCtx) {
  const { assert, invoke, byName } = ctx

  const schema = z.object({
    id: z.string(),
    token: z.string(),
    title: z.string(),
    components: z.array(z.object({ type: z.string(), hash: z.string().optional() })),
  })
  const bind: { id: string; token: string; title: string; components: { type: string; hash?: string }[] } = {
    id: 'id-1', token: 'tok-v1', title: '页面', components: [{ type: 'nav', hash: 'h0' }],
  }
  const tools = createDataOps(
    { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }, { path: 'components.0.hash', mode: 'verbatim' }] },
    { vfsStore: createVfs() },
  )
  const t = byName(tools)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrl = (tools as any).controller

  // read 整体 → freeze 占位 + verbatim 懒注册
  const r0 = await invoke(t.read, {})
  assert(/⟦frozen:id⟧/.test(r0), '✓ read → freeze id 占位')
  assert(/⟦res:[0-9a-f]{8}⟧/.test(r0), '✓ read → verbatim 懒注册生成 ⟦res:handle⟧ 占位符')
  assert(!/tok-v1/.test(r0), '✓ read → verbatim 精确值不入消息流')
  const tkH = ctrl.getResource('token')?.handle
  const hashH = ctrl.getResource('components.0.hash')?.handle
  assert(!!tkH && !!hashH, '✓ read → verbatim 懒注册入池(handle 派生)')

  // write set 回显 freeze+verbatim 占位符 → 放行(展开原值,bind 不变)
  const w1 = await invoke(t.write, { value: { id: '⟦frozen:id⟧', token: `⟦res:${tkH}⟧`, title: '新标题', components: [{ type: 'nav', hash: `⟦res:${hashH}⟧` }] } })
  assert(!/ERROR/.test(w1), '✓ write set 回显 freeze+verbatim 占位符 → 放行(定点展开原值)')
  assert(bind.token === 'tok-v1' && bind.components[0].hash === 'h0', '✓ write 回显 → verbatim 原值不变(句柄展开回原值)')
  assert(bind.title === '新标题', '✓ write 回显 → 非受保护字段更新')

  // write set verbatim 写新值 → VERBATIM_MISMATCH
  const w2 = await invoke(t.write, { value: { id: '⟦frozen:id⟧', token: 'new-tok', title: '新标题', components: [{ type: 'nav', hash: `⟦res:${hashH}⟧` }] } })
  assert(/VERBATIM_MISMATCH/.test(w2), '✓ write set verbatim 写新值≠原值 → VERBATIM_MISMATCH')
  // write patch verbatim 新值 → VERBATIM_MISMATCH + patches[i]
  const w3 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'token', value: 'patch-tok' } })
  assert(/VERBATIM_MISMATCH/.test(w3) && /patches\[0\]/.test(w3), '✓ write patch verbatim 新值 → VERBATIM_MISMATCH + patches[0]')

  // resource_get 取真值
  assert(/tok-v1/.test(await invoke(t.resource_get, { path: 'token' })), '✓ resource_get → 取 verbatim 真值')
  assert(/id-1/.test(await invoke(t.resource_get, { path: 'id' })), '✓ resource_get → 取 freeze 真值')
  assert(/RESOURCE_NOT_FOUND/.test(await invoke(t.resource_get, { path: 'title' })), '✓ resource_get → 非受保护路径 → RESOURCE_NOT_FOUND(E2)')

  // resource_update verbatim(同步 bind + 标脏 D1 一致)
  const u1 = await invoke(t.resource_update, { path: 'token', value: 'tok-v2' })
  assert(!/ERROR/.test(u1), '✓ resource_update verbatim → 改值成功')
  assert(bind.token === 'tok-v2', '✓ resource_update → 同步 bind(新值,D2)')
  assert(ctrl.getResource('token')?.value === 'tok-v2', '✓ resource_update → 资源池更新')
  // resource_update 改 bind 后 read 刷新 hash(乐观锁),write 句柄展开新值放行(池=bind 一致)
  await invoke(t.read, {})
  const w4 = await invoke(t.write, { value: { id: '⟦frozen:id⟧', token: `⟦res:${tkH}⟧`, title: '新标题', components: [{ type: 'nav', hash: `⟦res:${hashH}⟧` }] } })
  assert(!/ERROR/.test(w4), '✓ resource_update 后 read 刷新 + write 句柄 → 展开新值放行(池=bind 一致)')
  // resource_update freeze → FROZEN_FIELD
  assert(/FROZEN_FIELD/.test(await invoke(t.resource_update, { path: 'id', value: 'new-id' })), '✓ resource_update freeze → FROZEN_FIELD')

  // resource_list / resource_delete
  assert(/token/.test(await invoke(t.resource_list, {})), '✓ resource_list → 列出资源')
  assert(/已释放/.test(await invoke(t.resource_delete, { path: 'token' })), '✓ resource_delete → 释放资源')
  assert(!ctrl.getResource('token'), '✓ resource_delete → 池中移除')

  // D1 自愈(隔离乐观锁:autoLock:false,模拟 restore/import 后池值漂移;乐观锁下 LLM 需重新 read 同步)
  const bindD: { id: string; token: string; title: string; components: never[] } = { id: 'd1', token: 'orig', title: 't', components: [] }
  const toolsD = createDataOps({ schema, bind: bindD, resources: [{ path: 'token', mode: 'verbatim' }] }, { vfsStore: createVfs(), autoLock: false })
  const tD = byName(toolsD)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrlD = (toolsD as any).controller
  await invoke(tD.read, { jsonPath: 'token' })  // 懒注册 token='orig'
  const dH = ctrlD.getResource('token').handle
  bindD.token = 'drifted'  // 模拟 restore/import/外部改 bind(池还是 'orig',漂移)
  const wD = await invoke(tD.write, { value: { id: 'd1', token: `⟦res:${dH}⟧`, title: 't', components: [] } })
  assert(!/ERROR/.test(wD), '✓ D1 自愈 → 池值≠bind,write 句柄以 bind 当前值为准放行(不展开旧值覆盖)')
  assert(ctrlD.getResource('token')?.value === 'drifted', '✓ D1 自愈 → 池重注册为 bind 当前值(handle 不漂移)')

  // setData(controller.set)→ 清空资源(路径可能失效)
  ctrl.set({ schema, bind: { id: 'new', token: 'new', title: 't', components: [] }, description: '新' })
  assert(ctrl.listResources().length === 0, '✓ controller.set(setData)→ 清空资源池(与快照/hash 重置一致)')

  // controller 资源方法(SDK API 委托层)
  const ch = ctrl.createResource('id', 'created-id')
  assert(!!ch, '✓ controller.createResource → 返 handle')
  assert(ctrl.getResource('id')?.value === 'created-id', '✓ controller.getResource → 取值')
  ctrl.updateResource('id', 'updated-id')
  assert(ctrl.getResource('id')?.value === 'updated-id', '✓ controller.updateResource → 改值')
  assert(ctrl.deleteResource('id') === true, '✓ controller.deleteResource → 删除')

  // 无 vfsStore → 资源工具不装配 + verbatim read 降级(返原值)+ freeze 仍工作(protectedCtx 构造)
  const tools2 = createDataOps({ schema, bind: { id: 'x', token: 't', title: 't', components: [] }, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }] })
  const t2 = byName(tools2)
  assert(!t2.resource_get, '✓ 无 vfsStore → 资源工具不装配')
  const r2 = await invoke(t2.read, {})
  assert(/⟦frozen:id⟧/.test(r2), '✓ 无 vfsStore → freeze 仍工作(protectedCtx 构造,不依赖池)')
  assert(!/⟦res:/.test(r2), '✓ 无 vfsStore → verbatim 降级不替换(返原值)')
}
