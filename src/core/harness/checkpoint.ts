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

interface Checkpoint extends CheckpointMeta {
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
}

export interface CheckpointDeps {
  /** 注册的 数据槽 path 列表(整体快照这些根) */
  slotPaths: string[]
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

/** 就地还原容器内容,保留引用(数组:清空+push;对象:删多余 key + 覆盖) */
function restoreInPlace(live: Record<string, unknown> | unknown[], snap: unknown): void {
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

  return {
    save(label) {
      const messages = trimTrailingEmptyAssistant(deps.messages)
      const windowVals: Record<string, unknown> = {}
      for (const p of deps.slotPaths) windowVals[p] = clone(getByPath(window, p))
      const cp: Checkpoint = {
        id: nextId++,
        label,
        timestamp: Date.now(),
        messages: clone(messages),
        windowVals,
        vfs: clone(deps.vfsStore.files),
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
      // 2. 数据槽注册项:就地还原(保留 reactive 容器引用)
      for (const [p, v] of Object.entries(cp.windowVals)) restorePath(p, clone(v))
      // 3. vfs:清空重填
      const files = deps.vfsStore.files
      for (const k of Object.keys(files)) delete files[k]
      Object.assign(files, clone(cp.vfs))
      // 4. todos:reset
      deps.todosMw.reset(clone(cp.todos))
      return true
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
