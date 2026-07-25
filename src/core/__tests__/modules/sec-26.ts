import { z } from 'zod'
import { createWindowOps } from '../../tools/windowOps'
import type { TestCtx } from './_ctx'

// 乐观锁(expectedHash)——防"基于过期值覆盖":外部代码/其他 agent/用户手动改过则拒绝
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[乐观锁 expectedHash]')
  {
    const tools = createWindowOps([
      { path: 'page.title', description: '标题', schema: z.string() },
      { path: 'page.count', description: '计数', schema: z.number().int().min(0) },
      { path: 'page.config', description: '配置', schema: z.object({ bg: z.string() }) },
    ])
    const t = byName(tools)
    const w = (globalThis as any).window
    w.page = { title: 'old', count: 0, config: { bg: 'white' } }

    // get 返回里含 hash
    let r = await invoke(t['get_window_prop'], { path: 'page.title' })
    assert(/hash=/.test(r), 'get 返回含 hash(乐观锁标识)')
    const m = r.match(/hash=(\w+)/)
    const h1 = m ? m[1] : ''

    // 传正确 expectedHash → 写入成功
    r = await invoke(t['set_window_prop'], { path: 'page.title', value: '"new"', expectedHash: h1 })
    assert(/已设置/.test(r) && w.page.title === 'new', '传正确 expectedHash 写入成功')

    // 外部代码改了值(模拟用户/宿主手动改)
    w.page.count = 99
    const r2 = await invoke(t['get_window_prop'], { path: 'page.count' })
    const m2 = r2.match(/hash=(\w+)/)
    const h2 = m2 ? m2[1] : ''

    // 用旧 hash(h1 是改前的 title hash,但 title 没被外部改;这里测 count 路径)
    // 改 count 后用改前 hash 写 count → CONFLICT
    r = await invoke(t['set_window_prop'], { path: 'page.count', value: '5', expectedHash: 'stale_hash' })
    assert(/VERSION_CONFLICT/.test(r) && w.page.count === 99, '传过期 expectedHash → CONFLICT 拒绝写入,值不被覆盖')

    // 用正确 hash 写入成功
    r = await invoke(t['set_window_prop'], { path: 'page.count', value: '5', expectedHash: h2 })
    assert(/已设置/.test(r) && w.page.count === 5, '传正确 expectedHash 写入成功(外部改后用新 hash)')

    // edit 也支持 expectedHash(用对象属性 page.config)
    w.page.config.bg = 'external'
    const r3 = await invoke(t['get_window_prop'], { path: 'page.config' })
    const h3 = (r3.match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['edit_window_prop'], { path: 'page.config', op: 'set', jsonPath: 'bg', value: '"edited"', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r) && w.page.config.bg === 'external', 'edit 传过期 expectedHash → CONFLICT,外部改不被覆盖')
    r = await invoke(t['edit_window_prop'], { path: 'page.config', op: 'set', jsonPath: 'bg', value: '"edited"', expectedHash: h3 })
    assert(/已 edit/.test(r) && w.page.config.bg === 'edited', 'edit 传正确 expectedHash 写入成功')

    // 不传 expectedHash → 向后兼容,直接写(不校验)
    w.page.count = 77
    r = await invoke(t['set_window_prop'], { path: 'page.count', value: '1' })
    assert(/已设置/.test(r) && w.page.count === 1, '不传 expectedHash 向后兼容直接写入(不启用乐观锁)')

    // delete 也支持 expectedHash
    w.page.title = 'toDelete'
    const h4 = ((await invoke(t['get_window_prop'], { path: 'page.title' })).match(/hash=(\w+)/) || [])[1]
    r = await invoke(t['delete_window_prop'], { path: 'page.title', expectedHash: 'stale' })
    assert(/VERSION_CONFLICT/.test(r), 'delete 传过期 expectedHash → CONFLICT 拒绝')
    r = await invoke(t['delete_window_prop'], { path: 'page.title', expectedHash: h4 })
    assert(/已删除/.test(r), 'delete 传正确 expectedHash 删除成功')

    delete w.page
  }
}
