/**
 * window 操作工具 —— 属性注册表 + schema 校验 + 增量编辑 + 快照回退(无人工审批)
 *
 * 设计(见 specs/chat-sdk-core.md):
 *  - 属性注册表:集成方声明 { path, description, schema };所有读写只经工具 → 范围(仅注册表内)+ 校验(按 schema)
 *  - 属性说明文档:list_window_props / describe_window_prop
 *  - 增量编辑 edit_window_prop:按 op(set/remove/merge/append)+ jsonPath 改局部,避免 LLM 重传整个大 JSON
 *  - 快照回退:set/edit/delete 前自动存快照;snapshot/list/restore_window_snapshot 支持手动检查点与快速回退
 *  - 就地写回:edit/restore 改子属性,绝不替换注册属性根引用 → 兼容 Vue reactive(window.page = reactive())
 *  - 零桥接:工具函数体 window = 宿主页面主 window(无 iframe/shadow 隔离)
 *  - 审计:每次 set/edit/delete/restore 记日志(可选 onAudit 回调)
 *
 * 注:大结果的外存/截断不在本文件,统一由 createAgent 的 coreExecTool 经 offloadLargeResult 处理;
 *     get_window_prop 返回完整安全序列化(不截断),交由 offload 决定外存 vfs 或截断。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'

/** 可操作属性注册项 */
export interface WindowPropSpec {
  /** window 上的路径,支持点号嵌套,如 'app.theme' 或 'app.user.name' */
  path: string
  /** 属性说明,供 Agent 理解用途与格式 */
  description: string
  /** 值的 zod schema(写入时校验) */
  schema: ZodType
}

export interface WindowAuditEntry {
  op: 'set' | 'edit' | 'delete' | 'restore' | 'snapshot'
  path: string
  value?: unknown
  detail?: string
  timestamp: number
}

export interface WindowOpsOptions {
  /** 审计回调(如写入 DebugDrawer) */
  onAudit?: (entry: WindowAuditEntry) => void
  /** 是否开放只读探测任意路径(默认 false,只能读注册表内) */
  allowRawRead?: boolean
  /** 每个注册属性最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
}

/** 快照条目(per-path 栈) */
export interface WindowSnapshotEntry {
  id: number
  ts: number
  op: 'set' | 'edit' | 'delete' | 'manual' | 'restore'
  label?: string
  /** 修改前的完整深拷贝值 */
  value: unknown
}

type EditOp = 'set' | 'remove' | 'merge' | 'append'

// ============ 点号路径 helper ============

/** 点号路径取值 */
function getByPath(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let cur: any = obj
  for (const k of keys) {
    if (cur == null) return undefined
    cur = cur[k]
  }
  return cur
}

/** 点号路径设值(逐级创建对象) */
function setByPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
}

/** 点号路径删除 */
function deleteByPath(obj: unknown, path: string): boolean {
  const keys = path.split('.')
  let cur: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null) return false
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur == null || !(last in cur)) return false
  delete cur[last]
  return true
}

// ============ 值处理 helper ============

/** JSON 安全深拷贝(值均为可序列化 JSON,顺便剥离 Vue reactive proxy) */
function deepClone<T>(v: T): T {
  return v === undefined ? (undefined as T) : JSON.parse(JSON.stringify(v))
}

/** 安全序列化:循环引用/函数/DOM 节点/bigint 摘要(默认不截断,截断职责交给 offload) */
function safeStringify(value: unknown, maxLen = Infinity): string {
  const seen = new WeakSet()
  let result: string
  try {
    result = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'function') return '[Function]'
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'object' && val !== null) {
          if (typeof HTMLElement !== 'undefined' && val instanceof HTMLElement) {
            return `[HTMLElement: <${val.tagName.toLowerCase()}>]`
          }
          if (typeof Node !== 'undefined' && val instanceof Node) return `[Node: type=${val.nodeType}]`
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      },
      0,
    )
  } catch (e) {
    result = `[无法序列化: ${(e as Error)?.message || String(e)}]`
  }
  if (result.length > maxLen) {
    result = result.slice(0, maxLen) + `\n…[已截断,原长度 ${result.length}]`
  }
  return result
}

// ============ patch helper(校验用副本 + 落地用就地,语义对称) ============

/** 在纯副本上应用 patch(用于整体 schema 校验)。返回 null=成功,字符串=错误信息 */
function applyPatchToClone(clone: any, op: EditOp, jsonPath: string, value: unknown): string | null {
  if (op === 'set') {
    if (!jsonPath) return 'set 操作需要 jsonPath(整体替换请用 set_window_prop)'
    setByPath(clone, jsonPath, value)
    return null
  }
  if (op === 'remove') {
    if (!jsonPath) return 'remove 操作需要 jsonPath'
    deleteByPath(clone, jsonPath)
    return null
  }
  if (op === 'merge') {
    const target = jsonPath ? getByPath(clone, jsonPath) : clone
    if (target == null || typeof target !== 'object' || Array.isArray(target)) {
      return `merge 目标${jsonPath ? `(${jsonPath})` : '(根)'}不是对象`
    }
    Object.assign(target, value)
    return null
  }
  // append
  const arr = jsonPath ? getByPath(clone, jsonPath) : clone
  if (!Array.isArray(arr)) return `append 目标${jsonPath ? `(${jsonPath})` : '(根)'}不是数组`
  if (Array.isArray(value)) arr.push(...value)
  else arr.push(value)
  return null
}

/** 就地把 patch 落到 live window(改子属性,不替换注册属性根引用 → 兼容 reactive) */
function applyPatchToLive(path: string, op: EditOp, jsonPath: string, value: unknown): void {
  if (op === 'set') {
    setByPath(window, `${path}.${jsonPath}`, value)
  } else if (op === 'remove') {
    deleteByPath(window, `${path}.${jsonPath}`)
  } else if (op === 'merge') {
    const target = (jsonPath ? getByPath(window, `${path}.${jsonPath}`) : getByPath(window, path)) as Record<string, unknown>
    Object.assign(target, value)
  } else {
    // append
    const arr = (jsonPath ? getByPath(window, `${path}.${jsonPath}`) : getByPath(window, path)) as unknown[]
    if (Array.isArray(value)) arr.push(...value)
    else arr.push(value)
  }
}

// ============ restore helper(就地还原,保留 reactive 容器引用) ============

/** 就地还原 live 容器内容;叶子(原始类型)直接替换值(改父容器属性,仍触发响应式) */
function restoreLive(path: string, snapshotVal: unknown): void {
  const live = getByPath(window, path)
  if (live !== null && typeof live === 'object') {
    restoreInPlace(live as Record<string, unknown> | unknown[], snapshotVal)
  } else {
    setByPath(window, path, snapshotVal)
  }
}

/** 就地覆盖容器内容,保留引用(数组:清空+push;对象:删多余 key + 覆盖其余) */
function restoreInPlace(live: Record<string, unknown> | unknown[], snapshotVal: unknown): void {
  if (Array.isArray(live)) {
    live.length = 0
    if (Array.isArray(snapshotVal)) live.push(...snapshotVal)
    return
  }
  const snap = snapshotVal && typeof snapshotVal === 'object' && !Array.isArray(snapshotVal)
    ? (snapshotVal as Record<string, unknown>)
    : {}
  for (const k of Object.keys(live)) if (!(k in snap)) delete live[k]
  for (const k of Object.keys(snap)) live[k] = snap[k] // 子属性重新赋值 → Vue 自动重代理 + 触发更新
}

// ============ 工具集构建 ============

/** 基于属性注册表构建 window 操作工具集 */
export function createWindowOps(props: WindowPropSpec[], opts: WindowOpsOptions = {}): StructuredToolInterface[] {
  // 注册表:path → spec
  const registry = new Map<string, WindowPropSpec>()
  for (const p of props) registry.set(p.path, p)

  // 快照栈:path → 条目数组(会话级,FIFO 限长)
  const snapshots = new Map<string, WindowSnapshotEntry[]>()
  const maxSnapshots = opts.maxSnapshots ?? 20

  const audit = (entry: WindowAuditEntry) => {
    opts.onAudit?.(entry)
  }

  /** 写操作前自动存快照(修改前的当前值),返回快照 id */
  function pushSnapshot(path: string, op: WindowSnapshotEntry['op'], label?: string): number {
    const before = deepClone(getByPath(window, path))
    const stack = snapshots.get(path) || []
    const id = stack.length ? stack[stack.length - 1].id + 1 : 1
    stack.push({ id, ts: Date.now(), op, label, value: before })
    while (stack.length > maxSnapshots) stack.shift()
    snapshots.set(path, stack)
    return id
  }

  const listWindowProps = tool(
    async () => {
      if (!registry.size) return '当前没有已注册的可操作 window 属性。'
      const lines = [...registry.values()].map((p) => `- ${p.path}: ${p.description}`)
      return `可操作的 window 属性(共 ${registry.size} 项):\n${lines.join('\n')}`
    },
    {
      name: 'list_window_props',
      description: '列出所有已注册、可操作的 window 属性(path + 说明)。操作 window 前先调用此工具了解可用范围。',
      schema: z.object({}),
    },
  )

  const describeWindowProp = tool(
    async ({ path }) => {
      const p = registry.get(path)
      if (!p) return `属性 "${path}" 未注册。请用 list_window_props 查看可用属性。`
      return [
        `路径: ${p.path}`,
        `说明: ${p.description}`,
        `格式: 写入值需为 JSON,且通过注册时声明的 schema 校验(校验失败时 set_window_prop/edit_window_prop 会返回具体错误)。`,
      ].join('\n')
    },
    {
      name: 'describe_window_prop',
      description: '获取单个已注册 window 属性的说明与格式要求。',
      schema: z.object({ path: z.string().describe('属性路径,如 app.theme') }),
    },
  )

  const getWindowProp = tool(
    async ({ path }) => {
      // 允许读:注册属性自身 / 其后代(精确读局部,如 page.components.0.text)/ 其祖先(读整体)
      const readable =
        opts.allowRawRead ||
        [...registry.keys()].some((k) => path === k || path.startsWith(k + '.') || k.startsWith(path + '.'))
      if (!readable) {
        return `属性 "${path}" 未注册,不可读取。请用 list_window_props 查看可用属性。`
      }
      const val = getByPath(window, path)
      if (val === undefined) return `${path} = (undefined)`
      return `${path} = ${safeStringify(val)}`
    },
    {
      name: 'get_window_prop',
      description: '读取一个已注册 window 属性的当前值(安全序列化:函数/DOM/循环引用做摘要;大结果由系统自动外存,提示用 vfs_read 回读)。',
      schema: z.object({ path: z.string().describe('已注册的属性路径或其祖先') }),
    },
  )

  const setWindowProp = tool(
    async ({ path, value }) => {
      const spec = registry.get(path)
      if (!spec) {
        return `错误:属性 "${path}" 未在注册表中声明,不可写。请用 list_window_props 查看可用属性。`
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return `错误:value 不是合法 JSON 字符串。请传入 JSON 文本。`
      }
      const res = spec.schema.safeParse(parsed)
      if (!res.success) {
        return `校验失败:${res.error.message}\n请按 describe_window_prop("${path}") 查看格式后重试。`
      }
      // 写前快照(支持回退)+ 就地写回(不替换父对象引用,兼容 reactive)
      pushSnapshot(path, 'set')
      setByPath(window, path, res.data)
      audit({ op: 'set', path, value: res.data, timestamp: Date.now() })
      return `已设置 ${path} = ${safeStringify(res.data, 600)}`
    },
    {
      name: 'set_window_prop',
      description:
        '设置一个已注册 window 属性的值(整体替换)。仅能操作注册表内声明的属性;value 为 JSON 字符串,需通过该属性声明的 schema 校验。校验失败会返回错误而非写入。改局部建议用 edit_window_prop,避免重传整个大对象。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径'),
        value: z.string().describe('JSON 字符串形式的值,需符合该属性 schema'),
      }),
    },
  )

  const editWindowProp = tool(
    async ({ path, op, jsonPath, value }) => {
      const spec = registry.get(path)
      if (!spec) {
        return `错误:属性 "${path}" 未在注册表中声明,不可写。请用 list_window_props 查看可用属性。`
      }
      const jp = jsonPath || ''
      // value 解析(set/merge/append 必填)
      let parsed: unknown
      if (op !== 'remove') {
        if (value === undefined || value === '') {
          return `错误:${op} 操作需要 value(JSON 字符串)。`
        }
        try {
          parsed = JSON.parse(value)
        } catch {
          return `错误:value 不是合法 JSON 字符串。`
        }
      }
      const current = getByPath(window, path)
      if (current == null || typeof current !== 'object') {
        return `错误:edit 仅适用于对象/数组属性,"${path}" 当前是 ${current === undefined ? 'undefined' : typeof current}。叶子属性请用 set_window_prop。`
      }
      // ① 在深拷贝副本上应用 patch → 整体 schema 校验(不写入)
      const clone = deepClone(current)
      const patchErr = applyPatchToClone(clone, op, jp, parsed)
      if (patchErr) return `错误:${patchErr}`
      const res = spec.schema.safeParse(clone)
      if (!res.success) {
        return `校验失败:${res.error.message}\n请按 describe_window_prop("${path}") 查看格式后重试。`
      }
      // ② 校验通过 → 写前快照 + 就地落地(改子属性,不替换注册属性根引用 → 兼容 reactive)
      pushSnapshot(path, 'edit')
      applyPatchToLive(path, op, jp, parsed)
      audit({ op: 'edit', path, detail: `${op}${jp ? '@' + jp : ''}`, value: parsed, timestamp: Date.now() })
      return `已 edit ${path}(${op}${jp ? ' @ ' + jp : ''})。当前值:${safeStringify(getByPath(window, path), 600)}`
    },
    {
      name: 'edit_window_prop',
      description:
        '增量编辑一个已注册的「对象/数组」window 属性,只发改动的 patch,无需重传整个大对象。op:set(在 jsonPath 设值)、remove(删 jsonPath)、merge(把 value 合并到 jsonPath 指向的对象,默认根)、append(把 value 追加到 jsonPath 指向的数组,默认根)。jsonPath 为相对属性根的点号路径(数组索引用数字,如 components.0.text);value 为 JSON 字符串。整体仍经 schema 校验,失败不写入。',
      schema: z.object({
        path: z.string().describe('已注册的对象/数组属性路径'),
        op: z.enum(['set', 'remove', 'merge', 'append']),
        jsonPath: z.string().optional().describe('相对属性根的点号路径(数组索引用数字,如 components.0.text)。set/remove 必填;merge/append 不填则作用于根'),
        value: z.string().optional().describe('JSON 字符串(set/merge/append 必填)'),
      }),
    },
  )

  const deleteWindowProp = tool(
    async ({ path }) => {
      if (!registry.has(path)) {
        return `错误:属性 "${path}" 未在注册表中声明,不可删除。请用 list_window_props 查看可用属性。`
      }
      pushSnapshot(path, 'delete')
      const ok = deleteByPath(window, path)
      audit({ op: 'delete', path, timestamp: Date.now() })
      return ok ? `已删除 ${path}` : `${path} 不存在(无需删除)`
    },
    {
      name: 'delete_window_prop',
      description: '删除一个已注册 window 属性。',
      schema: z.object({ path: z.string().describe('已注册的属性路径') }),
    },
  )

  const snapshotWindowProp = tool(
    async ({ path, label }) => {
      if (!registry.has(path)) {
        return `错误:属性 "${path}" 未注册,无法打快照。请用 list_window_props 查看可用属性。`
      }
      const id = pushSnapshot(path, 'manual', label)
      return `已为 ${path} 创建快照 #${id}${label ? `(${label})` : ''}。可用 list_window_snapshots 查看、restore_window_snapshot 回退。`
    },
    {
      name: 'snapshot_window_prop',
      description: '为已注册 window 属性手动创建一个命名快照(检查点)。set/edit/delete 也会自动存快照。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径'),
        label: z.string().optional().describe('可选的快照标签,便于识别'),
      }),
    },
  )

  const listWindowSnapshots = tool(
    async ({ path }) => {
      const paths = path ? [path] : [...registry.keys()]
      if (path && !registry.has(path)) {
        return `错误:属性 "${path}" 未注册。`
      }
      const lines: string[] = []
      for (const p of paths) {
        const stack = snapshots.get(p) || []
        if (!stack.length) {
          if (path) lines.push(`${p}: 无快照`)
          continue
        }
        lines.push(`${p}(共 ${stack.length} 条):`)
        for (const s of stack) {
          const size = JSON.stringify(s.value ?? '').length
          const time = new Date(s.ts).toLocaleTimeString('zh-CN', { hour12: false })
          lines.push(`  #${s.id} [${s.op}]${s.label ? ` "${s.label}"` : ''} ${time} 修改前≈${size}字符`)
        }
      }
      return (
        lines.join('\n') ||
        '无快照。set/edit/delete 会自动存快照,也可用 snapshot_window_prop 手动创建检查点。'
      )
    },
    {
      name: 'list_window_snapshots',
      description: '列出 window 属性的快照时间线(序号、操作类型、标签、大小)。不传 path 列出所有属性。',
      schema: z.object({ path: z.string().optional().describe('限定单个属性,不传则列出全部') }),
    },
  )

  const restoreWindowSnapshot = tool(
    async ({ path, id }) => {
      const spec = registry.get(path)
      if (!spec) {
        return `错误:属性 "${path}" 未注册。请用 list_window_props 查看可用属性。`
      }
      const stack = snapshots.get(path) || []
      if (!stack.length) {
        return `错误:"${path}" 无快照可回退。`
      }
      const entry = id !== undefined ? stack.find((s) => s.id === id) : stack[stack.length - 1]
      if (!entry) {
        return `错误:未找到快照 #${id}。请用 list_window_snapshots 查看可用快照。`
      }
      // 保险:快照值应符合当前 schema(历史值本应合法)
      const chk = spec.schema.safeParse(entry.value)
      if (!chk.success) {
        return `错误:快照 #${entry.id} 的值不符合当前 schema,无法回退:${chk.error.message}`
      }
      // 就地还原(保留 reactive 容器引用);restore 不再入栈(避免无限增长)
      restoreLive(path, deepClone(entry.value))
      audit({ op: 'restore', path, detail: `#${entry.id}`, timestamp: Date.now() })
      return `已回退 ${path} 到快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}。`
    },
    {
      name: 'restore_window_snapshot',
      description: '把已注册 window 属性回退到某个快照(就地还原,保留响应式)。不传 id 则回退最近一次(快速回退)。可用 list_window_snapshots 查看快照列表。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径'),
        id: z.number().int().optional().describe('指定快照序号;不传则回退最近一次'),
      }),
    },
  )

  const getWindowPaths = tool(
    async ({ paths }) => {
      const lines: string[] = []
      for (const p of paths) {
        // 范围:注册属性自身 / 后代(精确读局部)/ 祖先(读整体)
        const allowed =
          opts.allowRawRead ||
          [...registry.keys()].some((k) => p === k || p.startsWith(k + '.') || k.startsWith(p + '.'))
        if (!allowed) {
          lines.push(`- ${p} = (未注册,不可读。用 list_window_props 查看可用属性)`)
          continue
        }
        const val = getByPath(window, p)
        lines.push(`- ${p} = ${val === undefined ? '(undefined)' : safeStringify(val)}`)
      }
      return lines.join('\n')
    },
    {
      name: 'get_window_paths',
      description:
        '批量按路径读取 window 属性的局部或多个字段(避免对大 JSON 整体读取)。paths 支持注册属性的任意后代路径(如 page.components.0.text)、自身、或祖先。逐行返回 path = value;单个值过大仍由系统自动外存 vfs。',
      schema: z.object({
        paths: z.array(z.string().describe('路径,如 page.components.0.text')).min(1).max(20),
      }),
    },
  )

  return [
    listWindowProps,
    describeWindowProp,
    getWindowProp,
    getWindowPaths,
    setWindowProp,
    editWindowProp,
    deleteWindowProp,
    snapshotWindowProp,
    listWindowSnapshots,
    restoreWindowSnapshot,
  ]
}
