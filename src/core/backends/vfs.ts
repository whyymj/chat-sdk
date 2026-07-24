/**
 * 内存虚拟工作区(vfs)—— 替代真实文件系统,作为 agent 工作记忆
 *
 * 对齐 Deep Agents 的 StateBackend + filesystem 中间件:
 *  - store.files 是共享引用,既作为工具操作目标,也同步进 HarnessState.files
 *  - 工具:read/write/edit/ls/glob/grep(read 支持 offset/limit 分页,供大结果外存回读)
 *  - 会话级、刷新即失
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { Middleware } from '../harness/middleware'
import type { VfsFile } from '../harness/state'

/** 持久化钩子(可选):由 createChatSdk 注入,工具层无感 */
export interface VfsPersist {
  /** 文件变更后回调(debounce 由 createChatSdk 控制落盘) */
  save?: (files: Record<string, VfsFile>) => void
}

/** createVfs 选项 */
export interface VfsOptions {
  /** 持久化钩子(可选) */
  persist?: VfsPersist
  /** 工作区内存字节上限(默认 4MB);超限按 updatedAt 最旧 LRU 淘汰。纯内存(storage:false)也生效 */
  maxBytes?: number
}

/** 工作区默认内存上限(大结果外存累积的 OOM 兜底) */
export const DEFAULT_VFS_MAX_BYTES = 4 * 1024 * 1024
/** 淘汰水位:淘汰到 maxBytes*0.9 留余量(与 storage 口径一致) */
const DEFAULT_VFS_WATERMARK = 0.9

export interface VfsStore {
  files: Record<string, VfsFile>
  /** 持久化恢复:直接灌入 raw target,不触发 save(仅 persist 模式) */
  hydrate?: (files: Record<string, VfsFile>) => void
  /** 立即落盘(清 debounce 窗口);pagehide 兜底用(仅 persist 模式) */
  flush?: () => void
  /** 清空工作区 + 触发落盘空(新会话用,仅 persist 模式) */
  clear?: () => void
}

/**
 * 创建一个 vfs 实例。
 * @param initialFiles 初始文件(path → content)
 * @param opts.persist 持久化钩子;提供则用 Proxy 捕获 store.files 变更 → debounce save
 */
export function createVfs(
  initialFiles?: Record<string, string>,
  opts: VfsOptions = {},
): VfsStore {
  // Object.create(null):无原型链,防 __proto__/constructor 原型污染(LLM 可控的 path)
  const files = Object.create(null) as Record<string, VfsFile>
  if (initialFiles) {
    for (const [k, v] of Object.entries(initialFiles)) {
      files[normalize(k)] = { content: v, updatedAt: now() }
    }
  }

  const { persist } = opts
  const maxBytes = opts.maxBytes ?? DEFAULT_VFS_MAX_BYTES

  /**
   * 内存上限淘汰:总字节超 maxBytes → 按 updatedAt 最旧 LRU 删到 ≤ maxBytes*watermark。
   * 直接操作 raw target(不触发 Proxy 拦截,避免递归)。
   * 纯内存(storage:false)也生效 —— 大结果外存累积的 OOM 兜底。
   */
  function enforceLimit(): void {
    if (estimateFileBytes(files) <= maxBytes) return
    const target = maxBytes * DEFAULT_VFS_WATERMARK
    const ordered = Object.entries(files).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    for (const [k] of ordered) {
      delete files[k]
      if (estimateFileBytes(files) <= target) break
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function doSave(): void {
    if (!persist?.save) return
    // 拷贝纯对象(解 Proxy),隔离后续变更,避免序列化句柄
    const snapshot: Record<string, VfsFile> = {}
    for (const [k, v] of Object.entries(files)) snapshot[k] = { ...v }
    persist.save!(snapshot)
  }
  function scheduleSave(): void {
    if (!persist?.save) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      doSave()
    }, 800)
  }

  // Proxy 统一捕获 set/deleteProperty(无论是否持久化都包裹):
  //   - set 后 enforceLimit(纯内存上限保护,storage:false 也生效)+ scheduleSave(persist 模式 debounce 落盘,非 persist 内部短路)
  //   - 6 个 vfs 工具 + offload 写入点零改动
  const proxy = new Proxy(files, {
    set(target, key, value) {
      const ok = Reflect.set(target, key, value)
      if (ok) {
        enforceLimit()
        scheduleSave()
      }
      return ok
    },
    deleteProperty(target, key) {
      const ok = Reflect.deleteProperty(target, key)
      if (ok) scheduleSave()
      return ok
    },
  })

  const store: VfsStore = { files: proxy }
  if (persist) {
    store.hydrate = (incoming) => {
      // 恢复:直接写 raw target,不触发 save;恢复后限上限(防快照过大撑爆内存)
      for (const [k, v] of Object.entries(incoming)) files[normalize(k)] = v
      enforceLimit()
    }
    store.flush = () => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      doSave()
    }
    store.clear = () => {
      // 清空 raw target(新会话),触发落盘空
      for (const k of Object.keys(files)) delete files[k]
      scheduleSave()
    }
  }
  return store
}

let _vfsEncoder: TextEncoder | null = null
/** 工作区总字节估算(文件内容 UTF-8 长度,与 storage.estimateBytes 口径一致) */
function estimateFileBytes(files: Record<string, VfsFile>): number {
  if (!_vfsEncoder) _vfsEncoder = new TextEncoder()
  let total = 0
  for (const f of Object.values(files)) total += _vfsEncoder.encode(f.content).length
  return total
}

/** 规范化路径:去前导/、去重复斜杠 */
function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/')
}

/** 简易 glob → RegExp(* 匹配非/,** 匹配任意) */
function globToRegex(pattern: string): RegExp {
  let r = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        r += '.*'
        i++
      } else {
        r += '[^/]*'
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      r += '\\' + c
    } else {
      r += c
    }
  }
  return new RegExp('^' + r + '$')
}

// Date.now 在 workflow 脚本里被禁,但这里是运行时浏览器代码,可用
function now(): number {
  return Date.now()
}

/** 基于 store 构建 vfs 工具集 */
export function createVfsTools(store: VfsStore): StructuredToolInterface[] {
  const vfsRead = tool(
    async ({ path, offset, limit }) => {
      const f = store.files[normalize(path)]
      if (!f) return `未找到文件 "${path}"。可用 vfs_ls 查看。`
      const lines = f.content.split('\n')
      const start = offset
      const end = Math.min(start + limit, lines.length)
      const slice = lines.slice(start, end).join('\n')
      return `${path}(行 ${start + 1}-${end} / 共 ${lines.length} 行):\n${slice}`
    },
    {
      name: 'vfs_read',
      description: '读取虚拟工作区文件,支持分页(offset 行号、limit 行数)。用于回读大工具结果外存的内容。',
      schema: z.object({
        path: z.string().describe('文件路径'),
        offset: z.number().int().min(0).default(0).describe('起始行号(0 基)'),
        limit: z.number().int().min(1).default(2000).describe('读取行数'),
      }),
    },
  )

  const vfsWrite = tool(
    async ({ path, content }) => {
      store.files[normalize(path)] = { content, updatedAt: now() }
      return `已写入 ${path}(${content.length} 字符)`
    },
    {
      name: 'vfs_write',
      description: '写入/覆盖虚拟工作区文件,作为中间工作记忆。',
      schema: z.object({
        path: z.string().describe('文件路径'),
        content: z.string().describe('完整内容'),
      }),
    },
  )

  const vfsEdit = tool(
    async ({ path, oldString, newString }) => {
      const key = normalize(path)
      const f = store.files[key]
      if (!f) return `未找到文件 "${path}"。`
      const count = f.content.split(oldString).length - 1
      if (count === 0) return `${path} 中未找到该内容。`
      if (count > 1) return `${path} 中找到 ${count} 处匹配,请提供更唯一的 oldString。`
      store.files[key] = { content: f.content.replace(oldString, newString), updatedAt: now() }
      return `已替换 ${path} 中 1 处。`
    },
    {
      name: 'vfs_edit',
      description: '精确替换虚拟工作区文件中的一处字符串(oldString 必须唯一)。',
      schema: z.object({
        path: z.string().describe('文件路径'),
        oldString: z.string().describe('要被替换的唯一原文'),
        newString: z.string().describe('替换后的新内容'),
      }),
    },
  )

  const vfsLs = tool(
    async () => {
      const names = Object.keys(store.files)
      if (!names.length) return '虚拟工作区为空。'
      return `虚拟工作区文件:\n${names.map((n) => `- ${n}`).join('\n')}`
    },
    {
      name: 'vfs_ls',
      description: '列出虚拟工作区所有文件。',
      schema: z.object({}),
    },
  )

  const vfsGlob = tool(
    async ({ pattern }) => {
      const re = globToRegex(pattern)
      const matched = Object.keys(store.files).filter((n) => re.test(n))
      return matched.length
        ? `匹配 ${pattern}:\n${matched.map((n) => `- ${n}`).join('\n')}`
        : `无匹配 ${pattern} 的文件。`
    },
    {
      name: 'vfs_glob',
      description: '按 glob 模式匹配虚拟工作区文件名(* 匹配非斜杠,** 匹配任意)。',
      schema: z.object({ pattern: z.string().describe('glob 模式,如 "**/*.md"') }),
    },
  )

  const vfsGrep = tool(
    async ({ pattern, path }) => {
      const re = new RegExp(pattern)
      const targets = path ? [normalize(path)] : Object.keys(store.files)
      const out: string[] = []
      for (const p of targets) {
        const f = store.files[p]
        if (!f) continue
        f.content.split('\n').forEach((line, i) => {
          if (re.test(line)) out.push(`${p}:${i + 1}: ${line}`)
        })
      }
      return out.length
        ? `找到 ${out.length} 处:\n${out.slice(0, 50).join('\n')}`
        : `未找到匹配 /${pattern}/ 的内容。`
    },
    {
      name: 'vfs_grep',
      description: '在虚拟工作区文件内容中正则搜索。',
      schema: z.object({
        pattern: z.string().describe('正则表达式'),
        path: z.string().optional().describe('限定单个文件,不传则搜索全部'),
      }),
    },
  )

  return [vfsRead, vfsWrite, vfsEdit, vfsLs, vfsGlob, vfsGrep]
}

/** vfs 中间件:beforeAgent 把 store.files 注入 state(共享引用,工具改即 state 改) */
export function createVfsMiddleware(store: VfsStore): Middleware {
  return {
    name: 'vfs',
    tools: createVfsTools(store),
    beforeAgent: () => ({ files: store.files }),
  }
}
