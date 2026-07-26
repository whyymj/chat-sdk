import { z } from 'zod'
import { createDataOps, type ConflictInfo, type ConflictResolution } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

// 乐观锁(expectedHash)——防"基于过期值覆盖":外部代码/其他 agent/用户手动改过则拒绝
// 单对象:hash 始终是整体 bind 的 hash(读任意子路径都返回整体 hash),任一字段被外部改过都触发 CONFLICT(保守但一致)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[乐观锁 expectedHash]')
  {
    const pageObj: any = { title: 'old', count: 0, config: { bg: 'white' } }
    const tools = createDataOps({
      schema: z.object({
        title: z.string(),
        count: z.number().int().min(0),
        config: z.object({ bg: z.string() }),
      }),
      bind: pageObj,
      description: '页面',
    })
    const t = byName(tools)

    // get 返回里含 hash(整体)
    let r = await invoke(t['get_data'], { jsonPath: 'title' })
    assert(/hash=/.test(r), 'get 返回含 hash(乐观锁标识)')
    const m = r.match(/hash=(\w+)/)
    const h1 = m ? m[1] : ''

    // edit 子路径传正确 expectedHash → 写入成功(整体未变,hash 匹配)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'title', value: '"new"', expectedHash: h1 })
    assert(/已 edit/.test(r) && pageObj.title === 'new', 'edit 传正确 expectedHash 写入成功')

    // 外部代码改了 count(整体 hash 变)
    pageObj.count = 99
    const r2 = await invoke(t['get_data'], { jsonPath: 'count' })
    const m2 = r2.match(/hash=(\w+)/)
    const h2 = m2 ? m2[1] : ''

    // 用旧整体 hash(h1,改前的)写 count → CONFLICT(整体已变)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5', expectedHash: h1 })
    assert(/VERSION_CONFLICT/.test(r) && pageObj.count === 99, 'edit 传过期 expectedHash → CONFLICT 拒绝写入,值不被覆盖')

    // 用新整体 hash(h2)写 count → 成功
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5', expectedHash: h2 })
    assert(/已 edit/.test(r) && pageObj.count === 5, 'edit 传正确 expectedHash 写入成功(外部改后用新 hash)')

    // edit 嵌套子路径(config.bg)也支持 expectedHash
    pageObj.config.bg = 'external'
    const r3 = await invoke(t['get_data'], { jsonPath: 'config' })
    const h3 = (r3.match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'config.bg', value: '"edited"', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r) && pageObj.config.bg === 'external', 'edit 嵌套子路径传过期 expectedHash → CONFLICT,外部改不被覆盖')
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'config.bg', value: '"edited"', expectedHash: h3 })
    assert(/已 edit/.test(r) && pageObj.config.bg === 'edited', 'edit 嵌套子路径传正确 expectedHash 写入成功')

    // autoLock 默认开:get 后外部改过,不传 expectedHash → 自动检测 CONFLICT
    pageObj.count = 77
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '1' })
    assert(/VERSION_CONFLICT/.test(r) && pageObj.count === 77, 'autoLock 默认:get 后外部改过,不传 expectedHash → 自动 CONFLICT')
    // 重新 get 拿最新 hash 后再写(不传 expectedHash,autoLock 用新 hash,值未变 → 成功)
    await invoke(t['get_data'], { jsonPath: 'count' })
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '1' })
    assert(/已 edit/.test(r) && pageObj.count === 1, 'autoLock:get 最新值后不传 expectedHash 写入成功(值未变,hash 匹配)')

    // delete 也支持 expectedHash
    pageObj.title = 'toDelete'
    const h4 = ((await invoke(t['get_data'], { jsonPath: 'title' })).match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['delete_data'], { jsonPath: 'title', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r), 'delete 传过期 expectedHash → CONFLICT 拒绝')
    r = await invoke(t['delete_data'], { jsonPath: 'title', expectedHash: h4 })
    assert(/已删除/.test(r), 'delete 传正确 expectedHash 删除成功')
  }

  // autoLock:false → 回退旧行为(不传 expectedHash = 不校验,直接写)
  {
    const appObj: any = { x: 1 }
    const tools = createDataOps(
      { schema: z.object({ x: z.number() }), bind: appObj, description: 'app' },
      { autoLock: false },
    )
    const t = byName(tools)
    await invoke(t['get_data'], { jsonPath: 'x' })   // get 记录 hash(整体)
    appObj.x = 99                                            // 外部改
    const r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'x', value: '5' })  // 不传 expectedHash
    assert(/已 edit/.test(r) && appObj.x === 5, 'autoLock:false → 不传 expectedHash 直接写入(向后兼容,不校验)')
  }

  // onConflict 人工介入:冲突时挂起等用户决定(保留外部/强制覆盖/回退)
  {
    let resolveC!: (r: ConflictResolution) => void
    const onConflict = (_info: ConflictInfo) => new Promise<ConflictResolution>((res) => { resolveC = res })
    const pageObj: any = { x: 'orig' }
    const tools2 = createDataOps({ schema: z.object({ x: z.string() }), bind: pageObj, description: 'p' }, { onConflict })
    const t2 = byName(tools2)
    const hx = ((await invoke(t2['get_data'], { jsonPath: 'x' })).match(/hash=(\w+)/) || [])[1]
    const tick = () => new Promise<void>((r) => setTimeout(r, 5))

    // keep_external:保留外部改后的值,不写入
    pageObj.x = 'external'
    const p1 = invoke(t2['set_data'], { value: '{ "x": "agent" }', expectedHash: hx })
    await tick()  // 等 handler 跑到 await onConflict,resolveC 已赋值
    resolveC({ action: 'keep_external' })
    let r = await p1
    assert(/已保留外部/.test(r) && pageObj.x === 'external', 'onConflict keep_external → 保留外部值,不写入 agent 值')

    // overwrite:强制覆盖外部修改,写入 agent 值
    pageObj.x = 'external2'
    const p2 = invoke(t2['set_data'], { value: '{ "x": "agent2" }', expectedHash: hx })
    await tick()
    resolveC({ action: 'overwrite' })
    r = await p2
    assert(/已设置/.test(r) && pageObj.x === 'agent2', 'onConflict overwrite → 强制覆盖,写入 agent 值')

    // restore:回退到快照栈顶(历史检查点),不写入 agent 值
    // 此前 overwrite 已 push 一条快照(external2,即 overwrite 写前值);restore 回退到它
    pageObj.x = 'external3'
    const p3 = invoke(t2['set_data'], { value: '{ "x": "agent3" }', expectedHash: hx })
    await tick()
    resolveC({ action: 'restore' })
    r = await p3
    assert(/已回退/.test(r) && pageObj.x === 'external2', 'onConflict restore → 回退到历史快照(上次 overwrite 写前值 external2),不写入 agent 值')

    // restore 无历史快照时(栈空)→ 返回提示,不抛错
    const pageY: any = { y: 'y0' }
    const tools3 = createDataOps({ schema: z.object({ y: z.string() }), bind: pageY, description: 'p' }, { onConflict })
    const t3 = byName(tools3)
    const hy = ((await invoke(t3['get_data'], { jsonPath: 'y' })).match(/hash=(\w+)/) || [])[1]
    pageY.y = 'yext'
    const p4 = invoke(t3['set_data'], { value: '{ "y": "ya" }', expectedHash: hy })
    await tick()
    resolveC({ action: 'restore' })
    r = await p4
    assert(/无历史快照可回退/.test(r) && pageY.y === 'yext', 'onConflict restore 栈空 → 返回提示,值不变(外部改后值)')
  }

  // JSON 直传(L1):value 支持直接传 object,无需 stringify;也兼容旧 string
  {
    const appObj: any = { obj: { name: 'a', age: 1 }, arr: ['x'] }
    const tools = createDataOps({
      schema: z.object({
        obj: z.object({ name: z.string(), age: z.number() }),
        arr: z.array(z.string()),
      }),
      bind: appObj,
      description: 'app',
    })
    const t = byName(tools)

    // edit set 子路径直传 object
    let r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: { name: 'b', age: 2 } })
    assert(/已 edit/.test(r) && appObj.obj.name === 'b' && appObj.obj.age === 2, 'edit_data set 子路径直传 object 写入成功')
    // edit 仍兼容 JSON 字符串
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: '{"name":"c","age":3}' })
    assert(/已 edit/.test(r) && appObj.obj.name === 'c' && appObj.obj.age === 3, 'edit_data 兼容 JSON 字符串写入')
    // edit set 子路径直传非法 object → schema 校验失败(不写入)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'obj', value: { name: 'd', age: 'not-number' } })
    assert(/error|校验失败|invalid|SCHEMA_INVALID/i.test(r) && appObj.obj.name === 'c', 'edit_data set 子路径直传非法 object → 校验失败不写入')
    // edit merge 直传 object
    r = await invoke(t['edit_data'], { op: 'merge', jsonPath: 'obj', value: { age: 5 } })
    assert(/已 edit/.test(r) && appObj.obj.age === 5, 'edit_data merge 直传 object 成功')
    // edit append 直传数组
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'arr', value: ['y', 'z'] })
    assert(/已 edit/.test(r) && appObj.arr.length === 3 && appObj.arr[2] === 'z', 'edit_data append 直传数组成功')
    // edit append 仍兼容 JSON 字符串
    r = await invoke(t['edit_data'], { op: 'append', jsonPath: 'arr', value: '["w"]' })
    assert(/已 edit/.test(r) && appObj.arr[3] === 'w', 'edit_data 兼容 JSON 字符串 append')

    // set_data 整体直传 object
    r = await invoke(t['set_data'], { value: { obj: { name: 'X', age: 9 }, arr: ['m'] } })
    assert(/已设置/.test(r) && appObj.obj.name === 'X' && appObj.arr.length === 1, 'set_data 整体直传 object 写入成功')
  }
}
