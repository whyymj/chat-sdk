import { createVfs, createVfsTools } from '../../backends/vfs'
import { offloadLargeResult } from '../../utils/offload'
import type { TestCtx } from './_ctx'

/**
 * sec-33 —— vfs JSON 工具 + offload 元数据(add-complex-preset-and-vfs-json)。
 * complex 预设的比例制字段已在 sec-21 覆盖;此处聚焦 vfs_json_read/vfs_json_patch/vfs_write jsonString
 * 与 offload 结构化元数据(期四补 offload 断言)。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[sec-33] vfs JSON 工具(add-complex-preset-and-vfs-json)')

  // ===== vfs JSON 工具(vfs_json_read / vfs_json_patch / vfs_write jsonString)=====
  {
    const store = createVfs()
    const tools = createVfsTools(store)
    const byName: Record<string, any> = {}
    for (const t of tools) byName[(t as any).name] = t
    const t = byName
    const isErr = (r: any, code: string) => typeof r === 'string' && r.startsWith('ERROR:') && r.includes(code)

    // vfs_write jsonString 校验
    const wOk = await t.vfs_write.invoke({ path: 'a.json', content: '{"x":1}', jsonString: true })
    assert(typeof wOk === 'string' && wOk.includes('JSON 校验通过'), 'vfs_write jsonString=true 合法 JSON → 写入成功(文案含 JSON 校验通过)')
    const wBad = await t.vfs_write.invoke({ path: 'b.json', content: '{not json', jsonString: true })
    assert(isErr(wBad, 'VFS_JSON_INVALID'), 'vfs_write jsonString=true 非法 JSON → VFS_JSON_INVALID 不写入')
    const wPlain = await t.vfs_write.invoke({ path: 'c.txt', content: '纯文本' })
    assert(typeof wPlain === 'string' && wPlain.includes('已写入') && !wPlain.includes('JSON'), 'vfs_write 不传 jsonString → 写纯文本(现状,无 JSON 校验)')

    // vfs_json_read 整体 / 子路径 / 非法 JSON / 不存在 jsonPath / 不存在文件
    const rWhole = await t.vfs_json_read.invoke({ path: 'a.json' })
    assert(typeof rWhole === 'string' && rWhole.includes('"x":1'), 'vfs_json_read 整体读 → 返回 parse 后 JSON')
    const rSub = await t.vfs_json_read.invoke({ path: 'a.json', jsonPath: 'x' })
    assert(typeof rSub === 'string' && rSub.includes('1'), 'vfs_json_read 子路径(x) → 返回子树值')
    const rMiss = await t.vfs_json_read.invoke({ path: 'a.json', jsonPath: 'nope' })
    assert(isErr(rMiss, 'VFS_PATH_NOT_FOUND'), 'vfs_json_read 不存在 jsonPath → VFS_PATH_NOT_FOUND')
    const rInvalid = await t.vfs_json_read.invoke({ path: 'c.txt' })
    assert(isErr(rInvalid, 'VFS_JSON_INVALID'), 'vfs_json_read 非法 JSON 文件 → VFS_JSON_INVALID')
    const rNotFound = await t.vfs_json_read.invoke({ path: 'absent.json' })
    assert(isErr(rNotFound, 'NOT_FOUND'), 'vfs_json_read 不存在文件 → NOT_FOUND')

    // vfs_json_patch set/append/merge/remove + 原子性 + 批量
    await t.vfs_write.invoke({ path: 'd.json', content: '{"items":[1,2],"meta":{"k":"v"}}', jsonString: true })
    const pSet = await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'set', jsonPath: 'meta.k', value: 'vv' }] })
    assert(typeof pSet === 'string' && pSet.includes('已对'), 'vfs_json_patch set → 成功文案')
    const afterSet = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'meta.k' })
    assert(typeof afterSet === 'string' && afterSet.includes('"vv"'), 'vfs_json_patch set 生效(meta.k=vv)')
    await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'append', jsonPath: 'items', value: 3 }] })
    const afterAppend = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'items' })
    assert(typeof afterAppend === 'string' && afterAppend.includes('[1,2,3]'), 'vfs_json_patch append 生效(items=[1,2,3])')
    await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'merge', jsonPath: 'meta', value: { k2: 9 } }] })
    const afterMerge = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'meta.k2' })
    assert(typeof afterMerge === 'string' && afterMerge.includes('9'), 'vfs_json_patch merge 生效(meta.k2=9)')
    await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'remove', jsonPath: 'meta.k2' }] })
    const afterRemove = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'meta.k2' })
    assert(isErr(afterRemove, 'VFS_PATH_NOT_FOUND'), 'vfs_json_patch remove 生效(meta.k2 已删,再读 NOT_FOUND)')
    // 原子性:第 2 个 patch(merge 到数组 items)失败 → 整批不写回,原文件不变
    const beforeAtomic = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'items' })
    const atomBad = await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'set', jsonPath: 'items.0', value: 99 }, { op: 'merge', jsonPath: 'items', value: { x: 1 } }] })
    assert(isErr(atomBad, 'PATCH_FAILED'), 'vfs_json_patch 原子性:第 2 patch(merge 到数组)失败 → PATCH_FAILED')
    const afterAtomic = await t.vfs_json_read.invoke({ path: 'd.json', jsonPath: 'items' })
    assert(beforeAtomic === afterAtomic, 'vfs_json_patch 原子性:整批失败 → 原文件不变(items.0 未变 99)')
    // 多 patch 一次原子应用
    const multi = await t.vfs_json_patch.invoke({ path: 'd.json', patches: [{ op: 'set', jsonPath: 'meta.k', value: 'done' }, { op: 'append', jsonPath: 'items', value: 4 }] })
    assert(typeof multi === 'string' && multi.includes('2 个 patch'), 'vfs_json_patch 批量:一次应用 2 patch 成功')
  }

  // ===== vfs 三池分池(期三):三池独立 LRU 互不挤占 + 跨池透明 =====
  console.log('[sec-33] vfs 三池分池独立 LRU')
  {
    // 用小 poolBytes 便于触发淘汰;large_results/drafts/userFiles 各 300 字节
    const store = createVfs(undefined, { poolBytes: { largeResults: 300, drafts: 300, userFiles: 300 } })
    // large_results 池:a(200) + b(200) = 400 > 300 → 淘汰最旧的 a
    store.files['large_results/a.txt'] = { content: 'x'.repeat(200), updatedAt: 1 }
    store.files['large_results/b.txt'] = { content: 'y'.repeat(200), updatedAt: 2 }
    assert(!('large_results/a.txt' in store.files) && 'large_results/b.txt' in store.files, '三池 LRU:large_results 超池上限 → 仅淘汰该池最旧(a),保留新文件(b)')
    // userFiles 独立:不受 large_results 淘汰影响
    store.files['user1.txt'] = { content: 'u'.repeat(200), updatedAt: 3 }
    assert('user1.txt' in store.files, '三池 LRU:userFiles 文件独立(不被 large_results 淘汰)')
    // large_results 再淘汰不影响 userFiles
    store.files['large_results/c.txt'] = { content: 'z'.repeat(200), updatedAt: 4 }
    assert(!('large_results/b.txt' in store.files) && 'large_results/c.txt' in store.files, '三池 LRU:large_results 再淘汰 b 保留 c(池内 LRU)')
    assert('user1.txt' in store.files, '三池 LRU:large_results 淘汰不影响 userFiles(互不挤占)')
    // drafts 池独立(前序 change 未实现 draft_write,池空占位,但 LRU 就绪)
    store.files['drafts/d1.txt'] = { content: 'd'.repeat(200), updatedAt: 5 }
    assert('drafts/d1.txt' in store.files && 'user1.txt' in store.files, '三池 LRU:drafts 池独立(与 userFiles/largeResults 互不挤占)')

    // 跨池透明:vfs_ls 列出所有池文件(不关心分池)
    const store2 = createVfs()
    store2.files['large_results/x'] = { content: 'a', updatedAt: 1 }
    store2.files['drafts/y'] = { content: 'b', updatedAt: 1 }
    store2.files['userz'] = { content: 'c', updatedAt: 1 }
    const tools2 = createVfsTools(store2)
    const lsTool: any = tools2.find((tt: any) => tt.name === 'vfs_ls')
    const lsRes = await lsTool.invoke({})
    assert(typeof lsRes === 'string' && lsRes.includes('large_results/x') && lsRes.includes('drafts/y') && lsRes.includes('userz'), '三池跨池透明:vfs_ls 列出全部池文件(large_results/drafts/userFiles)')
    const readTool: any = tools2.find((tt: any) => tt.name === 'vfs_read')
    const readRes = await readTool.invoke({ path: 'drafts/y', offset: 0, limit: 100 })
    assert(typeof readRes === 'string' && readRes.includes('b'), '三池跨池透明:vfs_read 读 drafts/ 池文件')
  }

  // ===== offload 结构化元数据 + suggestedReadPlan(期四)=====
  console.log('[sec-33] offload 结构化元数据')
  {
    const files: Record<string, any> = {}
    // 大结果(>10000)→ 外存 + suggestedReadPlan
    const big = 'x'.repeat(15000)
    const r = offloadLargeResult(big, { toolName: 'read', vfsAvailable: true, files, threshold: 6000 })
    assert(r.offloaded === true, 'offload 大结果 → offloaded=true')
    assert(typeof r.path === 'string' && r.path!.includes('large_results/read-'), 'offload → path 含 large_results/<tool>-')
    assert(r.totalChars === 15000, 'offload → totalChars=原字符数')
    assert(typeof r.preview === 'string' && r.preview!.length === 1000, 'offload → preview 前 1000 字符')
    assert(typeof r.suggestedReadPlan === 'string' && r.suggestedReadPlan!.includes('vfs_read') && r.suggestedReadPlan!.includes('offset'), 'offload 大结果(>10000)→ suggestedReadPlan 含 vfs_read 分页建议')
    // 中结果(6000<length≤10000)→ 外存但无 suggestedReadPlan
    const files2: Record<string, any> = {}
    const med = 'y'.repeat(8000)
    const r2 = offloadLargeResult(med, { toolName: 'read', vfsAvailable: true, files: files2, threshold: 6000 })
    assert(r2.offloaded === true && r2.suggestedReadPlan === undefined, 'offload 中结果(6000<length≤10000)→ 外存但无 suggestedReadPlan')
    // 小结果(≤阈值)→ 原样无元数据
    const r3 = offloadLargeResult('hi', { toolName: 't', vfsAvailable: true, files: {} })
    assert(r3.content === 'hi' && r3.offloaded === undefined, 'offload 小结果(≤阈值)→ 原样 .content,无 offloaded')
  }
}
