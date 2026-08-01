/**
 * sec-37:大 schema 分层披露(add-schema-tiered-disclosure)
 * - 小 schema(≤阈值)全量含约束;大 schema(>maxKeys / >maxChars)分层顶层概览(无约束)+ 尾部提示
 * - maxKeys/maxChars 可配(配大阈值退化为全量);renderSchemaShallow 浅渲染(key+type+desc 无约束)
 */
import { z } from 'zod'
import { extractSchemaHint } from '../../presets'
import { renderSchemaShallow } from '../../tools/schemaUtils'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // 小 schema(2 字段,≤阈值 maxKeys=15/maxChars=4000)→ 全量(带约束)
  const small = z.object({
    name: z.string().min(2).max(50).describe('姓名'),
    age: z.number().min(0).max(150).describe('年龄'),
  })
  const smallHint = extractSchemaHint(small)
  assert(smallHint.includes('姓名') && smallHint.includes('年龄'), '✓ 小 schema ≤阈值 → 全量(含字段描述)')
  assert(smallHint.includes('min='), '✓ 小 schema 全量含约束(min=)')
  assert(!smallHint.includes('顶层概览'), '✓ 小 schema 不触发分层(无「顶层概览」标记)')

  // 大 schema(20 字段,>maxKeys=15)→ 分层(顶层概览,不带约束 + 尾部提示)
  const bigShape: Record<string, any> = {}
  for (let i = 0; i < 20; i++) {
    bigShape[`field_${i}`] = z.string().min(1).max(100).describe(`字段${i}`)
  }
  const big = z.object(bigShape)
  const bigHint = extractSchemaHint(big)
  assert(bigHint.includes('顶层概览'), '✓ 大 schema >maxKeys → 分层(含「顶层概览」标记)')
  assert(!bigHint.includes('min='), '✓ 分层概览不含深层约束(min/max/enum)')
  assert(bigHint.includes('schema_data'), '✓ 分层含尾部提示(深层约束查 schema_data)')
  assert(bigHint.includes('field_0'), '✓ 分层概览含顶层 key(field_0)')

  // maxKeys/maxChars 可配:配大阈值 → 大 schema 退化为全量(不分层)
  const fullHint = extractSchemaHint(big, { maxKeys: 9999, maxChars: 999999 })
  assert(!fullHint.includes('顶层概览'), '✓ maxKeys=9999/maxChars=999999 → 大 schema 退化为全量(不分层)')
  assert(fullHint.includes('minLen='), '✓ 退化全量恢复含约束(string 的 minLen/maxLen)')

  // maxChars 触发:字段少但描述长(字符 >4000)→ 分层
  const longDesc = z.object({
    a: z.string().describe('x'.repeat(2000)),
    b: z.string().describe('y'.repeat(2000)),
    c: z.string().describe('z'.repeat(2000)),
  })
  const longHint = extractSchemaHint(longDesc)
  assert(longHint.includes('顶层概览'), '✓ 字符 >maxChars → 分层(即使 key 数 ≤ maxKeys)')

  // renderSchemaShallow 浅渲染:只 key + type + desc,不带约束
  const shallow = renderSchemaShallow(small)
  assert(shallow.includes('name (string)') && shallow.includes('age (number)'), '✓ renderSchemaShallow → key + type')
  assert(shallow.includes('姓名'), '✓ renderSchemaShallow 含描述')
  assert(!shallow.includes('min='), '✓ renderSchemaShallow 不含约束(浅渲染)')

  // extractSchemaHint(null/undefined) → 空串
  assert(extractSchemaHint(null) === '', '✓ extractSchemaHint(null) → 空串')
}
