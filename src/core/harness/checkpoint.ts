/**
 * 会话级 Checkpoint —— 整体回滚到"上次正常时"(human-in-the-loop 的回退侧)
 *
 * 与 dataOps 的 per-path 快照互补:
 *  - per-path 快照:精细,单属性回退,自动随 set/edit/delete 入栈
 *  - 会话 checkpoint:整体(对话历史 + 全部注册 数据槽 + vfs + todos),回滚到某轮起点
 *
 * 触发:默认每轮 agent 行动前(beforeModel 首次)自动存一个 checkpoint = 上一正常态 + 本轮 user 消息。
 *  回滚后保留 user 消息、撤销 agent 本轮改动,可重试。LLM 也可调 restore_last_checkpoint 自纠。
 *
 * 仅存内存(会话级,非持久化;刷新后宿主值已变,checkpoint 无意义)。FIFO 限长(默认 5)。
 */
import type { Middleware } from './middleware'
import type { AgentMessage } from '../types'
import type { VfsStore } from '../backends/vfs'
import type { VfsFile, Todo } from './state'

export interface CheckpointMeta {
  id: number
  label?: string
  timestamp: number
  messageCount: number
}

export interface Checkpoint extends CheckpointMeta {
  messages: AgentMessage[]
  windowVals: Record<string, unknown>
  vfs: Record<string, VfsFile>
  todos: Todo[]
}

export interface CheckpointManager {
  /** 存当前态为一个 checkpoint(读 deps.messages/window/vfs/todos),返回 id */
  save: (label?: string) => number
  /** 列出可用 checkpoint(元信息,不含快照体) */
  list: () => CheckpointMeta[]
  /** 回滚到指定 id;不传 id = 最近一个。成功 true,无可用 checkpoint false */
  restore: (id?: number) => boolean
  /** 是否有可回滚的 checkpoint */
  canRestore: () => boolean
  /** 导出栈快照(深拷贝,可序列化;供 automation 断点续跑持久化,刷新/崩溃后恢复 restoreLastCheckpoint 能力) */
  exportStack: () => Checkpoint[]
  /** 灌入栈快照(刷新/崩溃恢复时重建 checkpoint 栈;重置 nextId 防后续 save id 冲突) */
  importStack: (cps: unknown[]) => void
}

export interface CheckpointDeps {
  /**
   * 主数据读回调(单对象 data 模型):save 时读 bind 快照,restore 时写回 bind。
   * 优先于 `slotPaths`(旧 windowProps 模式:从 window 按 path 读,零桥接)。
   * 用 getter 形式 `() => liveData()?.bind` 适配 sdk.setData 运行时替换 bind。
   */
  getData?: () => unknown
  /** 主数据写回回调(单对象 data 模型):restore 时把快照写回当前 bind(就地还原保留 reactive 引用) */
  restoreData?: (snap: unknown) => void
  /** 读后清 bind 脏标记,返回是否脏(供 save 增量:脏或首次才 clone,不脏复用上次 clone 省深拷贝)。省略则 save 永远整体 clone(向后兼容) */
  consumeDataDirty?: () => boolean
  /** 注册的 数据槽 path 列表(旧 windowProps 模式:从 window 按 path 整体快照);data 模型用 getData 即可,此项可省略或传 [] */
  slotPaths?: string[]
  /** vfs 工作区(回滚时清空重填) */
  vfsStore: VfsStore
  /** todos 中间件(回滚时 reset) */
  todosMw: { reset: (todos: Todo[]) => void }
  /** 取当前 todos(经 agent.getState) */
  getTodos: () => Todo[]
  /** 对话历史响应式数组(与 UI 共享同一引用;回滚时 splice 替换内容) */
  messages: AgentMessage[]
  /** 保留 checkpoint 数(默认 5) */
  maxCheckpoints?: number
}

/** 深拷贝(structuredClone 优先,降级 JSON) */
function clone<T>(v: T): T {
  if (v == null || typeof v !== 'object') return v
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(v))
}

// ---- 就地 path 读写(与 dataOps 同思路,保留 reactive 容器引用) ----
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let cur: any = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

function setByPath(obj: unknown, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: any = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

/** 就地还原容器内容,保留引用(数组:清空+push;对象:删多余 key + 覆盖)。导出供 importData 等复用 */
export function restoreInPlace(live: Record<string, unknown> | unknown[], snap: unknown): void {
  if (Array.isArray(live)) {
    live.length = 0
    if (Array.isArray(snap)) (live as unknown[]).push(...snap)
    return
  }
  const s = snap && typeof snap === 'object' && !Array.isArray(snap) ? (snap as Record<string, unknown>) : {}
  for (const k of Object.keys(live)) if (!(k in s)) delete live[k]
  for (const k of Object.keys(s)) live[k] = s[k]
}

function restorePath(path: string, snap: unknown): void {
  const live = getByPath(window, path)
  if (live != null && typeof live === 'object') restoreInPlace(live as Record<string, unknown> | unknown[], snap)
  else setByPath(window, path, snap)
}

/** 去掉尾部空的 assistant 占位(useChat 流式占位),使 checkpoint = 历史 + user */
function trimTrailingEmptyAssistant(msgs: AgentMessage[]): AgentMessage[] {
  const out = msgs.slice()
  while (out.length) {
    const last = out[out.length - 1]
    if (last.role === 'assistant' && !last.content && !(last as any).steps?.length && !(last as any).reasoning) {
      out.pop()
    } else break
  }
  return out
}

export function createCheckpointManager(deps: CheckpointDeps): CheckpointManager {
  const stack: Checkpoint[] = []
  const max = deps.maxCheckpoints ?? 5
  let nextId = 1
  // 增量快照缓存:未脏时复用上次 clone(vfs 默认 8MB + bind 几百 K,长任务每轮省深拷贝)。
  //   consumeDirty/consumeDataDirty 读后清;脏或缓存为空(首次/importStack 后)才 clone 新基线。
  //   ⚠ 复用安全前提:clone 经 structuredClone 解 Proxy 成纯对象(不复制 Proxy 性质),且仅 restore 时 clone(cp.x) 再用,
  //     缓存引用从不被直接 mutate → 多 checkpoint 共享同一 clone 引用不会互相污染。
  let lastVfsClone: Record<string, VfsFile> | undefined
  let lastBindClone: unknown

  return {
    save(label) {
      const messages = trimTrailingEmptyAssistant(deps.messages)
      const windowVals: Record<string, unknown> = {}
      if (deps.getData) {
        // 单对象 data 模式:脏标记增量(脏或缓存空才 clone 新基线,否则复用上次 clone 省深拷贝)
        const bindChanged = deps.consumeDataDirty?.() ?? true  // 无 consumeDataDirty → 永远 clone(向后兼容)
        if (bindChanged || lastBindClone === undefined) {
          lastBindClone = clone(deps.getData())
        }
        windowVals[''] = lastBindClone
      } else {
        // 旧 windowProps 模式:从 window 按 path 读(零桥接;不增量,保持简单+正确)
        for (const p of deps.slotPaths ?? []) windowVals[p] = clone(getByPath(window, p))
      }
      // vfs 增量(最大头 8MB):vfsStore 写经 Proxy 统一标脏,未脏复用上次 clone
      const vfsChanged = deps.vfsStore.consumeDirty?.() ?? true
      if (vfsChanged || lastVfsClone === undefined) {
        lastVfsClone = clone(deps.vfsStore.files)
      }
      const cp: Checkpoint = {
        id: nextId++,
        label,
        timestamp: Date.now(),
        messages: clone(messages),
        windowVals,
        vfs: lastVfsClone as Record<string, VfsFile>,
        todos: clone(deps.getTodos()),
        messageCount: messages.length,
      }
      stack.push(cp)
      while (stack.length > max) stack.shift()
      return cp.id
    },

    list() {
      return stack.map((c) => ({ id: c.id, label: c.label, timestamp: c.timestamp, messageCount: c.messageCount }))
    },

    canRestore() {
      return stack.length > 0
    },

    restore(id) {
      const cp = id != null ? stack.find((c) => c.id === id) : stack[stack.length - 1]
      if (!cp) return false
      // 1. 对话历史:splice 替换内容(保留同一响应式数组引用,UI 自动更新)
      deps.messages.splice(0, deps.messages.length, ...clone(cp.messages))
      // 2. 主数据:单对象 data 模式优先用 getData() 拿当前 bind + restoreInPlace 就地还原(保留 reactive 引用);否则回退 window path(旧模式)
      if (deps.getData) {
        const snap = cp.windowVals['']
        if (snap !== undefined) {
          const live = deps.getData()
          if (live != null && typeof live === 'object') restoreInPlace(live as Record<string, unknown> | unknown[], clone(snap))
          // 叶子 bind(原始类型)无法就地还原:集成方应用对象包裹(同 verify/dataOps LEAF_BIND 约定)
        }
      } else {
        for (const [p, v] of Object.entries(cp.windowVals)) restorePath(p, clone(v))
      }
      // 3. vfs:清空重填
      const files = deps.vfsStore.files
      for (const k of Object.keys(files)) delete files[k]
      Object.assign(files, clone(cp.vfs))
      // 4. todos:reset
      deps.todosMw.reset(clone(cp.todos))
      // 5. 失效增量缓存基线:restore 改了 bind(restoreInPlace 不经 dataOps 脏标记)与 vfs(虽经 Proxy 标脏),
      //   重置 lastXxxClone 强制下次 save 重建基线(防 restore 后 save 复用旧基线 → 静默错乱;跨轮 restore 测试驱动发现)
      lastBindClone = undefined
      lastVfsClone = undefined
      return true
    },

    exportStack() {
      return clone(stack)
    },

    importStack(cps: unknown[]) {
      stack.length = 0
      // 恢复栈的 checkpoint 与当前 lastXxxClone 缓存基线可能不一致 → 重置,下次 save 必 clone 重建基线(防复用错基线致 restore 错乱)
      lastVfsClone = undefined
      lastBindClone = undefined
      const arr = Array.isArray(cps) ? cps : []
      for (const cp of arr) {
        // 仅灌入结构完整的 checkpoint(防脏数据 + id 必须是有限数,否则 Math.max 成 NaN → nextId=NaN → 后续 save 产出 NaN id)
        if (cp && typeof cp === 'object' && 'id' in cp && 'messages' in cp
          && typeof (cp as { id: unknown }).id === 'number' && Number.isFinite((cp as { id: number }).id)) {
          stack.push(cp as Checkpoint)
        }
      }
      // 重置 nextId 为栈中最大 id + 1,防后续 save 的 id 与恢复的 checkpoint 冲突(list/restore 按 id 定位)
      nextId = stack.reduce((m, c) => Math.max(m, c.id), 0) + 1
    },
  }
}

/**
 * Checkpoint 中间件:每轮 agent 行动前(beforeModel 首次)自动存一个 checkpoint。
 * beforeAgent 重置 per-turn 标记;beforeModel 首次触发 save(读 deps 当前态)。
 */
export function createCheckpointMiddleware(mgr: CheckpointManager): Middleware {
  let savedThisTurn = false
  return {
    name: 'checkpoint',
    beforeAgent: () => {
      savedThisTurn = false
      return undefined
    },
    beforeModel: () => {
      if (!savedThisTurn) {
        savedThisTurn = true
        mgr.save('auto')
      }
      return undefined
    },
  }
}
