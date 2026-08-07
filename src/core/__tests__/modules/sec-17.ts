import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../../harness/skills'
import { createPermissionsMiddleware } from '../../harness/permissions'
import { createMemoryMiddleware } from '../../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { runPool } from '../../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../../harness/verify'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../../harness/checkpoint'
import { extractText } from '../../mcp/client'
import { createInitialState as createState } from '../../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../../utils/modelCaps'
import { useContextManager } from '../../composables/useContextManager'
import { resolveContextOptions } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/dataSlotQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// checkpoint 中间件(会话级回滚:save/list/restore + 自动存档中间件)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[checkpoint 中间件]')
  {
    // 模拟 数据槽注册项 + vfs + todos + messages
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).CP = { page: { title: '原标题', theme: 'light', list: [1, 2, 3] } }
    const messages: any[] = [
      { role: 'user', content: '你好', timestamp: Date.now() },
    ]
    const vfsFiles: Record<string, any> = { 'a.txt': { content: 'AAA', bytes: 3, updatedAt: 1 } }
    const vfsStore = { files: vfsFiles } as any
    let curTodos = [{ content: 't1', status: 'pending' }]
    const todosMw = { reset: (t: any[]) => { curTodos = t.map((x) => ({ ...x })) } }
    const mgr = createCheckpointManager({
      slotPaths: ['CP.page'],
      vfsStore,
      todosMw: todosMw as any,
      getTodos: () => curTodos,
      messages: messages as any,
      maxCheckpoints: 3,
    })

    // 1. 初始无 checkpoint
    assert(mgr.list().length === 0 && !mgr.canRestore(), '初始无 checkpoint,canRestore=false')

    // 2. save → 存档(含 window 全量 + vfs + todos + messages)
    const id1 = mgr.save('auto')
    assert(mgr.list().length === 1 && mgr.canRestore(), 'save 后有 checkpoint,canRestore=true')
    assert(mgr.list()[0].label === 'auto', 'list 元信息含 label')

    // 3. 改动 window/vfs/todos/messages 后 restore → 全部还原
    ;(globalThis as any).CP.page.title = '被改坏的标题'
    ;(globalThis as any).CP.page.theme = 'dark'
    ;(globalThis as any).CP.page.list.push(99)
    delete vfsFiles['a.txt']; vfsFiles['b.txt'] = { content: 'BBB', bytes: 3, updatedAt: 2 }
    curTodos[0].status = 'completed'; curTodos.push({ content: 't2', status: 'pending' })
    messages.push({ role: 'assistant', content: '坏回复', timestamp: Date.now() })

    const ok = mgr.restore()
    assert(ok, 'restore 成功返回 true')
    assert((globalThis as any).CP.page.title === '原标题', 'restore 还原 window 标题')
    assert((globalThis as any).CP.page.theme === 'light', 'restore 还原 window theme')
    assert((globalThis as any).CP.page.list.length === 3 && !(globalThis as any).CP.page.list.includes(99), 'restore 还原 window 数组(就地清空+重填)')
    assert(Object.keys(vfsFiles).includes('a.txt') && !('b.txt' in vfsFiles), 'restore 还原 vfs(清空+重填)')
    assert(curTodos.length === 1 && curTodos[0].status === 'pending', 'restore 还原 todos')
    assert(messages.length === 1 && messages[0].content === '你好', 'restore 还原对话历史(去掉坏回复)')

    // 4. FIFO 限长:maxCheckpoints=3
    mgr.save(); mgr.save(); mgr.save(); mgr.save()
    assert(mgr.list().length === 3, 'FIFO 限长:maxCheckpoints=3,超出丢弃最旧')

    // 5. restore 指定 id
    const list = mgr.list()
    const targetId = list[0].id
    mgr.restore(targetId)
    assert(true, 'restore(id) 不抛')

    // 6. 无 checkpoint 时 restore 返回 false
    const mgr2 = createCheckpointManager({ slotPaths: [], vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
    assert(mgr2.restore() === false, '无 checkpoint 时 restore 返回 false')

    // 7. 自动存档中间件:beforeAgent 重置标记,beforeModel 首次触发 save
    const autoMgr = createCheckpointManager({ slotPaths: [], vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
    const cpMw = createCheckpointMiddleware(autoMgr)
    assert(cpMw.name === 'checkpoint', '中间件 name=checkpoint')
    // beforeAgent 返回 undefined(不修改 state)
    assert(cpMw.beforeAgent!({} as any) === undefined, 'beforeAgent 返回 undefined')
    // beforeModel 首次 → save(产生 checkpoint)
    assert(cpMw.beforeModel!({ messages: [], state: {} as any }) === undefined, 'beforeModel 返回 undefined')
    assert(autoMgr.list().length === 1, 'beforeModel 首次触发 save')
    // beforeModel 再次(同轮)→ 不重复 save
    cpMw.beforeModel!({ messages: [], state: {} as any })
    assert(autoMgr.list().length === 1, '同轮 beforeModel 再次不重复 save')
    // beforeAgent 重置标记 → 下一轮 beforeModel 再次 save
    cpMw.beforeAgent!({} as any)
    cpMw.beforeModel!({ messages: [], state: {} as any })
    assert(autoMgr.list().length === 2, '下一轮 beforeAgent 重置后 beforeModel 再次 save')

    // 清理
    delete (globalThis as any).CP
    delete (globalThis as any).window
  }

  // 单对象 data 模式:getData 快照/回滚 bind(不挂 window)
  {
    console.log('\n[checkpoint getData(单对象 data 模式)]')
    const bind: any = { title: '原标题', theme: 'light', list: [1, 2, 3] }
    const messages: any[] = [{ role: 'user', content: '你好', timestamp: Date.now() }]
    const vfsStore = { files: {} } as any
    const todosMw = { reset: (_t: any[]) => {} }
    const mgr = createCheckpointManager({
      getData: () => bind,
      vfsStore,
      todosMw: todosMw as any,
      getTodos: () => [],
      messages: messages as any,
      maxCheckpoints: 3,
    })
    const id = mgr.save('auto')
    assert(mgr.list().length === 1 && mgr.list()[0].label === 'auto', 'getData 模式 save 存档')
    // 改坏 bind
    bind.title = '被改坏'
    bind.theme = 'dark'
    bind.list.push(99)
    bind.extra = '不该保留'
    delete bind.title
    const ok = mgr.restore()
    assert(ok, 'getData 模式 restore 成功')
    assert(bind.title === '原标题', 'getData 模式 restore 还原 bind.title(就地还原保留 reactive 引用)')
    assert(bind.theme === 'light', 'getData 模式 restore 还原 bind.theme')
    assert(bind.list.length === 3 && !bind.list.includes(99), 'getData 模式 restore 还原 bind.list(就地清空+重填)')
    assert(!('extra' in bind), 'getData 模式 restore 删除快照后新增的 key(restoreInPlace 语义)')
  }

  // automation 断点续跑:exportStack/importStack(持久化 checkpoint 栈,刷新/崩溃后恢复 restoreLastCheckpoint 能力)
  {
    console.log('\n[checkpoint exportStack/importStack(automation 断点续跑)]')
    const bind: any = { title: '原标题', theme: 'light' }
    const messages: any[] = [{ role: 'user', content: '你好', timestamp: Date.now() }]
    const vfsStore = { files: { 'a.txt': { content: 'A', bytes: 1, updatedAt: 1 } } } as any
    const todosMw = { reset: (_t: any[]) => {} }
    const mgr = createCheckpointManager({
      getData: () => bind, vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: messages as any,
    })
    mgr.save('round1'); mgr.save('round2')
    assert(mgr.list().length === 2, 'exportStack 前:2 个 checkpoint')
    // 导出栈快照(深拷贝,可序列化)
    const stack = mgr.exportStack()
    assert(Array.isArray(stack) && stack.length === 2, 'exportStack 返回数组,长度 = 栈长')
    assert(stack[0].messages && stack[0].windowVals, 'exportStack 元素含 messages + windowVals(可序列化结构)')
    assert(JSON.parse(JSON.stringify(stack)).length === 2, 'exportStack 结果可 JSON 序列化(持久化往返)')
    assert(mgr.list().length === 2, 'exportStack 不影响原栈(深拷贝隔离)')
    // 新 mgr 灌入快照 → 恢复栈 + canRestore=true
    const mgr2 = createCheckpointManager({
      getData: () => bind, vfsStore: { files: {} } as any, todosMw: todosMw as any, getTodos: () => [], messages: [] as any,
    })
    assert(mgr2.list().length === 0 && !mgr2.canRestore(), 'importStack 前:空栈')
    mgr2.importStack(stack)
    assert(mgr2.list().length === 2 && mgr2.canRestore(), 'importStack 恢复栈(2 个 checkpoint)+ canRestore=true')
    // 灌入后 restore 能用(回退到最近 checkpoint,内容完整)
    bind.title = '改坏'
    const ok = mgr2.restore()
    assert(ok && bind.title === '原标题', 'importStack 后 restore 正常回退(栈内容完整可用)')
    // nextId 重置:后续 save 的 id > 栈最大 id(不冲突)
    const beforeMax = Math.max(...mgr2.list().map((c: any) => c.id))
    mgr2.save('after-import')
    const newId = mgr2.list().find((c: any) => c.label === 'after-import')!.id
    assert(newId > beforeMax, 'importStack 后 save 的 id > 栈最大 id(nextId 重置防冲突)')
    // 脏数据过滤:缺 messages 的元素不灌入;非数组不抛
    const mgr3 = createCheckpointManager({ getData: () => bind, vfsStore: { files: {} } as any, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
    mgr3.importStack([{ foo: 1 }, null, { id: 5 }] as any)
    assert(mgr3.list().length === 0, 'importStack 过滤脏数据(缺 messages 不灌入)')
    mgr3.importStack(undefined as any)
    assert(mgr3.list().length === 0, 'importStack 非数组不抛(空栈)')
    // id 类型校验(bug-review LOW:脏数据 cp.id 字符串 → Math.max 成 NaN → nextId=NaN → 后续 save 产出 NaN id)
    const mgr4 = createCheckpointManager({ getData: () => bind, vfsStore: { files: {} } as any, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
    mgr4.importStack([{ id: 'bad', messages: [] }, { id: 5, messages: [] }] as any)
    assert(mgr4.list().length === 1, 'importStack 过滤非数字 id(字符串 id 不灌入,防 nextId=NaN)')

    // session-history S1:importStack([]) 清栈(切会话/清空聊天防旧 checkpoint 残留污染新会话)
    const mgr5 = createCheckpointManager({ getData: () => bind, vfsStore: { files: {}, consumeDirty: () => true } as any, todosMw: todosMw as any, getTodos: () => [], messages: [] as any })
    mgr5.save('r1')
    mgr5.save('r2')
    assert(mgr5.list().length === 2 && mgr5.canRestore() === true, 'S1 前置:save 2 个 checkpoint')
    mgr5.importStack([])
    assert(mgr5.list().length === 0 && mgr5.canRestore() === false, 'S1 importStack([]) → 清空栈 + canRestore=false(切会话不再回退到旧会话)')
    // 清栈后 save 的 id 从 1 起(空栈 reduce 初值 0 + 1 = 1;防旧栈 id 冲突)
    const newId5 = mgr5.save('r3')
    assert(newId5 === 1 && mgr5.list().length === 1, 'S1 清栈后 save id 重置从 1(空栈 nextId=0+1)')
  }

  // vfs 脏标记增量(checkpoint save 省 8MB 深拷贝;vfsStore 写经 Proxy 统一标脏,零遗漏)
  {
    console.log('\n[checkpoint vfs 脏标记增量]')
    const vfsStore = createVfs({ 'a.txt': 'AAA' })
    const todosMw = { reset: (_t: any[]) => {} }
    const mgr = createCheckpointManager({
      vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any,
    })
    assert(vfsStore.isDirty!() === true, 'vfs 初始脏=true(首次 save 必 clone 建立基线)')
    mgr.save('r1')  // consume 初始脏 → clone 建立基线
    assert(vfsStore.isDirty!() === false, 'save 消费脏后 isDirty=false')
    mgr.save('r2')  // 无 vfs 写 → consumeDirty=false → 复用 r1 clone
    let stack = mgr.exportStack()
    const cp1 = stack.find((c: any) => c.label === 'r1')!
    const cp2 = stack.find((c: any) => c.label === 'r2')!
    assert(cp1.vfs === cp2.vfs, 'vfs 未变轮:两 checkpoint 共享同一 clone 引用(省 8MB 深拷贝)')
    assert(cp1.vfs['a.txt']?.content === 'AAA', '共享 clone 内容正确(a.txt=AAA)')
    vfsStore.files['b.txt'] = { content: 'BBB', updatedAt: 1 }
    assert(vfsStore.isDirty!() === true, 'vfs 写 files[k]= → Proxy 标脏')
    mgr.save('r3')  // 标脏 → 新 clone
    stack = mgr.exportStack()
    const cp3 = stack.find((c: any) => c.label === 'r3')!
    assert(cp3.vfs !== cp2.vfs, 'vfs 写后 save:新 clone(引用变)')
    assert(cp3.vfs['b.txt']?.content === 'BBB', '新 clone 含写入的 b.txt')
    vfsStore.files['c.txt'] = { content: 'CCC', updatedAt: 2 }
    mgr.restore(cp2.id)  // restore 到未变轮 r2(vfs 只 a.txt)
    assert('a.txt' in vfsStore.files && !('b.txt' in vfsStore.files) && !('c.txt' in vfsStore.files), 'restore 到未变轮 r2:vfs 正确还原(共享引用 restore 安全)')
  }

  // bind 脏标记增量(dataOps controller:写路径标脏,dryRun/只读不标;commitSetToBind onWrite 收敛 set 类)
  {
    console.log('\n[checkpoint bind 脏标记增量]')
    const schema = z.object({ title: z.string(), count: z.number() })
    const bind: any = { title: '原标题', count: 1 }
    const tools = createDataOps({ schema, bind, description: '测试' })
    const controller = (tools as any).controller
    assert(controller.consumeDataDirty() === true, 'bind 初始脏=true(首次 save 必 clone 基线)')
    const names = byName(tools)
    await invoke(names['set_data'], { value: { title: 'set改', count: 2 } })
    assert(controller.consumeDataDirty() === true, 'set_data 写 bind → 标脏(commitSetToBind onWrite)')
    await invoke(names['edit_data'], { op: 'set', jsonPath: 'title', value: 'edit改' })
    assert(controller.consumeDataDirty() === true, 'edit_data 写 bind → 标脏')
    await invoke(names['get_data'], { jsonPath: 'title' })
    assert(controller.consumeDataDirty() === false, 'get_data 只读 → 不标脏')
    await invoke(names['write'], { value: { title: 'write改', count: 3 } })
    assert(controller.consumeDataDirty() === true, 'write(set) 写 bind → 标脏')
    await invoke(names['write'], { value: { title: 'dryrun', count: 3 }, dryRun: true })
    assert(controller.consumeDataDirty() === false, 'write(dryRun) 预检不落盘 → 不标脏')
    await invoke(names['delete_data'], { jsonPath: 'count' })
    assert(controller.consumeDataDirty() === true, 'delete_data 写 bind → 标脏')
    controller.set({ schema, bind: { title: '新bind', count: 9 }, description: '换' })
    assert(controller.consumeDataDirty() === true, 'controller.set 替换 bind → 标脏(下次 save 必 clone 新基线)')
  }

  // 跨轮 restore 一致性(增量正确性核心:写→save→写→save→restore(id1/id2/id3)→数据一致;漏标脏/缓存基线错会在此暴露)
  {
    console.log('\n[checkpoint 跨轮 restore 一致性(增量正确性核心)]')
    const schema = z.object({ title: z.string(), items: z.array(z.string()) })
    const bind: any = { title: 'v0', items: ['a'] }
    const tools = createDataOps({ schema, bind, description: '测试' })
    const controller = (tools as any).controller
    const vfsStore = createVfs()
    const todosMw = { reset: (_t: any[]) => {} }
    const mgr = createCheckpointManager({
      getData: () => bind,
      consumeDataDirty: () => controller.consumeDataDirty() ?? true,
      vfsStore, todosMw: todosMw as any, getTodos: () => [], messages: [] as any,
    })
    const names = byName(tools)
    // 轮1:write v1 + vfs f1 + save(id1)
    await invoke(names['write'], { value: { title: 'v1', items: ['a'] } })
    vfsStore.files['f1'] = { content: 'F1', updatedAt: 1 }
    const id1 = mgr.save('round1')
    // 轮2:write v2 + save(id2)(vfs 未变 → 复用 id1 vfs clone)
    await invoke(names['write'], { value: { title: 'v2', items: ['a', 'b'] } })
    const id2 = mgr.save('round2')
    // 轮3:write v3 + save(id3)
    await invoke(names['write'], { value: { title: 'v3', items: ['a', 'b', 'c'] } })
    const id3 = mgr.save('round3')
    // restore(id1) → v1 + items[a] + vfs f1
    mgr.restore(id1)
    assert(bind.title === 'v1', 'restore(id1) bind.title=v1')
    assert(bind.items.length === 1 && bind.items[0] === 'a', 'restore(id1) items=[a]')
    assert(vfsStore.files['f1']?.content === 'F1', 'restore(id1) vfs f1 还原')
    // restore(id2) → v2 + items[a,b] + vfs f1(未变轮共享 clone 正确)
    mgr.restore(id2)
    assert(bind.title === 'v2', 'restore(id2) bind.title=v2')
    assert(bind.items.length === 2, 'restore(id2) items 长度=2')
    assert(vfsStore.files['f1']?.content === 'F1', 'restore(id2) vfs f1 仍在(未变轮共享 clone 正确)')
    // restore(id3) → v3 + items[a,b,c]
    mgr.restore(id3)
    assert(bind.title === 'v3', 'restore(id3) bind.title=v3')
    assert(bind.items.length === 3, 'restore(id3) items 长度=3')
    // restore 后再 save:基线重建(restore 改 bind 不经 dataOps 脏标记,靠 lastBindClone 重置兜底;无此则静默错乱)
    await invoke(names['write'], { value: { title: 'v4', items: ['x'] } })
    const id4 = mgr.save('round4')
    mgr.restore(id4)
    assert(bind.title === 'v4' && bind.items.length === 1, 'restore 后 save(id4) 再 restore:title=v4/items=[x](基线重建正确,无错乱)')
  }
}
