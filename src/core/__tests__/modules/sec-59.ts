/**
 * sec-59:placeholder-protected-read-write Phase 2(freeze 接入 dataOps)
 * createDataOps 配 data.resources(freeze)→ read/get_data 占位符 + write/delete/eval 强制层 + C3 + C1 回显。
 * 覆盖:结构化读占位替换 / write set 改 freeze 拒 / 回显放行(C1 不落占位符串)/ patch 改 freeze 拒 /
 *      delete freeze C3 / merge 保留 / query 返真值(A1)/ eval transform F1 / getResourcesSnapshot /
 *      未配 resources 零影响 / 无 vfsStore 降级。
 */
import type { TestCtx } from './_ctx'
import { createVfs } from '../../backends/vfs'
import { createDataOps } from '../../tools/dataOps'
import { z } from 'zod'

export async function run(ctx: TestCtx) {
  const { assert, invoke, byName } = ctx

  const schema = z.object({
    id: z.string(),
    title: z.string(),
    components: z.array(z.object({ type: z.string(), verification: z.string().optional() })),
  })
  const bind: { id: string; title: string; components: { type: string; verification?: string }[] } = {
    id: 'frozen-id', title: '页面', components: [{ type: 'nav', verification: 'v0' }],
  }
  const vfs = createVfs()
  const tools = createDataOps(
    { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'components.0.verification', mode: 'freeze' }] },
    { vfsStore: vfs },
  )
  const t = byName(tools)

  // ===== 结构化读:占位符替换(精确值不入消息流)=====
  const r1 = await invoke(t.read, {})
  assert(/⟦frozen:id⟧/.test(r1), '✓ read 整体 → freeze 字段 id 换占位符(精确值不入消息流)')
  assert(/页面/.test(r1), '✓ read 整体 → 非受保护字段 title 原值保留')
  assert(/⟦frozen:components\.0\.verification⟧/.test(r1), '✓ read 整体 → 嵌套 freeze 路径占位符')
  const r2 = await invoke(t.read, { jsonPath: 'id' })
  assert(/⟦frozen:id⟧/.test(r2), '✓ read 子路径(id)→ 占位符')
  const r3 = await invoke(t.get_data, {})
  assert(/⟦frozen:id⟧/.test(r3), '✓ get_data 整体 → freeze 占位符')

  // ===== 写侧强制:freeze 拒 =====
  const w1 = await invoke(t.write, { value: { id: 'changed', title: '页面', components: [] } })
  assert(/FROZEN_FIELD/.test(w1), '✓ write set 改 freeze 字段 → FROZEN_FIELD')
  // C1 回显:整体 set 带 freeze 占位符 → 放行(回填当前值,占位符串不落 bind)
  const w2 = await invoke(t.write, { value: { id: '⟦frozen:id⟧', title: '新标题', components: [{ type: 'nav', verification: '⟦frozen:components.0.verification⟧' }] } })
  assert(!/FROZEN_FIELD/.test(w2) && /新标题/.test(w2), '✓ write set 回显 freeze 占位符 → 放行(回填当前值)')
  assert(bind.id === 'frozen-id', '✓ C1 回显 → bind freeze 值不变(占位符串不落 bind)')
  assert(bind.title === '新标题', '✓ C1 回显 → 非受保护字段更新')
  assert(bind.components[0].verification === 'v0', '✓ C1 回显 → 嵌套 freeze 值不变')
  // write patch 改 freeze → FROZEN_FIELD
  const w3 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'id', value: 'changed' } })
  assert(/FROZEN_FIELD/.test(w3), '✓ write patch 改 freeze → FROZEN_FIELD')
  // write patch 改非受保护 → 放行
  const w4 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: '标题2' } })
  assert(!/FROZEN_FIELD/.test(w4), '✓ write patch 改非受保护字段 → 放行')

  // ===== C3:delete 受保护路径拒 =====
  const w5 = await invoke(t.write, { patch: { jsonPath: 'id' }, del: true })
  assert(/FROZEN_FIELD/.test(w5), '✓ write delete freeze 路径 → FROZEN_FIELD(C3)')
  const d1 = await invoke(t.delete_data, { jsonPath: 'components.0.verification' })
  assert(/FROZEN_FIELD/.test(d1), '✓ delete_data freeze 路径 → FROZEN_FIELD(C3)')

  // ===== query/search 返真值(A1:不占位替换,写侧强制兜底)=====
  const q1 = await invoke(t.query_data, { expr: '$.id' })
  assert(/frozen-id/.test(q1) && !/⟦frozen/.test(q1), '✓ query_data → 返真值(A1,结构化读才替换)')

  // ===== F1 eval 整体替换强制层:eval_script 用 Web Worker 沙箱,node 自测环境无 Worker 无法执行 transform。
  //   eval 整体替换内联调 enforceSet(dataOps.ts:640,与 commitSetToBind 同一纯函数 sec-58 已覆盖),其 freeze
  //   拒绝逻辑已由 w1(commitSetToBind 路径)+ w3(applyPatchesToBind 路径)代表,eval 端到端留浏览器 E2E 验证。=====

  // ===== controller.getResourcesSnapshot(供跨压缩 pin)=====
  const snap = (tools as unknown as { controller: { getResourcesSnapshot: () => { path: string; mode: string }[] } }).controller.getResourcesSnapshot()
  assert(snap.some((s) => s.path === 'id' && s.mode === 'freeze'), '✓ controller.getResourcesSnapshot → 含 freeze 路径清单')

  // ===== 未配 resources → 零行为变化(read 返原值)=====
  const tools2 = createDataOps({ schema, bind: { id: 'plain', title: 't', components: [] } }, { vfsStore: vfs })
  const t2 = byName(tools2)
  const r4 = await invoke(t2.read, {})
  assert(!/⟦frozen/.test(r4) && /plain/.test(r4), '✓ 未配 resources → read 返原值(零行为变化)')

  // ===== 无 vfsStore + freeze resources → protectedCtx 仍构造(resourceStore 可选),freeze 工作(仅 verbatim 需 vfsStore)=====
  const tools3 = createDataOps({ schema, bind: { id: 'nofreeze', title: 't', components: [] }, resources: [{ path: 'id', mode: 'freeze' }] })
  const t3 = byName(tools3)
  const r5 = await invoke(t3.read, {})
  assert(/⟦frozen:id⟧/.test(r5), '✓ 无 vfsStore → freeze 仍工作(protectedCtx 不依赖 resourceStore;仅 verbatim 需 vfsStore)')
}
