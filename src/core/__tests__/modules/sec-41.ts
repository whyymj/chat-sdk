/**
 * sec-41:draft_write / draft_commit(分块构建超大 JSON)+ commitSetToBind 纯函数
 * - commitSetToBind:合法→{ok,hash,data}+写 bind+入快照 / schema 失败→{ok:false,error} 不写 / dryRun 不写
 * - draft_write:start 新建 / append 追加 / 累计 bytes
 * - draft_commit:parse 失败(JSON_INVALID,草稿保留)/ schema 失败(草稿保留)/ 成功写 bind+清草稿 / DRAFT_NOT_FOUND
 * - createDataOps({vfsStore}) 含 draft 工具;无 vfsStore 不含;闭包共享(draft_commit 写后 bind 更新)
 * - filterByToolMode:simple 隐藏 draft,advanced 暴露
 */
import { z } from 'zod'
import { createDataOps, commitSetToBind, filterByToolMode } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  const schema = z.object({ title: z.string(), count: z.number() })

  // ===== commitSetToBind 纯函数 =====
  console.log('\n[draft · commitSetToBind 纯函数]')
  {
    const bind = { title: '旧', count: 1 }
    const snapshots: any[] = []
    const audits: any[] = []
    const r = commitSetToBind({ bindRef: bind, value: { title: '新', count: 2 }, schema, allowKeys: null, snapshots, maxSnapshots: 20, audit: (e) => audits.push(e) })
    assert(r.ok === true && (r as any).hash !== '', '✓ commitSetToBind 合法值 → {ok,hash,data}')
    assert(bind.title === '新' && bind.count === 2, '✓ commitSetToBind → 就地写 bind')
    assert(snapshots.length === 1, '✓ commitSetToBind → 入快照(写前 deepClone)')
    assert(audits.length === 1 && audits[0].op === 'set', '✓ commitSetToBind → 审计回调(op=set)')

    // schema 失败 → {ok:false,error},不写不入快照
    const bind2 = { title: 'x', count: 1 }
    const snaps2: any[] = []
    const r2 = commitSetToBind({ bindRef: bind2, value: { title: 123, count: 2 }, schema, allowKeys: null, snapshots: snaps2, maxSnapshots: 20, audit: () => {} })
    assert(r2.ok === false, '✓ commitSetToBind schema 失败 → {ok:false,error}')
    assert(bind2.title === 'x' && snaps2.length === 0, '✓ commitSetToBind 失败 → 不写 bind 不入快照')

    // dryRun → 不写不入快照,返回 data(hash='')
    const bind3 = { title: 'x', count: 1 }
    const snaps3: any[] = []
    const r3 = commitSetToBind({ bindRef: bind3, value: { title: 'y', count: 2 }, schema, allowKeys: null, snapshots: snaps3, maxSnapshots: 20, audit: () => {}, dryRun: true })
    assert(r3.ok === true && (r3 as any).hash === '', '✓ commitSetToBind dryRun → {ok,hash:""}')
    assert(bind3.title === 'x' && snaps3.length === 0, '✓ commitSetToBind dryRun → 不写不入快照')
  }

  // ===== draft_write / draft_commit(经 createDataOps + vfsStore)=====
  console.log('\n[draft · draft_write/draft_commit 工具]')
  const vfs = createVfs()
  {
    const bind = { title: '初始', count: 0 }
    const tools = createDataOps({ schema, bind, description: '测试' }, { vfsStore: vfs as any })
    const byName = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, any>
    assert(tools.some((t) => t.name === 'draft_write'), '✓ createDataOps({vfsStore}) → 含 draft_write')
    assert(tools.some((t) => t.name === 'draft_commit'), '✓ createDataOps({vfsStore}) → 含 draft_commit')

    // 无 vfsStore → 不含 draft
    const toolsNoDraft = createDataOps({ schema, bind: { title: 'x', count: 0 }, description: 'x' })
    assert(!toolsNoDraft.some((t) => t.name === 'draft_write'), '✓ createDataOps 无 vfsStore → 不含 draft(opt-in)')

    // draft_write start + append
    const chunkA = '{"title":"分块",'
    const r1 = await invoke(byName['draft_write'], { draftId: 'p1', chunk: chunkA, mode: 'start' })
    const j1 = JSON.parse(r1)
    assert(j1.mode === 'start' && j1.bytes === chunkA.length, '✓ draft_write start → 新建草稿 + bytes')
    const chunkB = '"count":5}'
    const r2 = await invoke(byName['draft_write'], { draftId: 'p1', chunk: chunkB, mode: 'append' })
    const j2 = JSON.parse(r2)
    assert(j2.mode === 'append' && j2.bytes === (chunkA + chunkB).length, '✓ draft_write append → 追加 + 累计 bytes')

    // draft_commit 成功:写 bind + 清草稿
    const rc = await invoke(byName['draft_commit'], { draftId: 'p1' })
    assert(rc.includes('已 draft_commit') && rc.includes('分块'), '✓ draft_commit 成功 → 写 bind')
    assert(bind.title === '分块' && bind.count === 5, '✓ draft_commit → bind 已更新(闭包共享)')
    assert(!('drafts/p1.json' in (vfs as any).files), '✓ draft_commit 成功 → 草稿已清')

    // draft_commit JSON_INVALID(草稿保留,bind 不变)
    await invoke(byName['draft_write'], { draftId: 'bad', chunk: '{invalid json', mode: 'start' })
    const beforeTitle = bind.title
    const rbad = await invoke(byName['draft_commit'], { draftId: 'bad' })
    assert(rbad.includes('JSON_INVALID'), '✓ draft_commit JSON 不合法 → JSON_INVALID')
    assert(bind.title === beforeTitle, '✓ draft_commit JSON 失败 → bind 不变')
    assert('drafts/bad.json' in (vfs as any).files, '✓ draft_commit JSON 失败 → 草稿保留(可修后重 commit)')

    // draft_commit SCHEMA_INVALID(草稿保留)
    await invoke(byName['draft_write'], { draftId: 'bad2', chunk: '{"title":123,"count":5}', mode: 'start' }) // title 非 string
    const rbad2 = await invoke(byName['draft_commit'], { draftId: 'bad2' })
    assert(rbad2.includes('SCHEMA_INVALID') || /expected|string/i.test(rbad2), '✓ draft_commit schema 失败 → 结构化错误')
    assert('drafts/bad2.json' in (vfs as any).files, '✓ draft_commit schema 失败 → 草稿保留')

    // draft_commit DRAFT_NOT_FOUND
    const r404 = await invoke(byName['draft_commit'], { draftId: '不存在' })
    assert(r404.includes('DRAFT_NOT_FOUND'), '✓ draft_commit 草稿不存在 → DRAFT_NOT_FOUND')
  }

  // ===== filterByToolMode:simple 隐藏 draft,advanced 暴露 =====
  console.log('\n[draft · filterByToolMode 筛选]')
  {
    const tools = createDataOps({ schema, bind: { title: 'x', count: 0 }, description: 'x' }, { vfsStore: vfs as any })
    const simple = filterByToolMode(tools, 'simple')
    const advanced = filterByToolMode(tools, 'advanced')
    assert(!simple.some((t) => t.name === 'draft_write'), '✓ filterByToolMode simple → 隐藏 draft_write')
    assert(advanced.some((t) => t.name === 'draft_commit'), '✓ filterByToolMode advanced → 暴露 draft_commit')
  }
}
