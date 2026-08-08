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
import { toolError } from '../tools/toolError'
import { getByPath, applyPatchToClone, deepClone } from '../tools/jsonUtils'

/** 持久化钩子(可选):由 createChatSdk 注入,工具层无感 */
export interface VfsPersist {
  /** 文件变更后回调(debounce 由 createChatSdk 控制落盘) */
  save?: (files: Record<string, VfsFile>) => void
}

/** vfs 分池键(按 path 前缀路由:large_results/* / drafts/* / resources/* / 其他) */
export type VfsPoolKey = 'largeResults' | 'drafts' | 'userFiles' | 'resources'

/** createVfs 选项 */
export interface VfsOptions {
  /** 持久化钩子(可选) */
  persist?: VfsPersist
  /** 工作区总内存上限(默认 8MB,OOM 兜底;四池独立上限之和可能超过,由总上限最后约束);纯内存(storage:false)也生效 */
  maxBytes?: number
  /** 单池上限(可选,覆盖默认 largeResults=4MB / drafts=2MB / userFiles=2MB / resources=4MB);四池独立 LRU 互不挤占 */
  poolBytes?: Partial<Record<VfsPoolKey, number>>
}

/** 工作区默认总内存上限(大结果外存累积的 OOM 兜底;四池独立上限之和 12MB,总上限 8MB 最后约束) */
export const DEFAULT_VFS_MAX_BYTES = 8 * 1024 * 1024
/** 四池默认上限:large_results(offload 自动)/drafts(draft_write)/userFiles(vfs_write 显式)/resources(精确值保护占位符资源) */
export const DEFAULT_POOL_BYTES: Record<VfsPoolKey, number> = {
  largeResults: 4 * 1024 * 1024,
  drafts: 2 * 1024 * 1024,
  userFiles: 2 * 1024 * 1024,
  resources: 4 * 1024 * 1024,
}
const POOL_KEYS: readonly VfsPoolKey[] = ['largeResults', 'drafts', 'userFiles', 'resources']
/** 淘汰水位:淘汰到 池上限*0.9 留余量(与 storage 口径一致) */
const DEFAULT_VFS_WATERMARK = 0.9

export interface VfsStore {
  files: Record<string, VfsFile>
  /** 持久化恢复:直接灌入 raw target,不触发 save(仅 persist 模式) */
  hydrate?: (files: Record<string, VfsFile>) => void
  /** 立即落盘(清 debounce 窗口);pagehide 兜底用(仅 persist 模式) */
  flush?: () => void
  /** 清空工作区 + 触发落盘空(新会话用,仅 persist 模式) */
  clear?: () => void
  /** 是否有未捕获到 checkpoint 的写(供 checkpoint 增量 save 检查;非持久化模式也暴露) */
  isDirty?: () => boolean
  /** 读后清脏标记,返回是否脏;checkpoint save 消费(脏→clone 新基线,不脏→复用上次 clone 省 8MB 深拷贝) */
  consumeDirty?: () => boolean
  /** 设置被引用保护集(harden-context-resilience P4:LRU 淘汰时跳过被消息引用的 large_results,防 vfs_read 404) */
  setProtectedRefs?: (refs: Set<string>) => void
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
  // 四池独立上限(可经 poolBytes 覆盖);四池独立 LRU 互不挤占(防 offload 大结果挤掉进行中草稿/精确值资源)
  const poolMaxBytes: Record<VfsPoolKey, number> = { ...DEFAULT_POOL_BYTES, ...(opts.poolBytes ?? {}) }

  /** path → 池:large_results/* / drafts/* / resources/* / 其他(userFiles)。读写跨池透明,仅 LRU 按池隔离 */
  function poolOf(path: string): VfsPoolKey {
    const p = normalize(path)
    if (p.startsWith('large_results/')) return 'largeResults'
    if (p.startsWith('drafts/')) return 'drafts'
    if (p.startsWith('resources/')) return 'resources'
    return 'userFiles'
  }
  /** 单池当前字节数 */
  function poolBytesOf(pool: VfsPoolKey): number {
    let total = 0
    for (const [k, f] of Object.entries(files)) {
      if (poolOf(k) === pool) total += encodeLength(f.content)
    }
    return total
  }

  /**
   * 内存上限淘汰:按池独立 LRU —— 每池超各自 poolMaxBytes → 仅在该池内按 updatedAt 最旧删到 ≤ 池上限*watermark。
   * 三池互不挤占(关键:offload 的 large_results 大结果不会挤掉 drafts/ 进行中草稿)。
   * 最后总上限 maxBytes 兜底(默认 = 三池之和;用户配 poolBytes 之和超过时仍约束)。
   * 直接操作 raw target(不触发 Proxy 拦截,避免递归)。纯内存(storage:false)也生效。
   */
  function enforceLimit(): void {
    for (const pool of POOL_KEYS) {
      const limit = poolMaxBytes[pool]
      if (poolBytesOf(pool) <= limit) continue
      const target = limit * DEFAULT_VFS_WATERMARK
      const isLarge = pool === 'largeResults'
      // P4 OOM 硬兜底:large_results 被引用撑爆 1.5x → 无视 protectedRefs 强制 LRU 删(防全池被保护不收敛 OOM)
      const oomForce = isLarge && poolBytesOf(pool) > limit * 1.5
      if (oomForce) console.warn(`[page-agent-sdk] vfs large_results 池 ${poolBytesOf(pool)} > ${Math.round(limit * 1.5)}(被引用撑爆)→ 无视 protectedRefs 强制删`)
      const ordered = Object.entries(files)
        .filter(([k]) => poolOf(k) === pool)
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      for (const [k] of ordered) {
        // P4:被引用的 large_results 跳过(防 vfs_read 404);OOM 硬兜底时无视保护
        if (isLarge && !oomForce && _protectedRefs.has(k)) continue
        delete files[k]
        if (poolBytesOf(pool) <= target) break
      }
    }
    // 总上限兜底(默认 = 三池之和)
    if (estimateFileBytes(files) > maxBytes) {
      const target = maxBytes * DEFAULT_VFS_WATERMARK
      const totalOomForce = estimateFileBytes(files) > maxBytes * 1.5
      const ordered = Object.entries(files).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      for (const [k] of ordered) {
        if (poolOf(k) === 'largeResults' && !totalOomForce && _protectedRefs.has(k)) continue
        delete files[k]
        if (estimateFileBytes(files) <= target) break
      }
    }
  }

  // 脏标记:任何写(files[k]=/delete)置 true;checkpoint save 经 consumeDirty 检查,
  //   未脏则复用上次 vfs clone(省 8MB 深拷贝,长任务每轮省),脏则 clone 新基线。初始 true=首次 save 必 clone 建立基线。
  let _dirty = true
  // P4:被消息引用的 large_results path 集(enforceLimit 淘汰时跳过,防 vfs_read 404);由 createChatSdk stream 入口注入
  let _protectedRefs: Set<string> = new Set()
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
  //   - set 后 _dirty=true(checkpoint 增量)+ enforceLimit(纯内存上限保护,storage:false 也生效)+ scheduleSave(persist 模式 debounce 落盘,非 persist 内部短路)
  //   - 6 个 vfs 工具 + offload 写入点零改动;脏标记挂此一处覆盖所有工具写(零遗漏)
  const proxy = new Proxy(files, {
    set(target, key, value) {
      const ok = Reflect.set(target, key, value)
      if (ok) {
        _dirty = true
        enforceLimit()
        scheduleSave()
      }
      return ok
    },
    deleteProperty(target, key) {
      const ok = Reflect.deleteProperty(target, key)
      if (ok) {
        _dirty = true
        scheduleSave()
      }
      return ok
    },
  })

  const store: VfsStore = {
    files: proxy,
    isDirty: () => _dirty,
    consumeDirty: () => { const d = _dirty; _dirty = false; return d },
    setProtectedRefs: (refs: Set<string>) => { _protectedRefs = refs },
  }
  if (persist) {
    store.hydrate = (incoming) => {
      // 恢复:直接写 raw target,不触发 save;恢复后限上限(防快照过大撑爆内存)
      for (const [k, v] of Object.entries(incoming)) files[normalize(k)] = v
      enforceLimit()
      _dirty = true  // 恢复后内容确定,下次 save 应 clone 作新基线(防复用上个会话/旧栈的 lastVfsClone)
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
      _dirty = true  // 清空后内容变,下次 save 必 clone 新基线(空)
    }
  }
  return store
}

let _vfsEncoder: TextEncoder | null = null
/** 单文件 UTF-8 字节长度(与 storage.estimateBytes 口径一致) */
function encodeLength(s: string): number {
  if (!_vfsEncoder) _vfsEncoder = new TextEncoder()
  return _vfsEncoder.encode(s).length
}
/** 工作区总字节估算(文件内容 UTF-8 长度,与 storage.estimateBytes 口径一致) */
function estimateFileBytes(files: Record<string, VfsFile>): number {
  let total = 0
  for (const f of Object.values(files)) total += encodeLength(f.content)
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

/** vfs 内置工具名(供 createChatSdk 标 source=builtin;经 createVfsMiddleware 注入,默认会落到 'user' 语义错)。新增 vfs 工具时同步此处 */
export const VFS_TOOL_NAMES = ['vfs_read', 'vfs_write', 'vfs_edit', 'vfs_ls', 'vfs_glob', 'vfs_grep', 'vfs_json_read', 'vfs_json_patch', 'vfs_rm'] as const

/** 基于 store 构建 vfs 工具集 */
export function createVfsTools(store: VfsStore): StructuredToolInterface[] {
  const vfsRead = tool(
    async ({ path, offset, limit }) => {
      const f = store.files[normalize(path)]
      if (!f) {
        return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}"`, hint: '用 vfs_ls 查看虚拟工作区文件列表;大工具结果外存后路径由系统在工具返回里给出' })
      }
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
    async ({ path, content, jsonString }) => {
      // jsonString=true:写入前校验 content 是合法 JSON(非法 VFS_JSON_INVALID,不写入)
      if (jsonString) {
        try {
          JSON.parse(content)
        } catch (e) {
          return toolError({ code: 'VFS_JSON_INVALID', path, message: `content 非合法 JSON: ${(e as Error).message}`, hint: 'jsonString=true 要求 content 是合法 JSON;检查引号/逗号/括号配对;或省略 jsonString 写纯文本' })
        }
      }
      store.files[normalize(path)] = { content, updatedAt: now() }
      return `已写入 ${path}(${content.length} 字符)${jsonString ? '(JSON 校验通过)' : ''}`
    },
    {
      name: 'vfs_write',
      description: '写入/覆盖虚拟工作区文件,作为中间工作记忆。jsonString=true 时校验 content 是合法 JSON(配合 vfs_json_read/vfs_json_patch 操作 JSON 文件)。',
      schema: z.object({
        path: z.string().describe('文件路径'),
        content: z.string().describe('完整内容'),
        jsonString: z.boolean().optional().describe('true 时校验 content 是合法 JSON(非法返回 VFS_JSON_INVALID 不写入);省略/false 写纯文本不校验'),
      }),
    },
  )

  const vfsEdit = tool(
    async ({ path, oldString, newString }) => {
      const key = normalize(path)
      const f = store.files[key]
      if (!f) {
        return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}"`, hint: '用 vfs_ls 查看虚拟工作区文件列表' })
      }
      const count = f.content.split(oldString).length - 1
      if (count === 0) {
        return toolError({
          code: 'NO_MATCH',
          path,
          message: `${path} 中未找到该 oldString`,
          hint: '确认 oldString 与文件内容完全一致(含空格/换行);可先 vfs_read 查看实际内容',
        })
      }
      if (count > 1) {
        // 给出前几处匹配的行号,帮助 LLM 提供更唯一的 oldString
        const lineHints: string[] = []
        const lines = f.content.split('\n')
        for (let li = 0; li < lines.length && lineHints.length < 5; li++) {
          const idx = lines[li].indexOf(oldString)
          if (idx >= 0) lineHints.push(`行 ${li + 1}: ${lines[li].slice(Math.max(0, idx - 10), idx + oldString.length + 10)}`)
        }
        return toolError({
          code: 'AMBIGUOUS_MATCH',
          path,
          message: `${path} 中找到 ${count} 处匹配,oldString 不唯一`,
          hint: '扩大 oldString 上下文使其唯一(含前后行/更多字符);下方为前几处匹配位置',
          details: { matches: lineHints },
        })
      }
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
      let re: RegExp
      try {
        re = globToRegex(pattern)
      } catch (e) {
        return toolError({ code: 'GLOB_INVALID', message: `glob 模式无效: ${(e as Error).message}`, hint: '* 匹配非斜杠,** 匹配任意;避免未闭合的字符类', details: { pattern } })
      }
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
      let re: RegExp
      try {
        re = new RegExp(pattern)
      } catch (e) {
        return toolError({ code: 'REGEX_INVALID', path, message: `正则表达式无效: ${(e as Error).message}`, hint: '检查括号/量词是否闭合;若想搜普通字符串可先转义特殊字符', details: { pattern } })
      }
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

  const vfsJsonRead = tool(
    async ({ path, jsonPath }) => {
      const key = normalize(path)
      const f = store.files[key]
      if (!f) {
        return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}"`, hint: '用 vfs_ls 查看虚拟工作区文件列表' })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(f.content)
      } catch (e) {
        return toolError({ code: 'VFS_JSON_INVALID', path, message: `文件内容非合法 JSON: ${(e as Error).message}`, hint: 'vfs_json_read 要求文件内容是合法 JSON;先 vfs_read 查看实际内容,或 vfs_write({jsonString:true}) 重写为合法 JSON' })
      }
      if (jsonPath) {
        const sub = getByPath(parsed, jsonPath)
        if (sub === undefined) {
          return toolError({ code: 'VFS_PATH_NOT_FOUND', path, message: `jsonPath "${jsonPath}" 不存在`, hint: '不传 jsonPath 整体读查看结构,或核对路径段' })
        }
        return `${path}#${jsonPath} (JSON):\n${JSON.stringify(sub)}`
      }
      return `${path} (JSON):\n${JSON.stringify(parsed)}`
    },
    {
      name: 'vfs_json_read',
      description: '把虚拟工作区文件当 JSON 读取:先 parse 整文件,再按 jsonPath 取子树(省略返整体)。文件非合法 JSON 报 VFS_JSON_INVALID。适合结构化读取 vfs 内大 JSON。',
      schema: z.object({
        path: z.string().describe('文件路径(内容须为合法 JSON)'),
        jsonPath: z.string().optional().describe('点分隔子路径(如 components.0.title);省略读整体'),
      }),
    },
  )

  const vfsJsonPatch = tool(
    async ({ path, patches }) => {
      const key = normalize(path)
      const f = store.files[key]
      if (!f) {
        return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}"`, hint: '用 vfs_ls 查看虚拟工作区文件列表' })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(f.content)
      } catch (e) {
        return toolError({ code: 'VFS_JSON_INVALID', path, message: `文件内容非合法 JSON: ${(e as Error).message}`, hint: 'vfs_json_patch 要求文件内容是合法 JSON' })
      }
      // 在 clone 上 patch:任一 patch 失败则整体不写回(原子性,原文件不污染)
      const clone = deepClone(parsed)
      const affectedPaths: string[] = []
      for (const p of patches) {
        const err = applyPatchToClone(clone, p.op, p.jsonPath, p.value)
        if (err) {
          return toolError({ code: 'PATCH_FAILED', path, message: err, hint: '修正 patches 后重试(原文件未改动)', details: { failedPatch: p } })
        }
        affectedPaths.push(p.jsonPath || '(根)')
      }
      const serialized = JSON.stringify(clone)
      store.files[key] = { content: serialized, updatedAt: now() }
      return `已对 ${path} 应用 ${patches.length} 个 patch(影响 ${affectedPaths.length} 处:${affectedPaths.join(', ')}),文件现 ${serialized.length} 字符`
    },
    {
      name: 'vfs_json_patch',
      description: '在虚拟工作区 JSON 文件内做原子 jsonPath patch(set/remove/merge/append)。先 parse → clone 上应用全部 patches → 任一失败或 JSON 非法则整体不写回(原文件不变)。',
      schema: z.object({
        path: z.string().describe('文件路径(内容须为合法 JSON)'),
        patches: z.array(
          z.object({
            op: z.enum(['set', 'remove', 'merge', 'append']).describe('操作'),
            jsonPath: z.string().describe('点分隔路径(如 components.0.title);merge/append 目标可为根(空串)'),
            value: z.any().optional().describe('set/merge/append 的值(remove 不需要)'),
          }),
        ).describe('按顺序应用的 patch 列表(原子:任一失败整体不写回)'),
      }),
    },
  )

  const vfsRm = tool(
    async ({ path }) => {
      const key = normalize(path)
      if (!store.files[key]) {
        return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}",无需删除`, hint: '用 vfs_ls 查看虚拟工作区文件列表' })
      }
      delete store.files[key]
      return `已删除 ${path}`
    },
    {
      name: 'vfs_rm',
      description: '删除虚拟工作区文件(清理中间产物 / drafts 下草稿,补「只进不出」的闭环)。不存在返回 NOT_FOUND。',
      schema: z.object({ path: z.string().describe('要删除的文件路径') }),
    },
  )

  return [vfsRead, vfsWrite, vfsEdit, vfsLs, vfsGlob, vfsGrep, vfsJsonRead, vfsJsonPatch, vfsRm]
}

/** vfs 中间件:beforeAgent 把 store.files 注入 state(共享引用,工具改即 state 改) */
export function createVfsMiddleware(store: VfsStore): Middleware {
  return {
    name: 'vfs',
    tools: createVfsTools(store),
    beforeAgent: () => ({ files: store.files }),
  }
}
