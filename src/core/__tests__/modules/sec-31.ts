import type { TestCtx } from './_ctx'
import { z } from 'zod'
import {
  getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema,
  describeSchemaNode, renderSchemaHint, renderSchemaOverview,
} from '../../tools/schemaUtils'
import { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from '../../sdk/promptBuilder'
import { systemPromptHelpers, extractSchemaHint } from '../../presets'
import { createDataOps } from '../../tools/dataOps'

/**
 * sec-31 —— schemaUtils 纯函数 + promptBuilder 白盒单测(refactor-module-extraction 从 dataOps/createChatSdk 抽离)。
 * schemaUtils:白名单投影护城河;promptBuilder:systemPrompt 统一入口(后续 fix-introspection 的 getEffectiveSystemPrompt 复用)。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, byName, invoke } = ctx
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
  assert(isPathAllowed('tags.0.name', schema, keys) === false, 'isPathAllowed → string 元素无 name 子字段(修后严格:旧 bug 把 string 误当 array 放行)')

  // discriminatedUnion 深层路径(修 isPathAllowed 把 union 误当 array 的 pre-existing bug;complex-demo 真测发现)
  const unionSchema = z.object({
    components: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('card'), props: z.object({ title: z.string() }) }),
      z.object({ type: z.literal('image'), props: z.object({ src: z.string() }) }),
    ])),
  })
  const uKeys = getSchemaTopKeys(unionSchema)
  assert(uKeys !== null && uKeys[0] === 'components', 'getSchemaTopKeys → union 数组顶层 key')
  assert(isPathAllowed('components', unionSchema, uKeys) === true, 'isPathAllowed → components 顶层')
  assert(isPathAllowed('components.0', unionSchema, uKeys) === true, 'isPathAllowed → 数组元素(索引)')
  assert(isPathAllowed('components.0.type', unionSchema, uKeys) === true, 'isPathAllowed → union discriminator 降级放行')
  assert(isPathAllowed('components.0.props.title', unionSchema, uKeys) === true, 'isPathAllowed → union 深层 props 放行(修 bug:旧逻辑误 PATH_DENIED)')
  assert(isPathAllowed('components.0.props.unknown', unionSchema, uKeys) === true, 'isPathAllowed → union 降级后深层不再静态校验(交 safeParse 兜底)')
  // getSchemaAtPath 对 union 降级返 null(投影原样);components.0 返 union 自身(查约束)
  assert(getSchemaAtPath(unionSchema, 'components.0.props.title') === null, 'getSchemaAtPath → union 深层返 null(降级)')
  assert(getSchemaAtPath(unionSchema, 'components.0') !== null, 'getSchemaAtPath → 数组元素(union)非 null(schema_data 查 anyOf)')
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

  // === expose-schema-constraints:describeSchemaNode 结构化约束提取(zod 4 _def/_zod.def) ===
  const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  assert(describeSchemaNode(z.string().min(1).max(100)).constraints?.minLength === 1, 'describeSchemaNode → string minLength')
  assert(describeSchemaNode(z.string().min(1).max(100)).constraints?.maxLength === 100, 'describeSchemaNode → string maxLength')
  assert(describeSchemaNode(z.string().email()).constraints?.format === 'email', 'describeSchemaNode → string email format')
  assert(deepEq(describeSchemaNode(z.enum(['a', 'b'])).constraints?.values, ['a', 'b']), 'describeSchemaNode → enum values')
  assert(describeSchemaNode(z.literal('x')).constraints?.value === 'x', 'describeSchemaNode → literal value')
  assert(describeSchemaNode(z.array(z.string()).min(1).max(5)).type === 'array', 'describeSchemaNode → array type')
  assert(describeSchemaNode(z.array(z.string()).min(1)).constraints?.minLength === 1, 'describeSchemaNode → array minLength')
  assert(describeSchemaNode(z.number().min(0).max(100)).constraints?.min === 0, 'describeSchemaNode → number min')
  assert(describeSchemaNode(z.number().min(0).max(100)).constraints?.max === 100, 'describeSchemaNode → number max')
  assert(describeSchemaNode(z.number().int()).constraints?.int === true, 'describeSchemaNode → number int')
  assert(describeSchemaNode(z.boolean()).type === 'boolean' && !describeSchemaNode(z.boolean()).constraints, 'describeSchemaNode → boolean 无约束')
  assert(describeSchemaNode(z.string().optional()).optional === true, 'describeSchemaNode → optional 标记')
  assert(describeSchemaNode(z.string().default('x')).default === 'x', 'describeSchemaNode → default 值')
  assert(describeSchemaNode(z.string().nullable()).nullable === true, 'describeSchemaNode → nullable 标记')
  const objDesc = describeSchemaNode(z.object({ a: z.string() }))
  assert(objDesc.type === 'object' && objDesc.constraints?.shape?.a?.type === 'string', 'describeSchemaNode → object shape 递归')
  assert(describeSchemaNode(z.union([z.string(), z.number()])).constraints?.anyOf?.length === 2, 'describeSchemaNode → union anyOf')
  assert(describeSchemaNode({ a: 1 } as any).type === 'unknown', 'describeSchemaNode → 非 zod 对象(无 _def)返 type-only 兜底(dev warn 去重)')

  // renderSchemaHint / renderSchemaOverview
  assert(renderSchemaHint('name', describeSchemaNode(z.string().min(1).describe('用户名'))) === '- name (string)[minLen=1]: 用户名', 'renderSchemaHint → key (Type)[约束]: desc')
  assert(renderSchemaHint('alias', describeSchemaNode(z.string().optional())) === '- alias (string?)', 'renderSchemaHint → optional 带 ?')
  const overview = renderSchemaOverview(z.object({ name: z.string().min(1).describe('用户名'), age: z.number().min(0) }))
  assert(overview.includes('(string)[minLen=1]') && overview.includes('(number)[min=0]'), 'renderSchemaOverview → 顶层字段带类型+约束')
  assert(renderSchemaOverview(z.string().min(1)).includes('(root)'), 'renderSchemaOverview → 非 object fallback 根节点')

  // extractSchemaHint 升级(经 renderSchemaOverview,带类型+约束)
  const hintObj = extractSchemaHint(z.object({ name: z.string().min(1).describe('用户名') }))
  assert(hintObj.includes('(string)') && hintObj.includes('minLen'), 'extractSchemaHint → object 带类型 + 约束')
  assert(extractSchemaHint(z.string().min(1)).includes('(root)'), 'extractSchemaHint → 非 object fallback 根节点')
  assert(extractSchemaHint(null) === '' && extractSchemaHint(undefined) === '', 'extractSchemaHint → null/undefined 返空串(!schema 兜底)')

  // === schema_data 工具(advanced;查任意路径完整约束) ===
  const dataOps = createDataOps({
    schema: z.object({
      name: z.string().min(1).max(100).describe('用户名'),
      role: z.enum(['admin', 'user']),
      tags: z.array(z.string()).min(1),
    }),
    bind: { name: 'x', role: 'admin', tags: ['a'] },
    description: '测试数据',
  })
  const dt = byName(dataOps)
  const sdRoot = await invoke(dt.schema_data, {})
  assert(sdRoot.includes('"type":"object"') && sdRoot.includes('"minLength":1'), 'schema_data 根 → 含 object type + 字段约束(嵌套 shape)')
  const sdSub = await invoke(dt.schema_data, { jsonPath: 'name' })
  assert(sdSub.includes('"type":"string"') && sdSub.includes('"minLength":1'), 'schema_data 子路径 → 含 string + minLength')
  assert(sdSub.includes('用户名'), 'schema_data 子路径 → 含字段 description')
  const sdMiss = await invoke(dt.schema_data, { jsonPath: 'nope' })
  assert(sdMiss.includes('PATH_DENIED'), 'schema_data 不存在路径 → PATH_DENIED')

  // read 概览段(不传 jsonPath)不带约束(refine-dataops:去重复,约束靠 systemPrompt + schema_data);含说明 + 引导
  const readOverview = await invoke(dt.read, {})
  assert(readOverview.includes('主数据说明') && readOverview.includes('schema_data') && !readOverview.includes('可操作字段'), 'read 概览段 → 不带约束(去重复),含说明 + schema_data 引导')
  assert(!readOverview.includes('(string)['), 'read 概览 → 不含约束标注(约束在 systemPrompt/schema_data)')
  const readSub = await invoke(dt.read, { jsonPath: 'name' })
  assert(!readSub.includes('主数据说明'), 'read 子路径读 → 不带概览段(保值返回干净)')
}
