/**
 * Skill 独立持久化存储 —— 与聊天历史(SessionSnapshot)分离
 *
 * 设计目标:
 *   1. **独立于 storage 选项**:即使 `createChatSdk({ storage: false })` 关闭会话持久化,
 *      用户创建的 skill 仍持久化(默认 indexedDB),跨刷新恢复。
 *   2. **跨页面/跨 agent 复用**:通过手动指定 `id` 实现多页面共享同一套用户 skill。
 *      不传 `id` 则默认按 `agentId` 隔离(每 agent 独立 skill 集)。
 *   3. **可注入后端**:复用 storage.ts 的 StorageBackend 接口(Idb/WebStorage/Memory);
 *      后端不可用时降级内存(非持久,刷新丢失,但当前会话内仍可用)。
 *
 * key 编码:`v:1::skill-store::{store-id}::{name}` —— 单层命名空间,每个 skill 一条记录,
 *   便于单条增删改(无需读-改-写整集合)。
 */
import {
  createIdbBackend,
  createMemoryBackend,
  createWebStorageBackend,
  isQuotaError,
  type StorageBackend,
  type StorageBackendType,
} from './storage'

/** 持久化的用户创建 skill(getContent 函数不可序列化,故 content 直接存字符串) */
export interface PersistedSkill {
  name: string
  description: string
  content: string
}

export interface SkillStoreConfig {
  /**
   * 存储 id(命名空间)。**手动指定同一 id 即可跨页面/跨 agent 复用同一套用户 skill**。
   * 不传则默认 `'agent::{agentId}'`(每 agent 独立 skill 集,与 agent 隔离一致)。
   * 传固定字符串(如 `'shared'`)→ 多个 agent/页面共享同一套用户创建的 skill。
   */
  id?: string
  /** 后端类型,默认 'indexed'(大容量、跨刷新);'local' 跨页持久;'session' 刷新保留关页清;'memory' 纯内存降级 */
  backend?: StorageBackendType
  /** DB 命名空间,默认 'chat-sdk'(与 SessionStore 同库,不同 key 前缀) */
  dbName?: string
}

const KEY_PREFIX = 'v:1::skill-store'
const DEFAULT_DB_NAME = 'chat-sdk'

export interface SkillStore {
  /** resolve=false 表示已降级到内存(非持久) */
  ready: Promise<boolean>
  /** 列出全部用户 skill(扫描当前 id 命名空间) */
  list(): Promise<PersistedSkill[]>
  /** 读单个 skill(按 name);不存在返回 undefined */
  get(name: string): Promise<PersistedSkill | undefined>
  /** 写/覆盖单个 skill(按 name upsert) */
  put(skill: PersistedSkill): Promise<void>
  /** 删除单个 skill(按 name);返回是否删除成功 */
  remove(name: string): Promise<boolean>
  /** 清空当前 id 命名空间下全部用户 skill */
  clear(): Promise<void>
  /** 释放后端连接 */
  dispose(): void
}

/** 构造一个 skill 的存储 key */
function skillKey(dbName: string, storeId: string, name: string): string {
  return `${KEY_PREFIX}::${dbName}::${storeId}::${name}`
}
/** 当前 storeId 命名空间前缀(用于 scan/clearPrefix) */
function storePrefix(dbName: string, storeId: string): string {
  return `${KEY_PREFIX}::${dbName}::${storeId}::`
}

/**
 * 创建 Skill 独立存储。
 * - 默认后端 indexedDB(浏览器原生,大容量);不可用降级内存(非持久)。
 * - 与 `createChatSdk` 的 `storage` 选项完全独立:即使 `storage:false` 也会持久化 skill。
 */
export function createSkillStore(config: SkillStoreConfig = {}): SkillStore {
  const dbName = config.dbName ?? DEFAULT_DB_NAME
  const backendType = config.backend ?? 'indexed'
  const storeId = config.id ?? '' // 由调用方填 agentId(见 createChatSdk 包装)

  let backend: StorageBackend
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
        // 'memory':显式内存后端(非持久,ready=false)
        backend = createMemoryBackend()
        readyResolve(false)
      }
    } catch {
      backend = createMemoryBackend()
      readyResolve(false)
    }
  })()

  return {
    ready,
    async list(): Promise<PersistedSkill[]> {
      const out: PersistedSkill[] = []
      await backend.scan(storePrefix(dbName, storeId), (_k, v) => {
        out.push(v as PersistedSkill)
      })
      return out
    },
    async get(name): Promise<PersistedSkill | undefined> {
      return (await backend.get(skillKey(dbName, storeId, name))) as PersistedSkill | undefined
    },
    async put(skill): Promise<void> {
      try {
        await backend.set(skillKey(dbName, storeId, skill.name), skill)
      } catch (err) {
        // 配额超限:静默降级内存(不冒泡;skill 仅当前会话可见)
        if (isQuotaError(err)) {
          backend = createMemoryBackend()
        }
      }
    },
    async remove(name): Promise<boolean> {
      const key = skillKey(dbName, storeId, name)
      const existed = (await backend.get(key)) != null
      if (!existed) return false
      await backend.del(key)
      return true
    },
    async clear(): Promise<void> {
      await backend.clearPrefix(storePrefix(dbName, storeId))
    },
    dispose(): void {
      // IdbBackend 无显式 close 接口(由 GC 接管);Memory/WebStorage 无需释放
    },
  }
}
