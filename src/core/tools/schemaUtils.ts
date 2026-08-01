/**
 * Schema 白名单投影纯函数 —— 从 dataOps.ts 抽离(refactor-module-extraction)。
 * 依赖 zod 类型(纯类型依赖,无运行时依赖)。护城河核心:按 schema 声明字段投影,隐藏未声明字段。
 *
 * 后续新函数归宿:expose-schema-constraints 的 describeSchemaNode(zod 约束结构化提取)
 * 落入本文件,复用 unwrapSchema。
 */
import type { ZodType } from 'zod'

/**
 * 提取 schema 顶层声明的 key(作为可读写白名单)。
 * 仅 ZodObject(及其可选/默认值包装)可提取;非 ZodObject(联合/record/lazy)返回 null → 不启用白名单(全开放,向后兼容)。
 */
export function getSchemaTopKeys(schema: ZodType): string[] | null {
  let s: any = schema
  // 解包可选/默认值/捕获包装
  for (let i = 0; i < 5 && s && s._def; i++) {
    if (s._def.innerType) { s = s._def.innerType; continue }
    break
  }
  if (!s || !s.shape || typeof s.shape !== 'object') return null
  try {
    const shape = typeof s.shape === 'function' ? s.shape() : s.shape
    return Object.keys(shape)
  } catch {
    return null
  }
}

/** jsonPath 逐段是否都在 schema 声明字段内(白名单 null 表示全开放;支持嵌套对象/数组元素逐级校验,防子路径绕过顶层白名单) */
export function isPathAllowed(jsonPath: string, schema: ZodType | null, allowKeys: string[] | null): boolean {
  if (!allowKeys) return true  // 非 ZodObject schema,全开放(向后兼容)
  if (!jsonPath) return true   // 整体路径由调用方按 set-merge 语义处理
  let s: any = unwrapSchema(schema)
  for (const seg of jsonPath.split('.')) {
    if (!s) return false
    s = unwrapSchema(s)
    if (s && s.shape && typeof s.shape === 'object') {
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      if (!(seg in shape)) return false
      s = shape[seg]
    } else if (s && (s._def?.type === 'array' || s.constructor?.name === 'ZodArray')) {
      // ZodArray:严格判(_def.type === 'array' 字符串相等,防 discriminatedUnion 等被误判);seg 是索引跳过,取元素 schema
      s = s.element
    } else if (s && (s._def?.type === 'union' || s._def?.type === 'discriminatedUnion' || Array.isArray(s.options))) {
      // discriminatedUnion/ZodUnion:静态无 bind 不知具体 option,降级开放(后续段交 schema.safeParse 兜底校验)
      // 修复:旧 else if 用 `_def.type` 真值判断,但 _def.type 在所有 zod schema 都是字符串(如 'union'/'object'),
      // 导致 union 被误当 array,s 退化成字符串,后续深层路径(如 components.N.props.X)误返 PATH_DENIED
      return true
    } else {
      return false
    }
  }
  return true
}

/** 解包 zod 可选/默认值/捕获/懒加载包装,返回核心 schema */
export function unwrapSchema(schema: any): any {
  let s = schema
  for (let i = 0; i < 8 && s && s._def; i++) {
    if (s._def.innerType) { s = s._def.innerType; continue }
    if (s._def.schema) { s = s._def.schema; continue }      // ZodLazy(zod v4:_def.schema)
    if (s._def.getter) { s = s._def.getter(); continue }     // ZodLazy fallback:_def.getter()
    break
  }
  return s
}

/** 按 jsonPath 逐级定位子 schema(支持 ZodObject.shape / ZodArray.element;遇联合/record/lazy 返回 null) */
export function getSchemaAtPath(schema: ZodType, jsonPath: string): ZodType | null {
  if (!jsonPath) return schema
  let s: any = unwrapSchema(schema)
  const segs = jsonPath.split('.')
  for (const seg of segs) {
    if (!s) return null
    s = unwrapSchema(s)
    if (s && s.shape && typeof s.shape === 'object') {
      // ZodObject:取 shape[seg](seg 是字段名)
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      s = shape[seg]
    } else if (s && (s._def?.type === 'array' || s.constructor?.name === 'ZodArray')) {
      // ZodArray:严格判(_def.type === 'array' 字符串相等);seg 是索引,取元素 schema
      s = s.element
    } else if (s && (s._def?.type === 'union' || s._def?.type === 'discriminatedUnion' || Array.isArray(s.options))) {
      // discriminatedUnion/ZodUnion:静态不知具体 option,降级返 null(投影原样;
      // 深层约束用 schema_data(jsonPath 上层)得 anyOf;写入校验交 schema.safeParse 兜底)。修同 isPathAllowed 的 bug
      return null
    } else {
      return null
    }
  }
  return s ?? null
}

/** 按 schema 投影对象(只保留 schema 声明字段,递归处理嵌套对象/数组元素;非 ZodObject 原样返回) */
export function projectBySchemaDeep(obj: unknown, schema: ZodType | null): unknown {
  if (obj == null || typeof obj !== 'object' || !schema) return obj
  const s = unwrapSchema(schema)
  if (!s || !s.shape) {
    // 非 ZodObject(如数组/联合/record):若是数组,递归投影元素
    if (Array.isArray(obj) && (s?._def?.type || s?.element)) {
      const elemSchema = s.element ?? s._def?.type
      return obj.map((o) => projectBySchemaDeep(o, elemSchema))
    }
    return obj
  }
  const shape = typeof s.shape === 'function' ? s.shape() : s.shape
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (k in shape) {
      const childVal = (obj as Record<string, unknown>)[k]
      out[k] = projectBySchemaDeep(childVal, shape[k])
    }
  }
  return out
}

/** 按 schema 顶层 key 投影 bind(只保留白名单字段,其余隐藏) */
export function projectBySchema(obj: unknown, allowKeys: string[] | null): unknown {
  if (!allowKeys || obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const set = new Set(allowKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) if (set.has(k)) out[k] = (obj as Record<string, unknown>)[k]
  return out
}

/**
 * Schema 约束结构化提取(expose-schema-constraints)—— 从 zod 4 `_def` / `check._zod.def` 提取字段约束,
 * 供 systemPrompt「可操作数据」段 + schema_data 工具两处消费(让 LLM 写前即知字段规则,减少试错轮次)。
 *
 * ⚠️ zod 4 内部结构与 zod 3 差异大:check 的真值在 `check._zod.def`(非 `_def.checks[i].kind`);
 * number 经 ZodNumberFormat 暴露 `minValue/maxValue/isInt/format` 便利 getter。
 * 本实现是 **zod 4.4+ adapter**(集中在本文件 readCheckDefs / describeSchemaNode 的 switch):
 *  - 未来 zod 5 / 别的 schema 库:新增 adapter 分支于此,`SchemaNodeDesc` 接口 + 两处消费零改动;
 *  - 结构探测失败(schema 无 `_zod`/`_def`)→ 返 `{type}` 无约束(降级不崩);dev 模式 console.warn(去重)提醒版本不兼容;
 *  - 不透传内部 `_def` 全量(稳定 + 抗版本)。
 */

/** 单个 schema 节点的结构化约束描述 */
export interface SchemaNodeDesc {
  type: string
  constraints?: {
    minLength?: number
    maxLength?: number
    length?: number
    min?: number
    max?: number
    int?: boolean
    format?: string | string[]
    values?: readonly (string | number)[]
    value?: unknown
    item?: SchemaNodeDesc
    shape?: Record<string, SchemaNodeDesc>
    anyOf?: SchemaNodeDesc[]
    valueType?: SchemaNodeDesc
  }
  optional?: boolean
  nullable?: boolean
  default?: unknown
  description?: string
}

/** dev 模式 zod 版本兼容提醒(去重,只 warn 一次/进程);生产静默 */
let __zodCompatWarned = false
function warnZodCompatOnce(): void {
  if (__zodCompatWarned) return
  __zodCompatWarned = true
  try {
    const dev = (import.meta as any)?.env?.DEV
    if (dev && typeof console !== 'undefined') {
      console.warn('[page-agent-sdk] describeSchemaNode: schema 无 _zod/_def 结构,约束提取降级为 type-only(zod 版本可能不兼容,需 zod 4.4+;adapter 扩展见 schemaUtils.ts)')
    }
  } catch { /* ignore */ }
}

/** 读取 zod 4 check 数组的 `_zod.def`(约束真值所在;zod 3 风格的 `.kind`/`.value` 已废弃) */
function readCheckDefs(schema: any): any[] {
  const cs = schema?._def?.checks
  if (!Array.isArray(cs)) return []
  const out: any[] = []
  for (const c of cs) if (c?._zod?.def) out.push(c._zod.def)
  return out
}

/** 是否为 number 的"无下限"哨兵值(zod 4 safeint 默认 minValue = Number.MIN_SAFE_INTEGER) */
function isUnboundedMin(v: any): boolean {
  return v === Number.MIN_SAFE_INTEGER || v === -Infinity
}
/** 是否为 number 的"无上限"哨兵值 */
function isUnboundedMax(v: any): boolean {
  return v === Number.MAX_SAFE_INTEGER || v === Infinity
}

/**
 * 结构化提取单个 zod 节点的约束。先解包 optional/default/nullable/catch/readonly/prefault/lazy/pipe 收集标记,
 * 再按核心类型(string/number/boolean/enum/literal/array/object/union/record)提取关键约束。
 */
export function describeSchemaNode(schemaRaw: any): SchemaNodeDesc {
  let optional = false
  let nullable = false
  let hasDefault = false
  let defaultValue: unknown
  let s: any = schemaRaw
  for (let i = 0; i < 8 && s && s._def; i++) {
    const t = s._def.type
    if (t === 'optional' || t === 'default' || t === 'nullable' || t === 'catch' || t === 'readonly' || t === 'prefault') {
      if (t === 'optional') optional = true
      else if (t === 'nullable') nullable = true
      else if (t === 'default' || t === 'prefault') { hasDefault = true; defaultValue = s._def.defaultValue }
      s = s._def.innerType
      continue
    }
    if (t === 'lazy') { s = s._def.getter ? s._def.getter() : s._def.schema; continue }
    if (t === 'pipe') { s = s._def.in ?? s._def.innerType; continue }
    break
  }
  const type = s?._def?.type || 'unknown'
  if (!s?._def) warnZodCompatOnce()  // 非 zod schema(无 _def):dev 提醒版本不兼容,生产静默;返 type-only 兜底
  const d: SchemaNodeDesc = { type }
  if (optional) d.optional = true
  if (nullable) d.nullable = true
  if (hasDefault) d.default = defaultValue
  if (s?.description) d.description = s.description

  const c: NonNullable<SchemaNodeDesc['constraints']> = {}
  switch (type) {
    case 'string': {
      if (s.minLength != null) c.minLength = s.minLength
      if (s.maxLength != null) c.maxLength = s.maxLength
      const fmts = readCheckDefs(s).filter((x) => x.check === 'string_format').map((x) => x.format).filter(Boolean)
      if (fmts.length) c.format = fmts.length === 1 ? fmts[0] : fmts
      break
    }
    case 'number': {
      if (s.minValue != null && !isUnboundedMin(s.minValue)) c.min = s.minValue
      if (s.maxValue != null && !isUnboundedMax(s.maxValue)) c.max = s.maxValue
      if (s.isInt) c.int = true
      if (s.format && s.format !== 'number') c.format = s.format
      break
    }
    case 'enum':
      c.values = s.options
      break
    case 'literal': {
      const vals = s._def?.values ?? (s._def?.value !== undefined ? [s._def.value] : [])
      c.value = vals.length === 1 ? vals[0] : vals
      break
    }
    case 'array': {
      c.item = describeSchemaNode(s.element)
      for (const ck of readCheckDefs(s)) {
        if (ck.check === 'min_length') c.minLength = ck.minimum
        else if (ck.check === 'max_length') c.maxLength = ck.maximum
        else if (ck.check === 'length_equals') c.length = ck.length
      }
      break
    }
    case 'object': {
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      c.shape = Object.fromEntries(Object.entries(shape || {}).map(([k, v]) => [k, describeSchemaNode(v)]))
      break
    }
    case 'union': {
      const opts = (s._def?.options || []).map((o: any) => describeSchemaNode(o))
      if (opts.length) c.anyOf = opts
      break
    }
    case 'record':
      if (s._def?.valueType) c.valueType = describeSchemaNode(s._def.valueType)
      break
    default:
      break
  }
  if (Object.keys(c).length) d.constraints = c
  return d
}

/** 把标量约束格式化为括号内短串(shape/item/anyOf/valueType 不渲染,避免冗长;深入用 schema_data) */
export function formatConstraints(c: NonNullable<SchemaNodeDesc['constraints']>): string {
  const parts: string[] = []
  if (c.minLength !== undefined) parts.push(`minLen=${c.minLength}`)
  if (c.maxLength !== undefined) parts.push(`maxLen=${c.maxLength}`)
  if (c.length !== undefined) parts.push(`len=${c.length}`)
  if (c.min !== undefined) parts.push(`min=${c.min}`)
  if (c.max !== undefined) parts.push(`max=${c.max}`)
  if (c.int) parts.push('int')
  if (c.format) parts.push(`format=${Array.isArray(c.format) ? c.format.join('|') : c.format}`)
  if (c.values) parts.push(`enum=[${(c.values as readonly (string | number)[]).map((v) => String(v)).join('|')}]`)
  if (c.value !== undefined) parts.push(`=${JSON.stringify(c.value)}`)
  return parts.join(', ')
}

/** 渲染单行字段标注:`- key (Type?)[约束]: description`(供 read 概览 / systemPrompt) */
export function renderSchemaHint(key: string, desc: SchemaNodeDesc): string {
  const scalar = desc.constraints ? formatConstraints(desc.constraints) : ''
  const bracket = scalar ? `[${scalar}]` : ''
  const opt = desc.optional ? '?' : ''
  const tail = desc.description ? `: ${desc.description}` : ''
  return `- ${key} (${desc.type}${opt})${bracket}${tail}`
}

/** 渲染 schema 顶层字段约束总览(非 object / 空 shape fallback 到根节点描述);供 extractSchemaHint + read 概览复用 */
export function renderSchemaOverview(schemaRaw: any): string {
  if (!schemaRaw) return ''
  try {
    let s: any = schemaRaw
    for (let i = 0; i < 8 && s && s._def; i++) {
      if (s._def.innerType) { s = s._def.innerType; continue }
      if (s._def.getter) { s = s._def.getter(); continue }
      if (s._def.schema) { s = s._def.schema; continue }
      break
    }
    const shape = s?.shape ? (typeof s.shape === 'function' ? s.shape() : s.shape) : null
    if (shape && typeof shape === 'object' && Object.keys(shape).length) {
      return Object.entries(shape).map(([k, v]) => renderSchemaHint(k, describeSchemaNode(v))).join('\n')
    }
  } catch { /* ignore */ }
  try {
    return renderSchemaHint('(root)', describeSchemaNode(schemaRaw))
  } catch { /* ignore */ }
  return ''
}

/** 浅渲染单行:`- key (Type): description`(无约束,分层概览用;大 schema 不爆 token) */
function renderSchemaFieldShallow(key: string, schemaRaw: any): string {
  const desc = describeSchemaNode(schemaRaw)
  const tail = desc.description ? `: ${desc.description}` : ''
  return `- ${key} (${desc.type})${tail}`
}

/**
 * 渲染 schema 顶层字段浅概览(分层模式用):只 key + type + 一句描述,**不带**约束(min/max/enum)、**不递归** shape。
 * 供 extractSchemaHint 大 schema(>阈值)分层注入 systemPrompt,体积降一个数量级(深层约束交 schema_data 按需查)。
 */
export function renderSchemaShallow(schemaRaw: any): string {
  if (!schemaRaw) return ''
  try {
    let s: any = schemaRaw
    for (let i = 0; i < 8 && s && s._def; i++) {
      if (s._def.innerType) { s = s._def.innerType; continue }
      if (s._def.getter) { s = s._def.getter(); continue }
      if (s._def.schema) { s = s._def.schema; continue }
      break
    }
    const shape = s?.shape ? (typeof s.shape === 'function' ? s.shape() : s.shape) : null
    if (shape && typeof shape === 'object' && Object.keys(shape).length) {
      return Object.entries(shape).map(([k, v]) => renderSchemaFieldShallow(k, v)).join('\n')
    }
  } catch { /* ignore */ }
  return ''
}
