/**
 * window 操作工具 —— 属性注册表 + schema 校验 + 增量编辑 + 快照回退(无人工审批)
 *
 * 设计(见 specs/page-agent-core.md):
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
import { jpEval, searchJson, runSandboxedScript, type SearchMode } from './windowQuery'
import { toolError, zodError, jsonParseError, formatZodIssues } from './toolError'

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
  /**
   * 字段白名单读模式(默认 true):仅允许读「注册 path 自身 / 其后代」,禁止读未注册的祖先,
   * 防止 LLM 经 get_window_prop('page') 把整个大 JSON 拉进上下文。
   * 设 false 回退原行为(允许读注册 path 的祖先,即整体读)。
   * 集成方注册「可操作子路径」(如 page.theme.color / page.components)而非顶层时,默认即「LLM 只见声明字段」。
   */
  whitelist?: boolean
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

/** 危险 key:经点号路径可触发原型污染(__proto__ 访问/改 Object.prototype、constructor/prototype 链),一律拒绝 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 路径任一段命中危险 key → 不安全。LLM 可控的 jsonPath 必须先过此关,防原型污染 */
function isUnsafePath(path: string): boolean {
  return path.split('.').some((k) => UNSAFE_KEYS.has(k))
}

/**
 * 安全合并:逐 own键赋值,跳过 __proto__/constructor/prototype。
 * Object.assign 会因源对象 own 的 __proto__ 键触发原型 setter 污染 target 原型
 * (JSON.parse 产生的 {"__proto__":...} 是 own property,非字面量 setter),故 merge 必经此函数。
 */
function safeMerge(target: Record<string, any>, src: unknown): void {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return
  for (const k of Object.keys(src)) {
    if (UNSAFE_KEYS.has(k)) continue
    target[k] = (src as Record<string, any>)[k]
  }
}

/** 点号路径取值 */
function getByPath(obj: unknown, path: string): unknown {
  if (isUnsafePath(path)) return undefined
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
  if (isUnsafePath(path)) return
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
  if (isUnsafePath(path)) return false
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

/**
 * 乐观锁 hash:对值做稳定序列化 + djb2 哈希,返回短 hash 字符串(如 "a3f9b2")。
 * 用于 set/edit/delete 的 expectedHash 校验:agent get 时拿到 hash,写入时回传,
 * 工具对比当前值 hash 与 expectedHash,不一致 → 属性已被改(外部代码/其他 agent/用户手动)→ CONFLICT。
 * 不依赖响应式,通用(服务端/普通 JSON/reactive 都行);碰撞概率极低(djb2 32 位)。
 */
function hashValue(value: unknown): string {
  const s = safeStringify(value)
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
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
    safeMerge(target as Record<string, any>, value)
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
    safeMerge(target as Record<string, any>, value)
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

/** window 属性注册表控制器(运行时动态增删,供 createChatSdk 暴露 sdk.addWindowProp 等) */
export interface WindowOpsController {
  /** 新增/覆盖一个属性注册项(运行时懒加载组件场景);覆盖时旧快照栈保留 */
  add(spec: WindowPropSpec): void
  /** 移除一个属性注册项;返回是否确实存在并移除。快照栈一并清理 */
  remove(path: string): boolean
  /** 列出当前所有注册项(反映动态增删后的最新状态,供 inspect() 用) */
  list(): WindowPropSpec[]
  /** 是否已注册某 path */
  has(path: string): boolean
}

/** 基于属性注册表构建 window 操作工具集 */
export function createWindowOps(props: WindowPropSpec[], opts: WindowOpsOptions = {}): StructuredToolInterface[] {
  // 注册表:path → spec
  const registry = new Map<string, WindowPropSpec>()
  for (const p of props) registry.set(p.path, p)

  // 快照栈:path → 条目数组(会话级,FIFO 限长)
  const snapshots = new Map<string, WindowSnapshotEntry[]>()
  const maxSnapshots = opts.maxSnapshots ?? 20

  // 运行时动态注册控制器(操作同一 registry/snapshots 闭包,工具运行时即时生效,无需重 bind)
  const controller: WindowOpsController = {
    add: (spec) => { registry.set(spec.path, spec) },
    remove: (path) => {
      const had = registry.delete(path)
      if (had) snapshots.delete(path)
      return had
    },
    list: () => [...registry.values()],
    has: (path) => registry.has(path),
  }

  const audit = (entry: WindowAuditEntry) => {
    opts.onAudit?.(entry)
  }

  // B:写操作成功后附「当前可操作 path 列表」提示,让 LLM 写完即知全貌(多组件批量场景减少 list 调用)
  function pathsHint(): string {
    const ps = [...registry.keys()]
    if (!ps.length) return ''
    // 控制长度:超过 8 个 path 或总长 > 240 字符时只报数量,避免提示过长
    const joined = ps.join(', ')
    if (ps.length > 8 || joined.length > 240) return `\n(当前可操作属性共 ${ps.length} 项,用 list_window_props 查看)`
    return `\n(当前可操作 path: ${joined})`
  }

  // 字段白名单读模式(默认 true):仅注册 path 自身/后代可读;false 时允许读祖先(整体读)
  const allowAncestorRead = (opts.whitelist ?? true) === false
  /** 读权限:allowRawRead 最高;否则注册 path 自身/后代可读;非白名单模式另允许祖先读 */
  function canRead(path: string): boolean {
    if (opts.allowRawRead) return true
    return [...registry.keys()].some(
      (k) => path === k || path.startsWith(k + '.') || (allowAncestorRead && k.startsWith(path + '.')),
    )
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
      if (!p) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      return [
        `路径: ${p.path}`,
        `说明: ${p.description}`,
        `格式: 写入值需为 JSON,且通过注册时声明的 schema 校验(校验失败时 set_window_prop/edit_window_prop 会返回结构化错误,含具体字段与期望类型)。`,
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
      // 字段白名单读模式(默认):仅注册 path 自身/后代可读;非白名单模式另允许祖先读(整体读)
      if (!canRead(path)) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 不可读取(未注册,且非已注册路径的后代)`,
          hint: '用 list_window_props 查看可操作字段;字段白名单读模式下未注册的祖先(整体大 JSON)不暴露,需读其声明子路径',
        })
      }
      const val = getByPath(window, path)
      if (val === undefined) return `${path} = (undefined)`
      return `${path} = ${safeStringify(val)} (hash=${hashValue(val)})`
    },
    {
      name: 'get_window_prop',
      description:
        '读取一个已注册 window 属性的当前值(安全序列化:函数/DOM/循环引用做摘要;大结果由系统自动外存,提示用 vfs_read 回读)。返回含 hash(乐观锁):改属性前先 get 拿 hash,写入时(set/edit/delete)传 expectedHash 回传,系统对比当前 hash 防"基于过期值覆盖"(外部代码/其他 agent/用户手动改过会 CONFLICT,需重新 get 再改)。字段白名单读模式(默认)下仅可读注册 path 自身/后代;未注册祖先(整体大 JSON)不可读,避免大 JSON 拉进上下文。',
      schema: z.object({ path: z.string().describe('已注册的属性路径或其后代') }),
    },
  )

  const setWindowProp = tool(
    async ({ path, value, expectedHash }) => {
      const spec = registry.get(path)
      if (!spec) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未在注册表中声明,不可写`,
          hint: '用 list_window_props 查看可用属性;集成方需先在 windowProps 声明该 path',
        })
      }
      // 乐观锁:传了 expectedHash 则对比当前值 hash,不一致 → 属性已被外部/其他操作改过 → 拒绝,让 agent 重新 get 再改
      if (expectedHash !== undefined && expectedHash !== '') {
        const cur = getByPath(window, path)
        const curHash = hashValue(cur)
        if (curHash !== expectedHash) {
          return toolError({
            code: 'VERSION_CONFLICT',
            path,
            message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash},属性 "${path}" 在你 get 之后已被修改(外部代码/其他 agent/用户手动改)`,
            hint: `重新 get_window_prop("${path}") 拿最新值与 hash,基于最新值修改后再写入(传新的 expectedHash)。当前值:${safeStringify(cur, 400)}`,
          })
        }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch (e) {
        return jsonParseError(path, value, e)
      }
      const res = spec.schema.safeParse(parsed)
      if (!res.success) {
        return zodError(path, res.error.issues)
      }
      // 写前快照(支持回退)+ 就地覆盖(对象/数组保留 reactive 容器引用,语义=整体替换;原始值直接赋值)
      pushSnapshot(path, 'set')
      const live = getByPath(window, path)
      if (live !== null && typeof live === 'object' && res.data !== null && typeof res.data === 'object') {
        restoreInPlace(live as Record<string, unknown> | unknown[], res.data)
      } else {
        setByPath(window, path, res.data)
      }
      audit({ op: 'set', path, value: res.data, timestamp: Date.now() })
      return `已设置 ${path} = ${safeStringify(res.data, 600)} (新 hash=${hashValue(getByPath(window, path))})${pathsHint()}`
    },
    {
      name: 'set_window_prop',
      description:
        '设置一个已注册 window 属性的值(整体替换)。仅能操作注册表内声明的属性;value 为 JSON 字符串,需通过该属性声明的 schema 校验。校验失败会返回错误而非写入。expectedHash(可选):改前 get_window_prop 返回的 hash,传入则启用乐观锁——若属性已被改过(外部代码/其他 agent/用户手动)则返回 VERSION_CONFLICT 不写入,需重新 get 再改,防"基于过期值覆盖"。大对象/数组强烈建议改用 edit_window_prop 增量 patch。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径'),
        value: z.string().describe('JSON 字符串形式的值,需符合该属性 schema'),
        expectedHash: z.string().optional().describe('乐观锁:改前 get_window_prop 返回的 hash;传入则校验,不一致拒绝写入防覆盖'),
      }),
    },
  )

  const editWindowProp = tool(
    async ({ path, op, jsonPath, value, expectedHash }) => {
      const spec = registry.get(path)
      if (!spec) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未在注册表中声明,不可写`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      const jp = jsonPath || ''
      // 原型污染防御:jsonPath 由 LLM 完全可控,含 __proto__/constructor/prototype 段一律拒绝
      if (isUnsafePath(jp)) {
        return toolError({
          code: 'PATH_UNSAFE',
          path,
          message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`,
          hint: '使用正常的属性路径,如 components.0.text(数组索引用数字)',
        })
      }
      const current = getByPath(window, path)
      // 乐观锁:传了 expectedHash 则对比当前值 hash,不一致 → 已被改过 → 拒绝
      if (expectedHash !== undefined && expectedHash !== '') {
        const curHash = hashValue(current)
        if (curHash !== expectedHash) {
          return toolError({
            code: 'VERSION_CONFLICT',
            path,
            message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash},属性 "${path}" 在你 get 之后已被修改(外部代码/其他 agent/用户手动改)`,
            hint: `重新 get_window_prop("${path}") 拿最新值与 hash,基于最新值修改后再 edit(传新的 expectedHash)。当前值:${safeStringify(current, 400)}`,
          })
        }
      }
      if (current == null || typeof current !== 'object') {
        return toolError({
          code: 'NOT_OBJECT',
          path,
          message: `edit 仅适用于对象/数组属性,"${path}" 当前是 ${current === undefined ? 'undefined' : typeof current}`,
          hint: '叶子属性(原始类型)请用 set_window_prop 整体设置',
        })
      }
      // value 解析(set/merge/append 必填)
      let parsed: unknown
      if (op !== 'remove') {
        if (value === undefined || value === '') {
          return toolError({
            code: 'MISSING_VALUE',
            path,
            message: `${op} 操作需要 value(JSON 字符串)`,
            hint: `op 为 ${op} 时 value 必填;若想删除请用 op:'remove'`,
          })
        }
        try {
          parsed = JSON.parse(value)
        } catch (e) {
          return jsonParseError(path, value, e)
        }
      }
      // ① 在深拷贝副本上应用 patch → 整体 schema 校验(不写入)
      const clone = deepClone(current)
      const patchErr = applyPatchToClone(clone, op, jp, parsed)
      if (patchErr) {
        return toolError({
          code: 'PATCH_FAILED',
          path,
          message: patchErr,
          hint: '检查 op 与目标类型:merge 需目标为对象,append 需目标为数组;jsonPath 指向需存在',
        })
      }
      const res = spec.schema.safeParse(clone)
      if (!res.success) {
        return zodError(path, res.error.issues)
      }
      // ② 校验通过 → 写前快照 + 就地落地(改子属性,不替换注册属性根引用 → 兼容 reactive)
      pushSnapshot(path, 'edit')
      applyPatchToLive(path, op, jp, parsed)
      audit({ op: 'edit', path, detail: `${op}${jp ? '@' + jp : ''}`, value: parsed, timestamp: Date.now() })
      return `已 edit ${path}(${op}${jp ? ' @ ' + jp : ''})。当前值:${safeStringify(getByPath(window, path), 600)} (新 hash=${hashValue(getByPath(window, path))})${pathsHint()}`
    },
    {
      name: 'edit_window_prop',
      description:
        '增量编辑一个已注册的「对象/数组」window 属性,只发改动的 patch,无需重传整个大对象。op:set(在 jsonPath 设值)、remove(删 jsonPath)、merge(把 value 合并到 jsonPath 指向的对象,默认根)、append(把 value 追加到 jsonPath 指向的数组,默认根)。jsonPath 为相对属性根的点号路径(数组索引用数字,如 components.0.text);value 为 JSON 字符串。整体仍经 schema 校验,失败不写入。expectedHash(可选):改前 get_window_prop 返回的 hash,传入启用乐观锁防"基于过期值覆盖"。',
      schema: z.object({
        path: z.string().describe('已注册的对象/数组属性路径'),
        op: z.enum(['set', 'remove', 'merge', 'append']),
        jsonPath: z.string().optional().describe('相对属性根的点号路径(数组索引用数字,如 components.0.text)。set/remove 必填;merge/append 不填则作用于根'),
        value: z.string().optional().describe('JSON 字符串(set/merge/append 必填)'),
        expectedHash: z.string().optional().describe('乐观锁:改前 get_window_prop 返回的 hash;传入则校验,不一致拒绝写入防覆盖'),
      }),
    },
  )

  const deleteWindowProp = tool(
    async ({ path, expectedHash }) => {
      if (!registry.has(path)) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未在注册表中声明,不可删除`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      // 乐观锁:传了 expectedHash 则对比当前值 hash,不一致 → 已被改过 → 拒绝
      if (expectedHash !== undefined && expectedHash !== '') {
        const cur = getByPath(window, path)
        const curHash = hashValue(cur)
        if (curHash !== expectedHash) {
          return toolError({
            code: 'VERSION_CONFLICT',
            path,
            message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash},属性 "${path}" 在你 get 之后已被修改`,
            hint: `重新 get_window_prop("${path}") 拿最新值与 hash 再决定是否删除。当前值:${safeStringify(cur, 400)}`,
          })
        }
      }
      pushSnapshot(path, 'delete')
      const ok = deleteByPath(window, path)
      audit({ op: 'delete', path, timestamp: Date.now() })
      return ok ? `已删除 ${path}${pathsHint()}` : `${path} 不存在(无需删除)${pathsHint()}`
    },
    {
      name: 'delete_window_prop',
      description: '删除一个已注册 window 属性。expectedHash(可选):改前 get_window_prop 返回的 hash,传入启用乐观锁防"基于过期值删除"。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径'),
        expectedHash: z.string().optional().describe('乐观锁:改前 get_window_prop 返回的 hash;传入则校验,不一致拒绝删除防覆盖'),
      }),
    },
  )

  const snapshotWindowProp = tool(
    async ({ path, label }) => {
      if (!registry.has(path)) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册,无法打快照`,
          hint: '用 list_window_props 查看可用属性',
        })
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
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
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
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      const stack = snapshots.get(path) || []
      if (!stack.length) {
        return toolError({
          code: 'NO_SNAPSHOT',
          path,
          message: `"${path}" 无快照可回退`,
          hint: 'set/edit/delete 会自动存快照;也可先 snapshot_window_prop 手动创建检查点',
        })
      }
      const entry = id !== undefined ? stack.find((s) => s.id === id) : stack[stack.length - 1]
      if (!entry) {
        return toolError({
          code: 'SNAPSHOT_NOT_FOUND',
          path,
          message: `未找到快照 #${id}`,
          hint: '用 list_window_snapshots 查看可用快照序号',
        })
      }
      // 保险:快照值应符合当前 schema(历史值本应合法)
      const chk = spec.schema.safeParse(entry.value)
      if (!chk.success) {
        return toolError({
          code: 'SNAPSHOT_SCHEMA_INVALID',
          path,
          message: `快照 #${entry.id} 的值不符合当前 schema,无法回退`,
          hint: 'schema 可能已变更;该快照已过期,选其他快照或重新设置',
          details: formatZodIssues(chk.error.issues),
        })
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
        if (!canRead(p)) {
          lines.push(`- ${p} = ERROR: ${toolError({ code: 'NOT_REGISTERED', path: p, message: `不可读取(未注册,且非已注册路径的后代)`, hint: '用 list_window_props 查看可操作字段' })}`)
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
        '批量按路径读取 window 属性的局部或多个字段(避免对大 JSON 整体读取)。paths 支持注册属性的任意后代路径(如 page.components.0.text)、自身。字段白名单读模式(默认)下未注册祖先不可读。逐行返回 path = value;单个值过大仍由系统自动外存 vfs。',
      schema: z.object({
        paths: z.array(z.string().describe('路径,如 page.components.0.text')).min(1).max(20),
      }),
    },
  )

  // ============ 大 JSON 查询/搜索/脚本(只读探查为主,transform 写回经 schema 校验) ============

  const queryWindowProp = tool(
    async ({ path, expr, limit }) => {
      const spec = registry.get(path)
      if (!spec) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      const root = getByPath(window, path)
      if (root == null || typeof root !== 'object') {
        return toolError({
          code: 'NOT_OBJECT',
          path,
          message: `"${path}" 不是对象/数组,无法查询(当前为 ${root === undefined ? 'undefined' : typeof root})`,
          hint: 'query 仅适用于对象/数组;叶子属性用 get_window_prop 读',
        })
      }
      let nodes
      try {
        nodes = jpEval(root, expr)
      } catch (e) {
        return toolError({
          code: 'JSONPATH_SYNTAX',
          path,
          message: `JSONPath 解析错误: ${(e as Error).message}`,
          hint: '语法子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..*;filter:@.field op literal,&&/||/();对象根需先点出数组字段再过滤,如 $.components[?(@.x>1)]',
          details: { expr },
        })
      }
      const cap = limit ?? 50
      const sliced = nodes.slice(0, cap)
      // 每个结果独立 safeStringify(各自 fresh WeakSet),避免父子同现时
      // 共享引用被外层 WeakSet 误判为 [Circular](树查询时父节点结果含子、子又是独立结果的典型场景)
      const parts = sliced.map(
        (n) =>
          `{"path":${JSON.stringify(n.path)},"index":${n.index === undefined ? 'null' : n.index},"value":${safeStringify(n.value)}}`,
      )
      return `{"matched":${nodes.length},"returned":${sliced.length},"truncated":${nodes.length > cap},"results":[${parts.join(',')}]}`
    },
    {
      name: 'query_window_prop',
      description:
        '用 JSONPath 表达式对一个已注册的对象/数组属性做结构化查询(只读,无副作用)。语法子集:$ 根、.key、[n]、["key"]、[*] 通配、[?(filter)] 过滤、..key 递归找后代、..* 全后代。过滤表达式:@.field op literal(op:==/!=/</<=/>/>=),&&/||/() 连接;@ 指当前元素。注意过滤作用于"当前节点的子元素数组",若注册属性是对象需先点出数组字段再过滤,如 $.components[?(@.type=="card" && @.price<100)]。返回匹配元素的 path(相对属性根,数组索引可作后续 edit_window_prop 的 jsonPath)+ index(若父为数组)+ value。适合在大数组里按条件筛选元素,定位后再用 edit_window_prop 增量改。',
      schema: z.object({
        path: z.string().describe('已注册的对象/数组属性路径'),
        expr: z
          .string()
          .describe(
            'JSONPath 表达式,如 $[?(@.type=="card" && @.price<100)] 或 $..title(递归找所有 title)',
          ),
        limit: z.number().int().min(1).max(200).optional().describe('返回结果上限,默认 50'),
      }),
    },
  )

  const searchWindowProp = tool(
    async ({ path, query, mode, fuzzyThreshold, matchKey, limit }) => {
      const spec = registry.get(path)
      if (!spec) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      const root = getByPath(window, path)
      if (root == null) return toolError({ code: 'EMPTY', path, message: `"${path}" 为空,无可搜索内容` })
      try {
        const hits = searchJson(root, query, {
          mode: mode as SearchMode,
          fuzzyThreshold,
          matchKey,
          limit: limit ?? 50,
        })
        return safeStringify({ matched: hits.length, results: hits })
      } catch (e) {
        return toolError({
          code: 'REGEX_INVALID',
          path,
          message: `搜索错误: ${(e as Error).message}`,
          hint: 'regex 模式下 query 须为合法正则;改 mode 为 substring/fuzzy 可避免正则语法问题',
          details: { query },
        })
      }
    },
    {
      name: 'search_window_prop',
      description:
        '在一个已注册 window 属性内做文本搜索(只读,无副作用)。mode:substring(子串,默认,大小写不敏感)、regex(正则,i 标志)、fuzzy(模糊:子串命中或 Levenshtein 距离 ≤ fuzzyThreshold)。递归遍历所有叶子值(及可选 key),返回命中元素的 path + value(超 200 字符截断)。适合在大 JSON 里找名字近似、记不清的元素,定位 path 后用 edit_window_prop 改。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径(在它的子树内搜索)'),
        query: z.string().describe('搜索词(substring/regex/fuzzy 共用)'),
        mode: z.enum(['substring', 'regex', 'fuzzy']).optional().describe('匹配模式,默认 substring'),
        fuzzyThreshold: z.number().int().min(0).max(5).optional().describe('fuzzy 模式最大编辑距离,默认 2'),
        matchKey: z.boolean().optional().describe('是否同时匹配 key 名,默认 true'),
        limit: z.number().int().min(1).max(200).optional().describe('返回上限,默认 50'),
      }),
    },
  )

  const evalWindowScript = tool(
    async ({ path, script, mode }) => {
      const spec = registry.get(path)
      if (!spec) {
        return toolError({
          code: 'NOT_REGISTERED',
          path,
          message: `属性 "${path}" 未注册`,
          hint: '用 list_window_props 查看可用属性',
        })
      }
      if (script.length > 8000) {
        return toolError({
          code: 'SCRIPT_TOO_LARGE',
          path,
          message: `脚本过长(${script.length} 字符,上限 8000)`,
          hint: '精简脚本;复杂逻辑可分步(先 query 探查再 transform 改),或拆成多次 eval',
        })
      }
      const root = getByPath(window, path)
      // query 模式:对深拷贝跑脚本,返回结果(只读,不改 window)
      // transform 模式:脚本返回新值 → schema 校验 → 就地落地
      const data = deepClone(root)
      const res = await runSandboxedScript(data, script, 3000)
      if (!res.ok) {
        const isTimeout = /超时/.test(res.error || '')
        return toolError({
          code: isTimeout ? 'SCRIPT_TIMEOUT' : 'SCRIPT_ERROR',
          path,
          message: `脚本执行失败: ${res.error}`,
          hint: isTimeout
            ? '脚本可能有死循环或过重计算;加边界检查/分批;transform 返回完整新值勿返回巨大中间结果'
            : '检查脚本语法与运行时错误;入参为 data(属性深拷贝),沙箱内禁用 fetch/XHR/WebSocket',
          details: { elapsedMs: res.elapsedMs, scriptLen: script.length },
        })
      }
      if (mode === 'transform') {
        const chk = spec.schema.safeParse(res.result)
        if (!chk.success) {
          return toolError({
            code: 'SCHEMA_INVALID',
            path,
            message: `脚本返回值校验失败,未写入(transform 模式要求返回该属性的完整新值且符合 schema)`,
            hint: `确认脚本 return 了完整新值(非部分);按 describe_window_prop("${path}") 查看格式`,
            details: formatZodIssues(chk.error.issues),
          })
        }
        pushSnapshot(path, 'edit', 'eval_transform')
        const live = getByPath(window, path)
        if (live !== null && typeof live === 'object' && chk.data !== null && typeof chk.data === 'object') {
          restoreInPlace(live as Record<string, unknown> | unknown[], chk.data)
        } else {
          setByPath(window, path, chk.data)
        }
        audit({ op: 'edit', path, detail: 'eval_transform', timestamp: Date.now() })
        return `已通过脚本 transform 更新 ${path}(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(getByPath(window, path), 600)}`
      }
      // query 模式
      return safeStringify({ ok: true, result: res.result, elapsedMs: res.elapsedMs })
    },
    {
      name: 'eval_window_script',
      description:
        '在隔离的 Web Worker 沙箱里对一个已注册 window 属性跑自定义 JS 脚本(无 window/document 访问,fetch/XHR/WebSocket/importScripts 已禁用,超时 3s 可终止)。脚本以 `data` 为入参(该属性的深拷贝),返回值即结果。mode:query(默认,只读,把返回值回给 LLM,适合过滤/映射/聚合/统计大数组)、transform(把返回值作为该属性的新整体值,经 schema 校验后就地落地,适合批量重写)。注意:transform 需返回完整新值;query 不改 window。脚本内可用标准 JS(Array/Object/JSON/Math 等)与 async/await。',
      schema: z.object({
        path: z.string().describe('已注册的属性路径,其深拷贝作为脚本的 data 入参'),
        script: z
          .string()
          .describe(
            'JS 脚本体,如 data.filter(c=>c.stock>0).map(c=>c.id);入参名 data;末尾表达式或 return 即返回值',
          ),
        mode: z.enum(['query', 'transform']).optional().describe('query=只读返回结果(默认),transform=校验后落地为新值'),
      }),
    },
  )

  const tools: StructuredToolInterface[] = [
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
    queryWindowProp,
    searchWindowProp,
    evalWindowScript,
  ]
  // 挂控制器到工具数组(不可枚举:不影响 selectBuiltinTools 遍历/长度;createChatSdk 经 .controller 取用)
  Object.defineProperty(tools, 'controller', { value: controller, enumerable: false, configurable: false, writable: false })
  return tools
}
