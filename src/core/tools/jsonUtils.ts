/**
 * 通用 JSON 操作纯函数 —— 零依赖,从 dataOps.ts 抽离(refactor-module-extraction)。
 * 含路径操作 / 克隆序列化 / 投影截断 / 原型污染防护 / patch 应用。
 * 纯函数无状态、易白盒单测,对外开放经 ./query subpath。
 *
 * 后续新纯函数归宿:harden-optimistic-lock 的 cyrb53(hash 升级)、
 * evolve-default-toolset 的 diffObjects(差异对比)落入本文件。
 */

export type EditOp = 'set' | 'remove' | 'merge' | 'append'

export const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isUnsafePath(path: string): boolean {
  return path.split('.').some((k) => UNSAFE_KEYS.has(k))
}

export function safeMerge(target: Record<string, any>, src: unknown): void {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return
  for (const k of Object.keys(src)) {
    if (UNSAFE_KEYS.has(k)) continue
    target[k] = (src as Record<string, any>)[k]
  }
}

export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  if (isUnsafePath(path)) return undefined
  const keys = path.split('.')
  let cur: any = obj
  for (const k of keys) {
    if (cur == null) return undefined
    cur = cur[k]
  }
  return cur
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  if (!path || isUnsafePath(path)) return
  const keys = path.split('.')
  let cur: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
}

export function deleteByPath(obj: unknown, path: string): boolean {
  if (!path || isUnsafePath(path)) return false
  const keys = path.split('.')
  let cur: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null) return false
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur == null || !(last in cur)) return false
  // 已知问题:数组元素用 delete 产生稀疏数组(不 shift 后续索引),由 fix-dataops-write-correctness 改为 splice
  delete cur[last]
  return true
}

export function deepClone<T>(v: T): T {
  return v === undefined ? (undefined as T) : JSON.parse(JSON.stringify(v))
}

/**
 * 字符串 value 智能解析:
 *  - 以 { / [ 开头(意图是 JSON 对象/数组):按 JSON 解析,失败报 JSON_PARSE(笔误提示)
 *  - 其他(裸字面量如 '5'、'"str"'、'c'):尝试解析以支持 '5'→5、'"s"'→s;失败则当原值字符串('c'→'c')
 *  - 非字符串原样返回
 */
export function maybeParseValue(v: unknown): { parsed?: unknown; parseError?: unknown } {
  if (typeof v !== 'string') return { parsed: v }
  const s = v.trim()
  if (!s) return { parsed: v }
  const looksLikeJson = s[0] === '{' || s[0] === '['
  try {
    return { parsed: JSON.parse(s) }
  } catch (e) {
    if (looksLikeJson) return { parseError: e }
    return { parsed: v }
  }
}

/** 字段投影:只保留对象(及数组元素)的指定字段 */
export function projectFields(obj: unknown, fields: string[]): unknown {
  if (obj == null || typeof obj !== 'object') return obj
  const set = new Set(fields)
  if (Array.isArray(obj)) return obj.map((o) => projectFields(o, fields))
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) if (set.has(k)) out[k] = (obj as Record<string, unknown>)[k]
  return out
}

/** 深度截断:depth=0 根占位,递归到 depth 层后用 {...}/[...] 占位 */
export function limitDepth(obj: unknown, depth: number): unknown {
  if (obj == null || typeof obj !== 'object') return obj
  if (depth <= 0) return Array.isArray(obj) ? `[...${obj.length}]` : '{...}'
  if (Array.isArray(obj)) return obj.map((o) => limitDepth(o, depth - 1))
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) out[k] = limitDepth((obj as Record<string, unknown>)[k], depth - 1)
  return out
}

export function safeStringify(value: unknown, maxLen = Infinity): string {
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

export function hashValue(value: unknown): string {
  const s = safeStringify(value)
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function applyPatchToClone(clone: any, op: EditOp, jsonPath: string, value: unknown): string | null {
  if (op === 'set') {
    if (!jsonPath) return 'set 操作需要 jsonPath(整体替换请用 set_data)'
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
  const arr = jsonPath ? getByPath(clone, jsonPath) : clone
  if (!Array.isArray(arr)) return `append 目标${jsonPath ? `(${jsonPath})` : '(根)'}不是数组`
  if (Array.isArray(value)) arr.push(...value)
  else arr.push(value)
  return null
}

/** 就地把 patch 落到 live bind(改子属性,不替换 bind 根引用 → 兼容 reactive) */
export function applyPatchToLive(bind: any, op: EditOp, jsonPath: string, value: unknown): void {
  if (op === 'set') {
    setByPath(bind, jsonPath, value)
  } else if (op === 'remove') {
    deleteByPath(bind, jsonPath)
  } else if (op === 'merge') {
    const target = (jsonPath ? getByPath(bind, jsonPath) : bind) as Record<string, unknown>
    safeMerge(target as Record<string, any>, value)
  } else {
    const arr = (jsonPath ? getByPath(bind, jsonPath) : bind) as unknown[]
    if (Array.isArray(value)) arr.push(...value)
    else arr.push(value)
  }
}

/** 就地还原 bind 内容;保留 reactive 容器引用 */
export function restoreLive(bind: any, snapshotVal: unknown): void {
  if (bind !== null && typeof bind === 'object') {
    restoreInPlace(bind as Record<string, unknown> | unknown[], snapshotVal)
  }
}

export function restoreInPlace(live: Record<string, unknown> | unknown[], snapshotVal: unknown): void {
  if (Array.isArray(live)) {
    live.length = 0
    if (Array.isArray(snapshotVal)) live.push(...snapshotVal)
    return
  }
  const snap = snapshotVal && typeof snapshotVal === 'object' && !Array.isArray(snapshotVal)
    ? (snapshotVal as Record<string, unknown>)
    : {}
  for (const k of Object.keys(live)) if (!(k in snap)) delete live[k]
  for (const k of Object.keys(snap)) live[k] = snap[k]
}
