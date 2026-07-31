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
    } else if (s && (s._def?.type || s.element)) {
      // ZodArray:seg 是索引,跳过;取元素 schema 继续逐级
      s = s.element ?? s._def?.type
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
    } else if (s && (s._def?.type || s.element)) {
      // ZodArray:seg 应是索引,跳过;取元素 schema
      s = s.element ?? s._def?.type
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
