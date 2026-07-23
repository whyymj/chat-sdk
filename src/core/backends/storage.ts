/**
 * 持久化存储 —— IndexedDB(降级内存)+ 三层命名空间隔离 + 全局配额/LRU 淘汰
 *
 * 三层 key:v:1::{dbName}::{agentId}::{sessionId}::{kind}
 *   kind ∈ {messages, vfs, todos, memory, __meta__}
 *   每会话恰好 5 条记录;删整会话 = clearPrefix("...::{sessionId}::"),游标逐条精确删。
 *
 * 架构(可注入后端,为可测 + 零成本降级):
 *   SessionStore(纯编排:key 编码 / 字节估算 / debounce / 配额 meta / 单会话软上限 / LRU 选择)
 *     └ StorageBackend(注入):IdbBackend(浏览器原生)/ MemoryBackend(Map,测试 + 降级共用)
 *
 * 并发安全:同一会话的 meta 读-改-写经 per-session 串行队列(runSerial),避免 lost-update;
 *   不同会话并行。debouncedSave 被同 kind 后续 save 取代时立即 resolve 旧 Promise(不挂起)。
 */
import type { AgentMessage } from '../types'
import type { VfsFile, Todo } from '../harness/state'
import { makeId } from '../utils/id'

// ===== 默认值 =====
const DEFAULT_DB_NAME = 'page-agent'
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024 // indexed/memory 默认全局总配额 50MB
const DEFAULT_WEB_STORAGE_MAX_BYTES = 4 * 1024 * 1024 // local/session 默认配额 4MB(浏览器 WebStorage ~5MB,留余量给宿主页)
const DEFAULT_MAX_BYTES_PER_SESSION = 10 * 1024 * 1024 // 单会话软上限 10MB
const DEFAULT_WATERMARK = 0.9 // 淘汰到 0.9*maxBytes 留余量
const DEFAULT_DEBOUNCE_MS = 500
const EVICT_DELAY_MS = 300
const META_KIND = '__meta__'
const KEY_PREFIX = 'v:1'

type SnapshotKind = 'messages' | 'vfs' | 'todos' | 'memory'
const SNAPSHOT_KINDS: SnapshotKind[] = ['messages', 'vfs', 'todos', 'memory']

// ===== 数据结构 =====
export interface SessionMeta {
  agentId: string
  sessionId: string
  createdAt: number
  /** LRU 依据:每次 load/save 刷新 */
  lastAccessed: number
  /** 本会话 messages+vfs+todos+memory 四 kind 字节和 */
  bytes: number
  title?: string
}

export interface SessionSnapshot {
  messages: AgentMessage[]
  vfs: Record<string, VfsFile>
  todos: Todo[]
  memory: string
}

/** 后端类型:indexed(默认,大容量)/ session(sessionStorage,刷新保留关页清)/ local(localStorage,跨页持久)/ memory(纯内存,降级用) */
export type StorageBackendType = 'indexed' | 'session' | 'local' | 'memory'

export interface StorageConfig {
  /** 后端类型,默认 'indexed' */
  backend?: StorageBackendType
  /** 是否启用(默认 true;false 等同 storage:false 关闭) */
  enabled?: boolean
  /** DB 命名空间,默认 'page-agent'(作为 key 前缀段) */
  dbName?: string
  /** 全局总配额(字节),默认 50MB */
  maxBytes?: number
  /** 单会话软上限(字节),默认 10MB;超限拒写该 kind 并回调 */
  maxBytesPerSession?: number
  /** 淘汰水位(0-1),默认 0.9 */
  evictionWatermark?: number
  /** 落盘 debounce(ms),默认 500 */
  debounceMs?: number
}

export type StorageEvent =
  | { type: 'degraded'; reason: string }
  | { type: 'quota'; sessionBytes: number; limit: number }
  | { type: 'evicted'; agentId: string; sessionId: string; bytes: number }
  | { type: 'flush' }

export interface SessionStore {
  /** resolve=false 表示已降级到内存(非持久) */
  ready: Promise<boolean>
  listSessions(agentId: string): Promise<SessionMeta[]>
  load(agentId: string, sessionId: string): Promise<SessionSnapshot | undefined>
  save(agentId: string, sessionId: string, snap: Partial<SessionSnapshot>): Promise<void>
  flush(): Promise<void>
  deleteSession(agentId: string, sessionId: string): Promise<void>
  createSession(agentId: string, title?: string, sessionId?: string): Promise<string>
  onEvent(cb: (e: StorageEvent) => void): void
  /** 释放:清所有 timer + resolve pending + 清监听器 + 关连接 */
  dispose(): void
}

// ===== 后端接口(注入点)=====
export interface StorageBackend {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  /** 范围扫描(粗筛 + JS 层 startsWith 精确);cb 返回 false 停止 */
  scan(prefix: string, cb: (key: string, value: unknown) => boolean | void): Promise<void>
  /** 范围删除(游标逐条 startsWith 精确删) */
  clearPrefix(prefix: string): Promise<void>
}

/** 后端类型 → 默认全局配额(WebStorage 贴合浏览器 ~5MB 上限并留余量,避免运行时频繁 QuotaExceeded) */
export function defaultMaxBytesFor(backendType: StorageBackendType): number {
  return backendType === 'local' || backendType === 'session' ? DEFAULT_WEB_STORAGE_MAX_BYTES : DEFAULT_MAX_BYTES
}

/** 判断是否存储配额超限错误(QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED / legacy code) */
export function isQuotaError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as { name?: string; code?: number }
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  return e.code === 22 || e.code === 1014 // DOMException.QUOTA_ERR(legacy)
}

// ===== 纯函数:key 编码 / 字节估算 / LRU 选择(可单测)=====
export function encodeKey(dbName: string, agentId: string, sessionId: string, kind: string): string {
  return [KEY_PREFIX, dbName, agentId, sessionId, kind].join('::')
}
function sessionPrefix(dbName: string, agentId: string, sessionId: string): string {
  return [KEY_PREFIX, dbName, agentId, sessionId].join('::') + '::'
}
function agentPrefix(dbName: string, agentId: string): string {
  return [KEY_PREFIX, dbName, agentId].join('::') + '::'
}
function globalPrefix(dbName: string): string {
  return [KEY_PREFIX, dbName].join('::') + '::'
}

let _encoder: TextEncoder | null = null
/** JSON 序列化后的 UTF-8 字节长度(与 MemoryBackend 一致,跨后端可比) */
export function estimateBytes(value: unknown): number {
  if (!_encoder) _encoder = new TextEncoder()
  try {
    return _encoder.encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

/** 选择需淘汰的会话(按 lastAccessed 升序 = 最旧优先),使总量降到 ≤ maxBytes*watermark */
export function selectForEviction(metas: SessionMeta[], maxBytes: number, watermark: number): SessionMeta[] {
  let total = metas.reduce((s, m) => s + m.bytes, 0)
  if (total <= maxBytes) return []
  const target = maxBytes * watermark
  const sorted = [...metas].sort((a, b) => a.lastAccessed - b.lastAccessed)
  const victims: SessionMeta[] = []
  for (const m of sorted) {
    if (total <= target) break
    victims.push(m)
    total -= m.bytes
  }
  return victims
}

// ===== MemoryBackend(测试 + 降级共用)=====
export function createMemoryBackend(): StorageBackend {
  const map = new Map<string, unknown>()
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : undefined
    },
    async set(key, value) {
      map.set(key, value)
    },
    async del(key) {
      map.delete(key)
    },
    async scan(prefix, cb) {
      for (const k of Array.from(map.keys()).sort()) {
        if (k.startsWith(prefix)) {
          if (cb(k, map.get(k)) === false) return
        }
      }
    },
    async clearPrefix(prefix) {
      for (const k of Array.from(map.keys())) {
        if (k.startsWith(prefix)) map.delete(k)
      }
    },
  }
}

// ===== IdbBackend(浏览器原生 IndexedDB)=====
export function createIdbBackend(dbName: string): Promise<StorageBackend> {
  return new Promise<StorageBackend>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB 不可用'))
      return
    }
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv') // out-of-line keys
    }
    req.onblocked = () => reject(new Error('indexedDB 升级被阻塞,请关闭其他标签页后重试'))
    req.onsuccess = () => {
      const db = req.result
      // 未来版本升级时,旧连接收到 versionchange → 主动 close(避免进入 invalid 态后写盘静默失败)
      db.onversionchange = () => {
        db.close()
      }
      const backend: StorageBackend = {
        get(key) {
          return new Promise((res, rej) => {
            const r = db.transaction('kv', 'readonly').objectStore('kv').get(key)
            r.onsuccess = () => res(r.result)
            r.onerror = () => rej(r.error)
          })
        },
        set(key, value) {
          return new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite')
            tx.objectStore('kv').put(value, key)
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
            tx.onabort = () => rej(tx.error)
          })
        },
        del(key) {
          return new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite')
            tx.objectStore('kv').delete(key)
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
            tx.onabort = () => rej(tx.error)
          })
        },
        scan(prefix, cb) {
          return new Promise((res, rej) => {
            let stopped = false
            const tx = db.transaction('kv', 'readonly')
            const range = IDBKeyRange.bound(prefix, prefix + '￿')
            const cur = tx.objectStore('kv').openCursor(range)
            cur.onsuccess = () => {
              const c = cur.result
              if (!c || stopped) return
              const key = c.key as string
              // range 仅粗筛,JS 层 startsWith 精确过滤(防前缀碰撞,如 sess1 vs sess1a)
              if (key.startsWith(prefix)) {
                if (cb(key, c.value) === false) {
                  stopped = true
                  return
                }
              }
              c.continue()
            }
            cur.onerror = () => rej(cur.error)
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
            tx.onabort = () => rej(tx.error)
          })
        },
        clearPrefix(prefix) {
          return new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite')
            const range = IDBKeyRange.bound(prefix, prefix + '￿')
            const cur = tx.objectStore('kv').openCursor(range)
            cur.onsuccess = () => {
              const c = cur.result
              if (!c) return
              if ((c.key as string).startsWith(prefix)) c.delete()
              c.continue()
            }
            cur.onerror = () => rej(cur.error)
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
            tx.onabort = () => rej(tx.error)
          })
        },
      }
      resolve(backend)
    }
    req.onerror = () => reject(req.error)
  })
}

/** WebStorage 后端(localStorage/sessionStorage 适配 StorageBackend 接口;同步 API 包 Promise) */
export function createWebStorageBackend(storage: Storage): StorageBackend {
  return {
    async get(key) {
      const v = storage.getItem(key)
      return v == null ? undefined : JSON.parse(v)
    },
    async set(key, value) {
      storage.setItem(key, JSON.stringify(value))
    },
    async del(key) {
      storage.removeItem(key)
    },
    async scan(prefix, cb) {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k && k.startsWith(prefix)) keys.push(k)
      }
      keys.sort()
      for (const k of keys) {
        const raw = storage.getItem(k)
        if (raw != null && cb(k, JSON.parse(raw)) === false) return
      }
    },
    async clearPrefix(prefix) {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k && k.startsWith(prefix)) keys.push(k)
      }
      for (const k of keys) storage.removeItem(k)
    },
  }
}

/** per-key 串行队列:同一 metaKey 的 read-modify-write 不并发(防 lost-update) */
function runSerial<T>(chains: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

// ===== SessionStore(编排层)=====
export function createSessionStore(config: StorageConfig = {}): SessionStore {
  const dbName = config.dbName ?? DEFAULT_DB_NAME
  const backendType = config.backend ?? 'indexed'
  const maxBytes = config.maxBytes ?? defaultMaxBytesFor(backendType)
  const maxBytesPerSession = config.maxBytesPerSession ?? DEFAULT_MAX_BYTES_PER_SESSION
  const watermark = config.evictionWatermark ?? DEFAULT_WATERMARK
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS

  const listeners = new Set<(e: StorageEvent) => void>()
  function emit(e: StorageEvent): void {
    for (const cb of listeners) {
      try {
        cb(e)
      } catch {
        /* 监听器异常不影响存储 */
      }
    }
  }

  let backend: StorageBackend
  let degradedToMemory = false // 运行时撞配额后一次性降级标志(避免反复重试)
  let readyResolve!: (v: boolean) => void
  const ready = new Promise<boolean>((r) => {
    readyResolve = r
  })

  // 启动:按 backend 类型选后端;不可用降级 memory(永不冒泡)
  ;(async () => {
    try {
      if (backendType === 'indexed') {
        if (typeof indexedDB === 'undefined') throw new Error('indexedDB 不可用')
        backend = await createIdbBackend(dbName)
        readyResolve(true)
      } else if (backendType === 'session') {
        if (typeof sessionStorage === 'undefined') throw new Error('sessionStorage 不可用')
        backend = createWebStorageBackend(sessionStorage)
        readyResolve(true)
      } else if (backendType === 'local') {
        if (typeof localStorage === 'undefined') throw new Error('localStorage 不可用')
        backend = createWebStorageBackend(localStorage)
        readyResolve(true)
      } else {
        // 'memory':显式内存后端(非持久,ready=false,不触发 degraded)
        backend = createMemoryBackend()
        readyResolve(false)
      }
    } catch (err: unknown) {
      backend = createMemoryBackend()
      const reason = err instanceof Error ? err.message : String(err)
      readyResolve(false)
      // 延迟到微任务:确保 createSessionStore 返回、onEvent 注册后再 emit,避免事件丢失
      Promise.resolve().then(() => emit({ type: 'degraded', reason }))
    }
  })()

  // pending debounce:per kind 保留最新值 + 其 resolve 句柄(被取代时立即 resolve,不挂起)
  interface Pending {
    value: unknown
    agentId: string
    sessionId: string
    kind: SnapshotKind
    resolve: () => void
  }
  const pending = new Map<string, Pending>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const chains = new Map<string, Promise<unknown>>()

  /** 实际写入 + meta 增量 + 单会话软上限 + 触发淘汰(经 per-session 串行队列) */
  function commit(fullKey: string, value: unknown, agentId: string, sessionId: string): Promise<void> {
    const metaKey = encodeKey(dbName, agentId, sessionId, META_KIND)
    return runSerial(chains, metaKey, async () => {
      // 单次写:读 meta → 配额检查 → set 数据 → set meta → 触发淘汰
      const writeOnce = async (): Promise<void> => {
        const meta = (await backend.get(metaKey)) as SessionMeta | undefined
        const old = await backend.get(fullKey)
        const oldBytes = old != null ? estimateBytes(old) : 0
        const newBytes = estimateBytes(value)
        const sessionTotal = (meta?.bytes ?? 0) + (newBytes - oldBytes)
        if (sessionTotal > maxBytesPerSession) {
          // 单会话超软上限:拒写该 kind(保留旧值),仅告警
          emit({ type: 'quota', sessionBytes: sessionTotal, limit: maxBytesPerSession })
          return
        }
        await backend.set(fullKey, value)
        const now = Date.now()
        const updated: SessionMeta = meta ?? { agentId, sessionId, createdAt: now, lastAccessed: now, bytes: 0 }
        updated.bytes += newBytes - oldBytes
        updated.lastAccessed = now
        await backend.set(metaKey, updated)
        scheduleEviction()
      }
      try {
        await writeOnce()
      } catch (err) {
        // 运行时撞浏览器真实配额(QuotaExceededError):先淘汰最旧会话腾空间,再降级内存兜底重写
        if (isQuotaError(err) && !degradedToMemory) {
          degradedToMemory = true
          try {
            await maybeEvict()
          } catch {
            /* 淘汰失败忽略 */
          }
          backend = createMemoryBackend()
          Promise.resolve().then(() =>
            emit({ type: 'degraded', reason: '存储配额超限(QuotaExceededError),已淘汰最旧会话并降级内存' }),
          )
          try {
            await writeOnce() // 降级后重写(写进内存,数据不丢)
          } catch {
            /* 降级后仍失败则放弃,不冒泡 */
          }
        }
        // 其它写失败:静默不抛(降级语义:storage 永不冒泡到用户代码)
      }
    })
  }

  function debouncedSave(agentId: string, sessionId: string, kind: SnapshotKind, value: unknown): Promise<void> {
    const fullKey = encodeKey(dbName, agentId, sessionId, kind)
    // 被同 kind 后续 save 取代:立即 resolve 旧 Promise(语义:已并入下次)
    const prev = pending.get(fullKey)
    if (prev) prev.resolve()
    const prevTimer = timers.get(fullKey)
    if (prevTimer) clearTimeout(prevTimer)
    return new Promise<void>((resolve) => {
      pending.set(fullKey, { value, agentId, sessionId, kind, resolve })
      const timer = setTimeout(() => {
        timers.delete(fullKey)
        const w = pending.get(fullKey)
        pending.delete(fullKey)
        if (!w) {
          resolve()
          return
        }
        commit(fullKey, w.value, w.agentId, w.sessionId).then(resolve, resolve)
      }, debounceMs)
      timers.set(fullKey, timer)
    })
  }

  let evictTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleEviction(): void {
    if (evictTimer) return
    evictTimer = setTimeout(() => {
      evictTimer = null
      void maybeEvict()
    }, EVICT_DELAY_MS)
  }

  /** 扫全局 meta → 总量超配额 → 按 lastAccessed 升序整会话 clearPrefix 到 ≤ watermark */
  async function maybeEvict(): Promise<void> {
    const metas: SessionMeta[] = []
    await backend.scan(globalPrefix(dbName), (key, value) => {
      if (key.endsWith('::' + META_KIND)) metas.push(value as SessionMeta)
    })
    const victims = selectForEviction(metas, maxBytes, watermark)
    for (const m of victims) {
      await backend.clearPrefix(sessionPrefix(dbName, m.agentId, m.sessionId))
      emit({ type: 'evicted', agentId: m.agentId, sessionId: m.sessionId, bytes: m.bytes })
    }
  }

  return {
    ready,
    async listSessions(agentId) {
      const metas: SessionMeta[] = []
      await backend.scan(agentPrefix(dbName, agentId), (key, value) => {
        if (key.endsWith('::' + META_KIND)) metas.push(value as SessionMeta)
      })
      return metas.sort((a, b) => b.lastAccessed - a.lastAccessed) // 最近在前
    },
    async load(agentId, sessionId) {
      const metaKey = encodeKey(dbName, agentId, sessionId, META_KIND)
      const snap = await runSerial(chains, metaKey, async () => {
        const meta = (await backend.get(metaKey)) as SessionMeta | undefined
        if (!meta) return undefined
        const s: SessionSnapshot = { messages: [], vfs: {}, todos: [], memory: '' }
        for (const kind of SNAPSHOT_KINDS) {
          const v = await backend.get(encodeKey(dbName, agentId, sessionId, kind))
          if (v != null) (s as unknown as Record<string, unknown>)[kind] = v
        }
        meta.lastAccessed = Date.now()
        await backend.set(metaKey, meta)
        return s
      })
      return snap
    },
    async save(agentId, sessionId, snap) {
      const tasks: Promise<void>[] = []
      for (const kind of SNAPSHOT_KINDS) {
        if (snap[kind] === undefined) continue
        tasks.push(debouncedSave(agentId, sessionId, kind, snap[kind]))
      }
      await Promise.all(tasks)
    },
    async flush() {
      for (const k of Array.from(timers.keys())) {
        const t = timers.get(k)
        if (t) {
          clearTimeout(t)
          timers.delete(k)
        }
      }
      const items = Array.from(pending.entries())
      pending.clear()
      await Promise.all(
        items.map(async ([k, w]) => {
          await commit(k, w.value, w.agentId, w.sessionId)
          w.resolve()
        }),
      )
      emit({ type: 'flush' })
      await maybeEvict() // flush 立即淘汰(pagehide 兜底场景)
    },
    async deleteSession(agentId, sessionId) {
      await backend.clearPrefix(sessionPrefix(dbName, agentId, sessionId))
    },
    async createSession(agentId, title, sessionId) {
      const sid = sessionId ?? makeId()
      const now = Date.now()
      const meta: SessionMeta = { agentId, sessionId: sid, createdAt: now, lastAccessed: now, bytes: 0, title }
      await backend.set(encodeKey(dbName, agentId, sid, META_KIND), meta)
      return sid
    },
    onEvent(cb) {
      listeners.add(cb)
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      for (const p of pending.values()) p.resolve()
      pending.clear()
      if (evictTimer) {
        clearTimeout(evictTimer)
        evictTimer = null
      }
      chains.clear()
      listeners.clear()
    },
  }
}
