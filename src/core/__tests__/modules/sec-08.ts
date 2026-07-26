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

// middleware 执行器
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[middleware executor]')
  {
    const s = applyUpdate(createState(), { memory: 'x' })
    assert(s.memory === 'x', 'applyUpdate 合并更新')

    const order: string[] = []
    const mws = [
      { name: 'a', beforeAgent: () => { order.push('a'); return undefined } },
      { name: 'b', beforeAgent: () => { order.push('b'); return undefined } },
    ] as any
    await runBeforeAgent(mws, createState())
    assert(order[0] === 'a' && order[1] === 'b', 'beforeAgent 正序执行')

    const afterOrder: string[] = []
    const mws2 = [
      { name: 'a', afterModel: () => { afterOrder.push('a'); return undefined } },
      { name: 'b', afterModel: () => { afterOrder.push('b'); return undefined } },
    ] as any
    runAfterModel(mws2, { message: {} as any, toolCalls: [], content: '' }, createState())
    assert(afterOrder[0] === 'b' && afterOrder[1] === 'a', 'afterModel 逆序执行')
  }

  // ============ storage(持久化 + 配额 + 淘汰 + 隔离)============
  console.log('\n[storage]')
  {
    // 纯函数
    assert(encodeKey('db', 'a1', 's1', 'messages') === 'v:1::db::a1::s1::messages', 'encodeKey 复合前缀')
    assert(estimateBytes({ a: '中' }) > 0, 'estimateBytes 中文+对象 > 0')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    assert(estimateBytes(cyclic) === 0, 'estimateBytes 不可序列化(循环引用)返回 0')

    // isQuotaError(运行时降级判定)
    assert(isQuotaError({ name: 'QuotaExceededError' }) === true, 'isQuotaError 识别 QuotaExceededError')
    assert(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }) === true, 'isQuotaError 识别 Firefox 配额错误名')
    assert(isQuotaError(new Error('x')) === false, 'isQuotaError 普通错误返回 false')
    assert(isQuotaError(null) === false, 'isQuotaError null 安全返回 false')

    // 默认配额按后端类型(WebStorage 贴合浏览器 ~5MB 上限并留余量)
    assert(defaultMaxBytesFor('local') === 4 * 1024 * 1024 && defaultMaxBytesFor('session') === 4 * 1024 * 1024, '默认配额:local/session = 4MB')
    assert(defaultMaxBytesFor('indexed') === 50 * 1024 * 1024 && defaultMaxBytesFor('memory') === 50 * 1024 * 1024, '默认配额:indexed/memory = 50MB')

    // LRU 选择
    const metas = [
      { agentId: 'a', sessionId: '1', createdAt: 0, lastAccessed: 1, bytes: 60 },
      { agentId: 'a', sessionId: '2', createdAt: 0, lastAccessed: 2, bytes: 60 },
      { agentId: 'a', sessionId: '3', createdAt: 0, lastAccessed: 3, bytes: 60 },
    ]
    const victims = selectForEviction(metas, 100, 0.9)
    assert(victims.length === 2 && victims[0].sessionId === '1', 'selectForEviction LRU 淘汰最旧两个')

    // MemoryBackend 基本读写
    const mb = createMemoryBackend()
    await mb.set('k', { x: 1 })
    assert((((await mb.get('k')) as { x: number } | undefined)?.x) === 1, 'MemoryBackend set/get')
    await mb.set('k2', 2)
    await mb.del('k2')
    assert((await mb.get('k2')) === undefined, 'MemoryBackend del')
    await mb.set('pre_a', 1)
    await mb.set('pre_b', 2)
    await mb.set('other', 3)
    await mb.clearPrefix('pre_')
    assert((await mb.get('pre_a')) === undefined && (await mb.get('other')) === 3, 'MemoryBackend clearPrefix 范围删')

    // SessionStore(无 indexedDB 环境自动降级 memory)
    const s = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 1000000, debounceMs: 10 })
    await s.ready
    const sid1 = await s.createSession('agentA')
    await s.save('agentA', sid1, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] })
    await s.flush()
    const snap1 = await s.load('agentA', sid1)
    assert(!!snap1 && snap1.messages.length === 1 && snap1.messages[0].content === 'hi', 'save/load 对话历史 round-trip')

    // agentB 隔离 agentA
    const sid2 = await s.createSession('agentB')
    const snap2 = await s.load('agentB', sid2)
    assert(snap2 === undefined || (snap2.messages?.length ?? 0) === 0, 'agentB 隔离 agentA 数据')

    // listSessions 按 agentId 过滤
    const list = await s.listSessions('agentA')
    assert(list.length === 1 && list[0].sessionId === sid1, 'listSessions 按 agentId 过滤')

    // deleteSession 后 load 返回 undefined
    await s.deleteSession('agentA', sid1)
    assert((await s.load('agentA', sid1)) === undefined, 'deleteSession 后 load 返回 undefined')

    // debounce + flush:连续 save 同 kind 只落最后值
    const s4 = createSessionStore({ debounceMs: 100 })
    await s4.ready
    const sid4 = await s4.createSession('d')
    await s4.save('d', sid4, { memory: 'first' })
    await s4.save('d', sid4, { memory: 'second' })
    await s4.flush()
    const snap4 = await s4.load('d', sid4)
    assert(snap4?.memory === 'second', 'debounce:连续 save 同 kind 只落最后值(flush 立即)')

    // 单会话软上限:超限拒写 + quota 事件
    const s3 = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 100, debounceMs: 10 })
    await s3.ready
    let quotaHit = false
    s3.onEvent((e) => {
      if (e.type === 'quota') quotaHit = true
    })
    const sid3 = await s3.createSession('q')
    await s3.save('q', sid3, { memory: 'X'.repeat(200) })
    await s3.flush()
    const snap3 = await s3.load('q', sid3)
    assert(quotaHit && (!snap3 || snap3.memory === ''), '单会话超软上限 → quota 事件 + memory 拒写')

    // LRU 淘汰:小配额下多会话,最旧被整会话删
    const s2 = createSessionStore({ maxBytes: 300, maxBytesPerSession: 1000000, debounceMs: 10 })
    await s2.ready
    const a = await s2.createSession('x')
    await s2.save('x', a, { memory: 'A'.repeat(200) })
    await s2.flush()
    const b = await s2.createSession('x')
    await s2.save('x', b, { memory: 'B'.repeat(200) })
    await s2.flush()
    const c = await s2.createSession('x')
    await s2.save('x', c, { memory: 'C'.repeat(200) })
    await s2.flush()
    assert((await s2.load('x', a)) === undefined, 'LRU 淘汰最旧会话 a')
    assert((await s2.load('x', b)) === undefined, 'LRU 淘汰次旧会话 b')
    assert((await s2.load('x', c)) !== undefined, '最新会话 c 保留')

    // 降级:无 indexedDB 环境 ready=false + degraded 事件
    const s5 = createSessionStore()
    let degraded = false
    s5.onEvent((e) => {
      if (e.type === 'degraded') degraded = true
    })
    const ok5 = await s5.ready
    assert(ok5 === false && degraded, '无 indexedDB → 降级 memory(ready=false + degraded 事件)')

    // 并发 commit 不丢 meta 增量(同会话多 kind 并发 save → per-session 串行队列保证)
    const s6 = createSessionStore({ maxBytes: 1000000, maxBytesPerSession: 1000000, debounceMs: 10 })
    await s6.ready
    const sid6 = await s6.createSession('c')
    await Promise.all([
      s6.save('c', sid6, { messages: [{ role: 'user', content: 'm'.repeat(100), timestamp: 1 }] }),
      s6.save('c', sid6, { todos: [{ content: 't'.repeat(100), status: 'pending' }] }),
      s6.save('c', sid6, { memory: 'M'.repeat(100) }),
    ])
    await s6.flush()
    const list6 = await s6.listSessions('c')
    assert(list6.length === 1 && list6[0].bytes > 280, '并发 commit:多 kind 并发 save 不丢 meta 增量(>280 字节)')

    // 手选后端:sessionStorage(mock)与显式 memory
    const mockStorage = () => {
      const m = new Map<string, string>()
      return {
        get length() {
          return m.size
        },
        key: (i: number) => Array.from(m.keys())[i] ?? null,
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => {
          m.set(k, v)
        },
        removeItem: (k: string) => {
          m.delete(k)
        },
        clear: () => {
          m.clear()
        },
      }
    }
    ;(globalThis as any).sessionStorage = mockStorage()
    const s7 = createSessionStore({ backend: 'session', debounceMs: 10 })
    const ok7 = await s7.ready
    assert(ok7 === true, 'backend:session → ready=true(持久)')
    const sid7 = await s7.createSession('web')
    await s7.save('web', sid7, { memory: 'hello' })
    await s7.flush()
    const snap7 = await s7.load('web', sid7)
    assert(snap7?.memory === 'hello', 'backend:session → sessionStorage save/load round-trip')

    let memDegraded = false
    const s8 = createSessionStore({ backend: 'memory' })
    s8.onEvent((e) => {
      if (e.type === 'degraded') memDegraded = true
    })
    const ok8 = await s8.ready
    assert(ok8 === false && !memDegraded, 'backend:memory → 显式内存后端(ready=false,非降级不触发 degraded)')

    // 运行时 QuotaExceeded:mock sessionStorage setItem 超量抛错 → 淘汰最旧 + 降级 memory + degraded 事件 + 数据不丢
    const quotaStorage = () => {
      const m = new Map<string, string>()
      return {
        get length() {
          return m.size
        },
        key: (i: number) => Array.from(m.keys())[i] ?? null,
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => {
          if (m.size >= 2) {
            // 模拟浏览器配额超限
            const e = new Error('quota exceeded')
            ;(e as Error & { name: string }).name = 'QuotaExceededError'
            throw e
          }
          m.set(k, v)
        },
        removeItem: (k: string) => {
          m.delete(k)
        },
        clear: () => {
          m.clear()
        },
      }
    }
    ;(globalThis as any).sessionStorage = quotaStorage()
    const s9 = createSessionStore({ backend: 'session', debounceMs: 10 })
    let runtimeDegraded = false
    s9.onEvent((e) => {
      if (e.type === 'degraded') runtimeDegraded = true
    })
    await s9.ready
    const sid9 = await s9.createSession('q9') // 写 1 条 meta
    await s9.save('q9', sid9, { memory: 'X'.repeat(50) }) // 写 memory 成功 + 写 meta 撞配额
    await s9.flush()
    await new Promise((r) => setTimeout(r, 20)) // 等 degraded emit 的微任务
    const snap9 = await s9.load('q9', sid9)
    assert(runtimeDegraded && snap9?.memory === 'X'.repeat(50), '运行时 QuotaExceeded → 淘汰+降级 memory(degraded 事件)+ 数据不丢(load 可读)')

    // backend:local → localStorage round-trip(对称已测的 session;IdbBackend 需真实 IndexedDB,仅手动验证)
    ;(globalThis as any).localStorage = mockStorage()
    const s10 = createSessionStore({ backend: 'local', debounceMs: 10 })
    assert((await s10.ready) === true, 'backend:local → ready=true(持久,路由 localStorage)')
    const sid10 = await s10.createSession('weblocal')
    await s10.save('weblocal', sid10, { memory: 'hello-local' })
    await s10.flush()
    const snap10 = await s10.load('weblocal', sid10)
    assert(snap10?.memory === 'hello-local', 'backend:local → localStorage save/load round-trip')
  }
}
