import { z } from 'zod'
import { createDataSlotOps, type ConflictInfo, type ConflictResolution } from '../../tools/dataSlotOps'
import type { TestCtx } from './_ctx'

// 乐观锁(expectedHash)——防"基于过期值覆盖":外部代码/其他 agent/用户手动改过则拒绝
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[乐观锁 expectedHash]')
  {
    const tools = createDataSlotOps([
      { path: 'page.title', description: '标题', schema: z.string() },
      { path: 'page.count', description: '计数', schema: z.number().int().min(0) },
      { path: 'page.config', description: '配置', schema: z.object({ bg: z.string() }) },
    ])
    const t = byName(tools)
    const w = (globalThis as any).window
    w.page = { title: 'old', count: 0, config: { bg: 'white' } }

    // get 返回里含 hash
    let r = await invoke(t['get_data_slot'], { path: 'page.title' })
    assert(/hash=/.test(r), 'get 返回含 hash(乐观锁标识)')
    const m = r.match(/hash=(\w+)/)
    const h1 = m ? m[1] : ''

    // 传正确 expectedHash → 写入成功
    r = await invoke(t['set_data_slot'], { path: 'page.title', value: '"new"', expectedHash: h1 })
    assert(/已设置/.test(r) && w.page.title === 'new', '传正确 expectedHash 写入成功')

    // 外部代码改了值(模拟用户/宿主手动改)
    w.page.count = 99
    const r2 = await invoke(t['get_data_slot'], { path: 'page.count' })
    const m2 = r2.match(/hash=(\w+)/)
    const h2 = m2 ? m2[1] : ''

    // 用旧 hash(h1 是改前的 title hash,但 title 没被外部改;这里测 count 路径)
    // 改 count 后用改前 hash 写 count → CONFLICT
    r = await invoke(t['set_data_slot'], { path: 'page.count', value: '5', expectedHash: 'stale_hash' })
    assert(/VERSION_CONFLICT/.test(r) && w.page.count === 99, '传过期 expectedHash → CONFLICT 拒绝写入,值不被覆盖')

    // 用正确 hash 写入成功
    r = await invoke(t['set_data_slot'], { path: 'page.count', value: '5', expectedHash: h2 })
    assert(/已设置/.test(r) && w.page.count === 5, '传正确 expectedHash 写入成功(外部改后用新 hash)')

    // edit 也支持 expectedHash(用对象属性 page.config)
    w.page.config.bg = 'external'
    const r3 = await invoke(t['get_data_slot'], { path: 'page.config' })
    const h3 = (r3.match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['edit_data_slot'], { path: 'page.config', op: 'set', jsonPath: 'bg', value: '"edited"', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r) && w.page.config.bg === 'external', 'edit 传过期 expectedHash → CONFLICT,外部改不被覆盖')
    r = await invoke(t['edit_data_slot'], { path: 'page.config', op: 'set', jsonPath: 'bg', value: '"edited"', expectedHash: h3 })
    assert(/已 edit/.test(r) && w.page.config.bg === 'edited', 'edit 传正确 expectedHash 写入成功')

    // autoLock 默认开:get 后外部改过,不传 expectedHash → 自动检测 CONFLICT(防基于过期值覆盖)
    // (page.count 在前面 get 过 + 42 行 set 成 5 后 lastReadHash=hash(5),54 行外部改成 77)
    w.page.count = 77
    r = await invoke(t['set_data_slot'], { path: 'page.count', value: '1' })
    assert(/VERSION_CONFLICT/.test(r) && w.page.count === 77, 'autoLock 默认:get 后外部改过,不传 expectedHash → 自动 CONFLICT')
    // 重新 get 拿最新 hash 后再写(不传 expectedHash,autoLock 用新 hash,值未变 → 成功)
    await invoke(t['get_data_slot'], { path: 'page.count' })
    r = await invoke(t['set_data_slot'], { path: 'page.count', value: '1' })
    assert(/已设置/.test(r) && w.page.count === 1, 'autoLock:get 最新值后不传 expectedHash 写入成功(值未变,hash 匹配)')

    // delete 也支持 expectedHash
    w.page.title = 'toDelete'
    const h4 = ((await invoke(t['get_data_slot'], { path: 'page.title' })).match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['delete_data_slot'], { path: 'page.title', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r), 'delete 传过期 expectedHash → CONFLICT 拒绝')
    r = await invoke(t['delete_data_slot'], { path: 'page.title', expectedHash: h4 })
    assert(/已删除/.test(r), 'delete 传正确 expectedHash 删除成功')

    delete w.page
  }

  // autoLock:false → 回退旧行为(不传 expectedHash = 不校验,直接写)
  {
    const tools = createDataSlotOps(
      [{ path: 'app.x', description: 'x', schema: z.number() }],
      { autoLock: false },
    )
    const t = byName(tools)
    const w = (globalThis as any).window
    w.app = { x: 1 }
    await invoke(t['get_data_slot'], { path: 'app.x' })   // get 记录 hash(1)
    w.app.x = 99                                            // 外部改
    const r = await invoke(t['set_data_slot'], { path: 'app.x', value: '5' })  // 不传 expectedHash
    assert(/已设置/.test(r) && w.app.x === 5, 'autoLock:false → 不传 expectedHash 直接写入(向后兼容,不校验)')
    delete w.app
  }

  // onConflict 人工介入:冲突时挂起等用户决定(保留外部/强制覆盖/回退)
  {
    let resolveC!: (r: ConflictResolution) => void
    const onConflict = (_info: ConflictInfo) => new Promise<ConflictResolution>((res) => { resolveC = res })
    const tools2 = createDataSlotOps([{ path: 'page.x', description: 'x', schema: z.string() }], { onConflict })
    const t2 = byName(tools2)
    const w = (globalThis as any).window
    w.page = { x: 'orig' }
    const hx = ((await invoke(t2['get_data_slot'], { path: 'page.x' })).match(/hash=(\w+)/) || [])[1]
    const tick = () => new Promise<void>((r) => setTimeout(r, 5))

    // keep_external:保留外部改后的值,不写入
    w.page.x = 'external'
    const p1 = invoke(t2['set_data_slot'], { path: 'page.x', value: '"agent"', expectedHash: hx })
    await tick()  // 等 handler 跑到 await onConflict,resolveC 已赋值
    resolveC({ action: 'keep_external' })
    let r = await p1
    assert(/已保留外部/.test(r) && w.page.x === 'external', 'onConflict keep_external → 保留外部值,不写入 agent 值')

    // overwrite:强制覆盖外部修改,写入 agent 值
    w.page.x = 'external2'
    const p2 = invoke(t2['set_data_slot'], { path: 'page.x', value: '"agent2"', expectedHash: hx })
    await tick()
    resolveC({ action: 'overwrite' })
    r = await p2
    assert(/已设置/.test(r) && w.page.x === 'agent2', 'onConflict overwrite → 强制覆盖,写入 agent 值')

    // restore:回退到快照栈顶(历史检查点),不写入 agent 值
    // 此前 overwrite 已 push 一条快照(external2,即 overwrite 写前值);restore 回退到它
    w.page.x = 'external3'
    const p3 = invoke(t2['set_data_slot'], { path: 'page.x', value: '"agent3"', expectedHash: hx })
    await tick()
    resolveC({ action: 'restore' })
    r = await p3
    assert(/已回退/.test(r) && w.page.x === 'external2', 'onConflict restore → 回退到历史快照(上次 overwrite 写前值 external2),不写入 agent 值')

    // restore 无历史快照时(栈空)→ 返回提示,不抛错
    const tools3 = createDataSlotOps([{ path: 'page.y', description: 'y', schema: z.string() }], { onConflict })
    const t3 = byName(tools3)
    w.page.y = 'y0'
    const hy = ((await invoke(t3['get_data_slot'], { path: 'page.y' })).match(/hash=(\w+)/) || [])[1]
    w.page.y = 'yext'
    const p4 = invoke(t3['set_data_slot'], { path: 'page.y', value: '"ya"', expectedHash: hy })
    await tick()
    resolveC({ action: 'restore' })
    r = await p4
    assert(/无历史快照可回退/.test(r) && w.page.y === 'yext', 'onConflict restore 栈空 → 返回提示,值不变(外部改后值)')

    delete w.page
  }

  // JSON 直传(L1):value 支持直接传 object,无需 stringify;也兼容旧 string
  {
    const tools = createDataSlotOps([
      { path: 'app.obj', description: '对象', schema: z.object({ name: z.string(), age: z.number() }) },
      { path: 'app.arr', description: '数组', schema: z.array(z.string()) },
    ])
    const t = byName(tools)
    const w = (globalThis as any).window
    w.app = { obj: { name: 'a', age: 1 }, arr: ['x'] }

    // set 直传 object
    let r = await invoke(t['set_data_slot'], { path: 'app.obj', value: { name: 'b', age: 2 } })
    assert(/已设置/.test(r) && w.app.obj.name === 'b' && w.app.obj.age === 2, 'set_data_slot 直传 object 写入成功')
    // set 仍兼容 JSON 字符串(向后兼容)
    r = await invoke(t['set_data_slot'], { path: 'app.obj', value: '{"name":"c","age":3}' })
    assert(/已设置/.test(r) && w.app.obj.name === 'c' && w.app.obj.age === 3, 'set_data_slot 兼容 JSON 字符串写入')
    // set 直传非法 object → schema 校验失败(不写入)
    r = await invoke(t['set_data_slot'], { path: 'app.obj', value: { name: 'd', age: 'not-number' } })
    assert(/error|校验失败|invalid/i.test(r) && w.app.obj.name === 'c', 'set_data_slot 直传非法 object → 校验失败不写入')
    // edit 直传 object(merge)
    r = await invoke(t['edit_data_slot'], { path: 'app.obj', op: 'merge', value: { age: 5 } })
    assert(/已 edit/.test(r) && w.app.obj.age === 5, 'edit_data_slot 直传 object merge 成功')
    // edit append 直传 object
    r = await invoke(t['edit_data_slot'], { path: 'app.arr', op: 'append', value: ['y', 'z'] })
    assert(/已 edit/.test(r) && w.app.arr.length === 3 && w.app.arr[2] === 'z', 'edit_data_slot append 直传数组成功')
    // edit 仍兼容 JSON 字符串
    r = await invoke(t['edit_data_slot'], { path: 'app.arr', op: 'append', value: '["w"]' })
    assert(/已 edit/.test(r) && w.app.arr[3] === 'w', 'edit_data_slot 兼容 JSON 字符串 append')

    delete w.app
  }
}
