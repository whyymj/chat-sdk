import type { TestCtx } from './_ctx'
import { z } from 'zod'
import {
  getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema,
} from '../../tools/schemaUtils'
import { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from '../../sdk/promptBuilder'
import { systemPromptHelpers } from '../../presets'

/**
 * sec-31 —— schemaUtils 纯函数 + promptBuilder 白盒单测(refactor-module-extraction 从 dataOps/createChatSdk 抽离)。
 * schemaUtils:白名单投影护城河;promptBuilder:systemPrompt 统一入口(后续 fix-introspection 的 getEffectiveSystemPrompt 复用)。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-31] schemaUtils 纯函数 + promptBuilder 白盒单测')

  const schema = z.object({
    name: z.string(),
    age: z.number(),
    tags: z.array(z.string()),
  })

  // getSchemaTopKeys
  const keys = getSchemaTopKeys(schema)
  assert(keys !== null && keys!.sort().join(',') === 'age,name,tags', 'getSchemaTopKeys → 提取 ZodObject 顶层 key')
  assert(getSchemaTopKeys(z.union([z.string(), z.number()])) === null, 'getSchemaTopKeys → 非 ZodObject(联合)返 null(全开放)')

  // isPathAllowed
  assert(isPathAllowed('name', schema, keys) === true, 'isPathAllowed → 声明字段允许')
  assert(isPathAllowed('secret', schema, keys) === false, 'isPathAllowed → 未声明字段拒绝')
  assert(isPathAllowed('tags.0', schema, keys) === true, 'isPathAllowed → 数组索引逐级允许')
  assert(isPathAllowed('tags.0.name', schema, keys) === true, 'isPathAllowed → 嵌套数组元素字段逐级校验')
  assert(isPathAllowed('', schema, keys) === true, 'isPathAllowed → 空路径允许(整体由调用方处理)')
  assert(isPathAllowed('name', schema, null) === true, 'isPathAllowed → allowKeys null 全开放(向后兼容)')

  // getSchemaAtPath
  assert(getSchemaAtPath(schema, 'name') !== null, 'getSchemaAtPath → 字段子 schema 非 null')
  assert(getSchemaAtPath(schema, 'tags') !== null, 'getSchemaAtPath → 数组子 schema 非 null')
  assert(getSchemaAtPath(schema, 'secret') === null, 'getSchemaAtPath → 不存在路径返 null')

  // projectBySchemaDeep(按 schema 递归投影)
  const proj = projectBySchemaDeep({ name: 'x', age: 1, secret: 'hidden' }, schema) as any
  assert(proj.name === 'x' && proj.age === 1 && proj.secret === undefined, 'projectBySchemaDeep → 按 schema 投影隐藏未声明字段')
  const projArr = projectBySchemaDeep(
    [{ name: 'a', secret: 'x' }],
    z.array(z.object({ name: z.string() })),
  ) as any[]
  assert(projArr[0].name === 'a' && projArr[0].secret === undefined, 'projectBySchemaDeep → 数组元素递归投影')

  // projectBySchema(顶层 key 投影)
  const ps = projectBySchema({ name: 'x', age: 1, extra: 2 }, keys) as any
  assert(ps.name === 'x' && ps.age === 1 && ps.extra === undefined, 'projectBySchema → 顶层白名单投影隐藏额外字段')
  assert((projectBySchema({ a: 1 }, null) as any).a === 1, 'projectBySchema → allowKeys null 原样返回')

  // unwrapSchema
  const unwrapped = unwrapSchema(z.object({ a: z.string() }).optional())
  assert(unwrapped && unwrapped.shape && 'a' in unwrapped.shape, 'unwrapSchema → 解包 optional 到 ZodObject')

  // === promptBuilder ===
  assert(typeof DEFAULT_SYSTEM_PROMPT === 'string' && DEFAULT_SYSTEM_PROMPT.length > 0, 'DEFAULT_SYSTEM_PROMPT → 非空字符串')
  assert(DEFAULT_SYSTEM_PROMPT.includes('JSON 操作助手'), 'DEFAULT_SYSTEM_PROMPT → 含身份说明')
  assert(DEFAULT_SYSTEM_PROMPT.includes('---'), 'DEFAULT_SYSTEM_PROMPT → 含分隔线(区分身份段与规则段)')

  // buildSystemPrompt 三分支
  assert(buildSystemPrompt({}) === DEFAULT_SYSTEM_PROMPT, 'buildSystemPrompt → 不传 systemPrompt 用默认(已内置规则)')
  assert(
    buildSystemPrompt({ systemPrompt: 'X' }) === 'X\n\n---\n\n' + systemPromptHelpers.reliableWriteRules,
    'buildSystemPrompt → 自定义 systemPrompt 默认追加 reliableWriteRules(--- 分隔)',
  )
  assert(
    buildSystemPrompt({ systemPrompt: 'X', appendReliableWriteRules: false }) === 'X',
    'buildSystemPrompt → appendReliableWriteRules:false 不追加',
  )

  // buildDataPrompt
  assert(buildDataPrompt(undefined) === '', 'buildDataPrompt → 无 data 返空串')
  const dp = buildDataPrompt({
    schema: z.object({ name: z.string().describe('用户名') }),
    bind: {},
    description: '用户数据',
  })
  assert(dp.includes('可操作数据'), 'buildDataPrompt → 含段标题')
  assert(dp.includes('用户数据'), 'buildDataPrompt → 含 data.description')
  assert(dp.includes('用户名'), 'buildDataPrompt → 含 schema 字段 .describe() hint')
}
