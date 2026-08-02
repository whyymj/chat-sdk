/**
 * 数据操作工具 —— 单主对象 + schema 校验 + 增量编辑 + 快照回退(无人工审批)
 *
 * 设计:低代码页面通常只有一个主 JSON(如 page),本工具集围绕「唯一主对象」操作:
 *  - 集成方声明 { schema, bind, description? };bind 为 reactive/普通对象,工具直接读写 bind(不挂 window)
 *  - 工具无 path/name 参数:Agent 直接操作唯一主对象,降低认知负担
 *  - 增量编辑 edit_data:按 op(set/remove/merge/append)+ jsonPath 改局部,避免 LLM 重传整个大 JSON
 *  - 快照回退:set/edit/delete 前自动存快照;snapshot/list/restore_data 支持手动检查点与快速回退
 *  - 就地写回:edit/restore 改子属性,绝不替换 bind 根引用 → 兼容 Vue reactive
 *  - 审计:每次 set/edit/delete/restore 记日志(可选 onAudit 回调)
 *
 * 注:大结果的外存/截断由 createAgent 的 coreExecTool 经 offloadLargeResult 处理;
 *     get_data 返回完整安全序列化(不截断),交由 offload 决定外存 vfs 或截断。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { jpEval, searchJson, runSandboxedScript, type SearchMode } from './dataSlotQuery'
import { toolError, zodError, jsonParseError, formatZodIssues } from './toolError'
import {
  isUnsafePath, safeMerge, getByPath, deleteByPath, deepClone, maybeParseValue,
  projectFields, limitDepth, safeStringify, hashValue,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace, diffObjects,
  type EditOp,
} from './jsonUtils'
import { getSchemaTopKeys, isPathAllowed, getSchemaAtPath, projectBySchemaDeep, projectBySchema, describeSchemaNode } from './schemaUtils'

/** 单主对象配置 */
export interface DataConfig {
  /** 值的 zod schema(写入时校验);字段的 .describe() 自动提取注入 systemPrompt「可操作数据」段 */
  schema: ZodType
  /** 数据源:reactive/普通对象,工具直接读写 bind(reactive 写后响应式刷新;不挂 window) */
  bind: any
  /** 数据说明,供 Agent 理解用途与格式;不传则自动生成 */
  description?: string
}

export interface DataAuditEntry {
  op: 'set' | 'edit' | 'delete' | 'restore' | 'snapshot'
  value?: unknown
  detail?: string
  timestamp: number
}

export interface ConflictInfo {
  op: 'set' | 'edit' | 'delete'
  agentValue?: unknown
  currentValue: unknown
  currentHash: string
  expectedHash: string
  snapshotId: number
}

export type ConflictResolution =
  | { action: 'keep_external' }
  | { action: 'overwrite' }
  | { action: 'restore' }

/** 读写拦截器(集成方可脱敏/转换/审计/拒绝 LLM 的读写) */
export interface DataInterceptors {
  read?: (value: unknown) => unknown
  write?: (payload: unknown, current: unknown) => unknown | { error: string }
}

export interface DataOpsOptions {
  onAudit?: (entry: DataAuditEntry) => void
  maxSnapshots?: number
  onConflict?: (conflict: ConflictInfo) => Promise<ConflictResolution>
  autoLock?: boolean
  interceptors?: DataInterceptors
}

export interface DataSnapshotEntry {
  id: number
  ts: number
  op: 'set' | 'edit' | 'delete' | 'manual' | 'restore'
  label?: string
  value: unknown
}

/** 数据操作控制器(运行时替换配置,供 createChatSdk 暴露 sdk.setData 等) */
export interface DataOpsController {
  get(): DataConfig
  set(config: DataConfig): void
  update(bind: any): void
}

export type ToolMode = 'simple' | 'advanced' | 'minimal'

const SIMPLE_HIDDEN = new Set(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'schema_data', 'snapshot_data', 'list_data_snapshots', 'diff_data'])
const MINIMAL_ALLOWED = new Set(['read', 'write'])

export function filterByToolMode(tools: StructuredToolInterface[], mode: ToolMode = 'simple'): StructuredToolInterface[] {
  if (mode === 'advanced') return tools
  if (mode === 'minimal') return tools.filter((t) => MINIMAL_ALLOWED.has(t.name))
  return tools.filter((t) => !SIMPLE_HIDDEN.has(t.name))
}

/** 基于单主对象配置构建数据操作工具集 */
export function createDataOps(config: DataConfig, opts: DataOpsOptions = {}): StructuredToolInterface[] {
  let schema: ZodType = config.schema
  let bindRef: any = config.bind
  let description: string = config.description ?? '主数据对象'
  let allowKeys: string[] | null = getSchemaTopKeys(schema)

  const snapshots: DataSnapshotEntry[] = []
  const maxSnapshots = opts.maxSnapshots ?? 20
  // 并发工具(maxParallelTools>1)下 autoLock 退化为"整体快照语义":多个 read 并发写本变量(完成顺序不定),
  // 后续 write 比对"最后完成的 read 的整体 bind hash";单线程下单工具原子,但跨工具的"哪个 read 的 hash 被 autoLock 用"不可重现。
  // 并发场景下若需精确乐观锁,LLM 应显式传 expectedHash(取自它自己那次 read 的返回值)。harden-optimistic-lock
  let lastReadHash: string | undefined
  const autoLock = opts.autoLock !== false

  const controller: DataOpsController = {
    get: () => ({ schema, bind: bindRef, description }),
    set: (c) => { schema = c.schema; bindRef = c.bind; description = c.description ?? '主数据对象'; allowKeys = getSchemaTopKeys(schema); snapshots.length = 0; lastReadHash = undefined },
    update: (b) => { bindRef = b; snapshots.length = 0; lastReadHash = undefined },
  }

  const audit = (entry: DataAuditEntry) => { opts.onAudit?.(entry) }

  function pushSnapshot(op: DataSnapshotEntry['op'], label?: string): number {
    const before = deepClone(bindRef)
    const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
    snapshots.push({ id, ts: Date.now(), op, label, value: before })
    while (snapshots.length > maxSnapshots) snapshots.shift()
    return id
  }

  async function handleConflict(
    op: 'set' | 'edit' | 'delete',
    expectedHash: string | undefined,
    agentValue?: unknown,
  ): Promise<string | null> {
    if (!expectedHash || expectedHash === '') return null
    const curHash = hashValue(bindRef)
    if (curHash === expectedHash) return null
    if (!opts.onConflict) {
      return toolError({
        code: 'VERSION_CONFLICT',
        message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash}。主数据在你 read 之后已被修改(外部代码/其他 agent/用户手动改)。`,
        hint: `重新 read 拿最新值与 hash,基于最新值修改后再写入(传新的 expectedHash)。当前值:${safeStringify(bindRef, 400)}`,
      })
    }
    const resolution = await opts.onConflict({
      op, agentValue, currentValue: bindRef, currentHash: curHash, expectedHash, snapshotId: 0,
    })
    if (resolution.action === 'keep_external') {
      return `已保留外部修改(未写入)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 拿最新值与 hash 再改。`
    }
    if (resolution.action === 'restore') {
      if (!snapshots.length) return `无历史快照可回退(本次为首次操作)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 再改或选「强制覆盖」。`
      const entry = snapshots[snapshots.length - 1]
      restoreLive(bindRef, deepClone(entry.value))
      return `已回退主数据到历史快照 #${entry.id}[${entry.op}]。当前值:${safeStringify(bindRef, 400)} (hash=${hashValue(bindRef)})。请基于回退后的值重写或停止。`
    }
    return null
  }

  const describeData = tool(
    async () => [
      `说明: ${description}`,
      `格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 set_data/edit_data 会返回结构化错误,含具体字段与期望类型)。`,
    ].join('\n'),
    { name: 'describe_data', description: '获取主数据的说明与格式要求。', schema: z.object({}) },
  )

  const getData = tool(
    async ({ jsonPath }) => {
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常属性路径,如 components.0.text(数组索引用数字)' })
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `get_data @ "${jp}" 不在 schema 声明字段内(仅 schema 声明的 key 可读)`, hint: '主数据仅暴露 schema 声明的字段;若需操作该字段,集成方需在 schema 中声明它' })
      }
      let val = jp ? getByPath(bindRef, jp) : bindRef
      // 整体读时按 schema 顶层 key 投影(隐藏未声明字段)
      if (!jp) val = projectBySchema(val, allowKeys)
      const h = hashValue(bindRef)
      lastReadHash = h
      if (val === undefined) return `主数据${jp ? ` @ ${jp}` : ''} = (undefined) (hash=${h})`
      return `主数据${jp ? ` @ ${jp}` : ''} = ${safeStringify(val)} (hash=${h})`
    },
    {
      name: 'get_data',
      description:
        '读取主数据的当前值(安全序列化:函数/DOM/循环引用做摘要;大结果由系统自动外存,提示用 vfs_read 回读)。返回含 hash(乐观锁):改前先 read/get 拿 hash,写入时传 expectedHash 回传,系统对比当前 hash 防"基于过期值覆盖"。jsonPath 可选:读整个主数据不传,读子路径传(如 components.0.text)。',
      schema: z.object({ jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);不传则读整个主数据') }),
    },
  )

  const setData = tool(
    async ({ value, expectedHash }) => {
      const effHash = expectedHash || (autoLock ? lastReadHash : undefined)
      const conflict = await handleConflict('set', effHash)
      if (conflict !== null) return conflict
      let parsed: unknown
      const pr = maybeParseValue(value)
      if (pr.parseError) return jsonParseError('', value, pr.parseError)
      parsed = pr.parsed
      const res = schema.safeParse(parsed)
      if (!res.success) return zodError('', res.error.issues)
      if (bindRef === null || typeof bindRef !== 'object') {
        return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),set_data 无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组(低代码主 JSON 本就是);叶子值请用对象包裹(如 {value:"x"})或集成方通过 sdk.setData 替换 bind' })
      }
      pushSnapshot('set')
      if (res.data !== null && typeof res.data === 'object') {
        if (allowKeys) {
          // 白名单模式(schema 是 ZodObject 子集):merge 语义,只更新 schema 声明字段,隐藏字段保留不动(防误删)
          safeMerge(bindRef as Record<string, any>, res.data)
        } else {
          restoreInPlace(bindRef as Record<string, unknown> | unknown[], res.data)
        }
      }
      audit({ op: 'set', value: res.data, timestamp: Date.now() })
      lastReadHash = hashValue(bindRef)
      return `已设置主数据 = ${safeStringify(res.data, 600)} (新 hash=${hashValue(bindRef)})${allowKeys ? '(白名单模式:仅更新 schema 声明字段,未声明字段保留)' : ''}`
    },
    {
      name: 'set_data',
      description:
        '设置主数据的值(整体替换)。value 为 JSON 对象(或 JSON 字符串),需通过 schema 校验。校验失败会返回错误而非写入。expectedHash(可选):改前 read/get 返回的 hash,传入则启用乐观锁;不传时系统自动用你最后一次读到的 hash 比对(autoLock,默认开)。大对象/数组强烈建议改用 edit_data 增量 patch。',
      schema: z.object({
        value: z.unknown().describe('JSON 对象(推荐直传,如 {title:"x"}),或 JSON 字符串;需符合 schema'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝写入防覆盖。不传则自动用你最后读到的 hash(autoLock)'),
      }),
    },
  )

  const editData = tool(
    async ({ op, jsonPath, value, expectedHash }) => {
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) {
        return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常的属性路径,如 components.0.text(数组索引用数字)' })
      }
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `edit_data @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可写;若需操作该字段,集成方需在 schema 中声明它' })
      }
      const effHash = expectedHash || (autoLock ? lastReadHash : undefined)
      const conflict = await handleConflict('edit', effHash)
      if (conflict !== null) return conflict
      if (bindRef == null || typeof bindRef !== 'object') {
        return toolError({ code: 'NOT_OBJECT', message: `edit 仅适用于对象/数组主数据,当前是 ${bindRef === undefined ? 'undefined' : typeof bindRef}`, hint: '叶子(原始类型)请用 set_data 整体设置' })
      }
      let parsed: unknown
      if (op !== 'remove') {
        if (value === undefined || value === '') {
          return toolError({ code: 'MISSING_VALUE', message: `${op} 操作需要 value`, hint: `op 为 ${op} 时 value 必填;删除请用 op:'remove'` })
        }
        const pr = maybeParseValue(value)
        if (pr.parseError) return jsonParseError('', value, pr.parseError)
        parsed = pr.parsed
      }
      const clone = deepClone(bindRef)
      const patchErr = applyPatchToClone(clone, op, jp, parsed)
      if (patchErr) return toolError({ code: 'PATCH_FAILED', message: patchErr, hint: '检查 op 与目标类型:merge 需对象,append 需数组;jsonPath 指向需存在' })
      const res = schema.safeParse(clone)
      if (!res.success) return zodError('', res.error.issues)
      pushSnapshot('edit')
      applyPatchToLive(bindRef, op, jp, parsed)
      audit({ op: 'edit', detail: `${op}${jp ? '@' + jp : ''}`, value: parsed, timestamp: Date.now() })
      lastReadHash = hashValue(bindRef)
      return `已 edit 主数据(${op}${jp ? ' @ ' + jp : ''})。当前值:${safeStringify(bindRef, 600)} (新 hash=${hashValue(bindRef)})`
    },
    {
      name: 'edit_data',
      description:
        '增量编辑主数据(对象/数组),只发改动的 patch,无需重传整个大对象。op:set(在 jsonPath 设值)、remove(删 jsonPath)、merge(把 value 合并到 jsonPath 指向的对象,默认根)、append(把 value 追加到 jsonPath 指向的数组,默认根)。jsonPath 为相对主数据根的点号路径(数组索引用数字,如 components.0.text);value 为 JSON 对象(推荐直传)或 JSON 字符串。整体仍经 schema 校验,失败不写入。expectedHash(可选):改前 read/get 返回的 hash;不传时自动用你最后读到的 hash(autoLock,默认开)防"基于过期值覆盖"。',
      schema: z.object({
        op: z.enum(['set', 'remove', 'merge', 'append']),
        jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text)。set/remove 必填;merge/append 不填则作用于根'),
        value: z.unknown().optional().describe('JSON 对象(推荐直传,如 {text:"x"})或 JSON 字符串(set/merge/append 必填)'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝写入防覆盖。不传则自动用你最后读到的 hash(autoLock)'),
      }),
    },
  )

  const deleteData = tool(
    async ({ jsonPath, expectedHash }) => {
      if (!jsonPath) return toolError({ code: 'MISSING_VALUE', message: 'delete_data 需要 jsonPath 指定要删的子路径(主数据整体不可删,用 set_data 整体替换)', hint: '如 jsonPath:"components.0" 删数组首项' })
      if (isUnsafePath(jsonPath)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jsonPath}" 含非法段`, hint: '使用正常属性路径' })
      if (!isPathAllowed(jsonPath, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `delete_data @ "${jsonPath}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可删' })
      }
      const effHash = expectedHash || (autoLock ? lastReadHash : undefined)
      const conflict = await handleConflict('delete', effHash)
      if (conflict !== null) return conflict
      pushSnapshot('delete')
      const ok = deleteByPath(bindRef, jsonPath)
      audit({ op: 'delete', detail: jsonPath, timestamp: Date.now() })
      lastReadHash = hashValue(bindRef)
      return ok ? `已删除主数据 @ ${jsonPath}` : `主数据 @ ${jsonPath} 不存在(无需删除)`
    },
    {
      name: 'delete_data',
      description: '删除主数据的某个子路径(jsonPath)。主数据整体不可删(用 set_data 整体替换)。expectedHash(可选):改前 read/get 返回的 hash;不传时自动用你最后读到的 hash(autoLock,默认开)防"基于过期值删除"。',
      schema: z.object({
        jsonPath: z.string().describe('要删除的子路径(相对主数据根,如 components.0)'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝删除防覆盖'),
      }),
    },
  )

  const snapshotData = tool(
    async ({ label }) => {
      const id = pushSnapshot('manual', label)
      return `已为主数据创建快照 #${id}${label ? `(${label})` : ''}。可用 list_data_snapshots 查看、restore_data 回退。`
    },
    {
      name: 'snapshot_data',
      description: '为主数据手动创建一个命名快照(检查点)。set/edit/delete 也会自动存快照。',
      schema: z.object({ label: z.string().optional().describe('可选的快照标签,便于识别') }),
    },
  )

  const listDataSnapshots = tool(
    async () => {
      if (!snapshots.length) return '无快照。set/edit/delete 会自动存快照,也可用 snapshot_data 手动创建检查点。'
      const lines = snapshots.map((s) => {
        const size = JSON.stringify(s.value ?? '').length
        const time = new Date(s.ts).toLocaleTimeString('zh-CN', { hour12: false })
        return `  #${s.id} [${s.op}]${s.label ? ` "${s.label}"` : ''} ${time} 修改前≈${size}字符`
      })
      return `主数据快照(共 ${snapshots.length} 条):\n${lines.join('\n')}`
    },
    { name: 'list_data_snapshots', description: '列出主数据的快照时间线(序号、操作类型、标签、大小)。', schema: z.object({}) },
  )

  const restoreData = tool(
    async ({ id }) => {
      if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可回退', hint: 'set/edit/delete 会自动存快照;也可先 snapshot_data 手动创建检查点' })
      const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
      if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '用 list_data_snapshots 查看可用快照序号' })
      const chk = schema.safeParse(entry.value)
      if (!chk.success) return toolError({ code: 'SNAPSHOT_SCHEMA_INVALID', message: `快照 #${entry.id} 的值不符合当前 schema,无法回退`, hint: 'schema 可能已变更;该快照已过期,选其他快照或重新设置', details: formatZodIssues(chk.error.issues) })
      restoreLive(bindRef, deepClone(entry.value))
      audit({ op: 'restore', detail: `#${entry.id}`, timestamp: Date.now() })
      lastReadHash = hashValue(bindRef)
      return `已回退主数据到快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}。`
    },
    {
      name: 'restore_data',
      description: '把主数据回退到某个快照(就地还原,保留响应式)。不传 id 则回退最近一次(快速回退)。可用 list_data_snapshots 查看快照列表。',
      schema: z.object({ id: z.number().int().optional().describe('指定快照序号;不传则回退最近一次') }),
    },
  )

  const historyData = tool(
    async ({ id, jsonPath }) => {
      // 只读查看快照(填 list_data_snapshots 元信息与 restore_data 破坏性回退之间的空档),不回退当前 bind
      if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无历史快照可查看', hint: 'set/edit/delete 会自动存快照;也可先 snapshot_data 手动创建检查点' })
      const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
      if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '不传 id 查看最近一次;或用 list_data_snapshots(advanced) 查看可用序号' })
      let val: unknown = deepClone(entry.value)
      const jp = jsonPath || ''
      if (jp) {
        if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径' })
        if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `history_data @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可读' })
        val = getByPath(val, jp)
        const subSchema = getSchemaAtPath(schema, jp)
        if (subSchema) val = projectBySchemaDeep(val, subSchema)
      } else if (allowKeys) {
        val = projectBySchemaDeep(val, schema)
      }
      return `快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}${jp ? ` @ ${jp}` : ''} = ${safeStringify(val)}`
    },
    {
      name: 'history_data',
      description: '只读查看某次快照(默认最近一次)的内容,不回退当前主数据。看上一版长啥样而不影响当前(冲突诊断/verify 自纠/用户问"刚才改了啥")。可选 id 指定快照序号、jsonPath 只看子路径(按 schema 投影)。',
      schema: z.object({
        id: z.number().int().optional().describe('快照序号;不传则最近一次'),
        jsonPath: z.string().optional().describe('只看快照的某子路径(相对主数据根);不传则整个快照'),
      }),
    },
  )

  const queryData = tool(
    async ({ expr, limit }) => {
      if (bindRef == null || typeof bindRef !== 'object') {
        return toolError({ code: 'NOT_OBJECT', message: `主数据不是对象/数组,无法查询(当前为 ${bindRef === undefined ? 'undefined' : typeof bindRef})`, hint: 'query 仅适用于对象/数组;叶子用 get_data 读' })
      }
      const queryTarget = allowKeys ? projectBySchema(bindRef, allowKeys) : bindRef
      let nodes
      try { nodes = jpEval(queryTarget, expr) } catch (e) {
        return toolError({ code: 'JSONPATH_SYNTAX', message: `JSONPath 解析错误: ${(e as Error).message}`, hint: '语法子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..*;filter:@.field op literal,&&/||/();对象根需先点出数组字段再过滤,如 $.components[?(@.x>1)]', details: { expr } })
      }
      const cap = limit ?? 50
      const sliced = nodes.slice(0, cap)
      const parts = sliced.map((n) => `{"path":${JSON.stringify(n.path)},"index":${n.index === undefined ? 'null' : n.index},"value":${safeStringify(n.value)}}`)
      return `{"matched":${nodes.length},"returned":${sliced.length},"truncated":${nodes.length > cap},"results":[${parts.join(',')}]}`
    },
    {
      name: 'query_data',
      description:
        '用 JSONPath 表达式对主数据做结构化查询(只读,无副作用)。语法子集:$ 根、.key、[n]、["key"]、[*] 通配、[?(filter)] 过滤、..key 递归找后代、..* 全后代。过滤表达式:@.field op literal(op:==/!=/</<=/>/>=),&&/||/() 连接;@ 指当前元素。注意过滤作用于"当前节点的子元素数组",若主数据是对象需先点出数组字段再过滤,如 $.components[?(@.type=="card" && @.price<100)]。返回匹配元素的 path(相对主数据根,数组索引可作后续 edit_data 的 jsonPath)+ index(若父为数组)+ value。适合在大数组里按条件筛选元素,定位后再用 edit_data 增量改。',
      schema: z.object({
        expr: z.string().describe('JSONPath 表达式,如 $.components[?(@.type=="card" && @.price<100)] 或 $..title(递归找所有 title)'),
        limit: z.number().int().min(1).max(200).optional().describe('返回结果上限,默认 50'),
      }),
    },
  )

  const searchData = tool(
    async ({ query, mode, fuzzyThreshold, matchKey, limit }) => {
      if (bindRef == null) return toolError({ code: 'EMPTY', message: '主数据为空,无可搜索内容' })
      try {
        const searchTarget = allowKeys ? projectBySchema(bindRef, allowKeys) : bindRef
        const hits = searchJson(searchTarget, query, { mode: mode as SearchMode, fuzzyThreshold, matchKey, limit: limit ?? 50 })
        return safeStringify({ matched: hits.length, results: hits })
      } catch (e) {
        return toolError({ code: 'REGEX_INVALID', message: `搜索错误: ${(e as Error).message}`, hint: 'regex 模式下 query 须为合法正则;改 mode 为 substring/fuzzy 可避免正则语法问题', details: { query } })
      }
    },
    {
      name: 'search_data',
      description:
        '在主数据内做文本搜索(只读,无副作用)。mode:substring(子串,默认,大小写不敏感)、regex(正则,i 标志)、fuzzy(模糊:子串命中或 Levenshtein 距离 ≤ fuzzyThreshold)。递归遍历所有叶子值(及可选 key),返回命中元素的 path + value(超 200 字符截断)。适合在大 JSON 里找名字近似、记不清的元素,定位 path 后用 edit_data 改。',
      schema: z.object({
        query: z.string().describe('搜索词(substring/regex/fuzzy 共用)'),
        mode: z.enum(['substring', 'regex', 'fuzzy']).optional().describe('匹配模式,默认 substring'),
        fuzzyThreshold: z.number().int().min(0).max(5).optional().describe('fuzzy 模式最大编辑距离,默认 2'),
        matchKey: z.boolean().optional().describe('是否同时匹配 key 名,默认 true'),
        limit: z.number().int().min(1).max(200).optional().describe('返回上限,默认 50'),
      }),
    },
  )

  const evalScript = tool(
    async ({ script, mode, jsonPath }) => {
      if (script.length > 8000) return toolError({ code: 'SCRIPT_TOO_LARGE', message: `脚本过长(${script.length} 字符,上限 8000)`, hint: '精简脚本;复杂逻辑可分步(先 query 探查再 transform 改),或拆成多次 eval' })
      // 子树模式(paging 拆分):仅 clone/执行 jsonPath 指向的子树,降低大 JSON 的深拷贝/执行成本
      const jp = jsonPath || ''
      let source: unknown
      if (jp) {
        if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `eval_script @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可作为子树' })
        source = getByPath(bindRef, jp)
        if (allowKeys) { const ss = getSchemaAtPath(schema, jp); if (ss) source = projectBySchemaDeep(source, ss) }
      } else {
        source = allowKeys ? projectBySchema(bindRef, allowKeys) : bindRef
      }
      const data = deepClone(source)
      const timeout = jp && JSON.stringify(data).length > 100000 ? 8000 : 3000  // 子树较大时延长超时(默认 3s,>100KB 延至 8s)
      const res = await runSandboxedScript(data, script, timeout)
      if (!res.ok) {
        const isTimeout = /超时/.test(res.error || '')
        return toolError({ code: isTimeout ? 'SCRIPT_TIMEOUT' : 'SCRIPT_ERROR', message: `脚本执行失败: ${res.error}`, hint: isTimeout ? '脚本可能有死循环或过重计算;加边界检查/分批;transform 返回完整新值勿返回巨大中间结果' : '检查脚本语法与运行时错误;入参为 data(主数据深拷贝),沙箱内禁用 fetch/XHR/WebSocket', details: { elapsedMs: res.elapsedMs, scriptLen: script.length } })
      }
      if (mode === 'transform') {
        const result = res.result
        // 子树 transform:返回值作为 jsonPath 子树的新值(set 到子路径 + 整体 schema 校验)
        if (jp) {
          const clone = deepClone(bindRef)
          const patchErr = applyPatchToClone(clone, 'set', jp, result)
          if (patchErr) return toolError({ code: 'PATCH_FAILED', message: `eval 子树 transform @ "${jp}" 失败: ${patchErr}`, hint: '检查子路径:set 需父为对象/数组' })
          const chk = schema.safeParse(clone)
          if (!chk.success) return toolError({ code: 'SCHEMA_INVALID', message: `脚本返回值作为子树 @ "${jp}" 后整体校验失败,未写入`, hint: `确认返回值符合 ${jp} 处的子 schema`, details: formatZodIssues(chk.error.issues) })
          pushSnapshot('edit', 'eval_transform_subtree')
          applyPatchToLive(bindRef, 'set', jp, result)
          audit({ op: 'edit', detail: `eval_transform_subtree @ ${jp}`, timestamp: Date.now() })
          lastReadHash = hashValue(bindRef)
          return `已通过脚本 transform 子树 @ ${jp} 更新(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
        }
        // 增量模式:脚本返回 {patches:[{op,jsonPath,value},...]} → 按 patch 应用(避免大对象整体重传)
        const isPatches = result && typeof result === 'object' && !Array.isArray(result)
          && 'patches' in (result as any) && Array.isArray((result as any).patches)
        if (isPatches) {
          if (bindRef === null || typeof bindRef !== 'object') {
            return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform(patches) 无法就地替换`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
          }
          const ps: any[] = (result as any).patches
          const clone = deepClone(bindRef)
          const applied: { op: EditOp; jp: string; value: unknown }[] = []
          for (let i = 0; i < ps.length; i++) {
            const p = ps[i]
            const jp = p.jsonPath || ''
            if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `patches[${i}] jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径' })
            if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `patches[${i}] @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可写' })
            const op = p.op as EditOp
            let pVal: unknown
            if (op !== 'remove') {
              if (p.value === undefined || p.value === '') return toolError({ code: 'MISSING_VALUE', message: `patches[${i}] ${op} 操作需要 value`, hint: `op 为 ${op} 时 value 必填` })
              const pr = maybeParseValue(p.value)
              if (pr.parseError) return jsonParseError(`patches[${i}]`, p.value, pr.parseError)
              pVal = pr.parsed
            }
            const patchErr = applyPatchToClone(clone, op, jp, pVal)
            if (patchErr) return toolError({ code: 'PATCH_FAILED', message: `patches[${i}]: ${patchErr}`, hint: '检查 op 与目标类型:merge 需对象,append 需数组' })
            applied.push({ op, jp, value: pVal })
          }
          const chk = schema.safeParse(clone)
          if (!chk.success) return toolError({ code: 'SCHEMA_INVALID', message: `脚本 patches 应用后整体校验失败,未写入`, hint: '确认 patches 合并后整体仍符合 schema', details: formatZodIssues(chk.error.issues) })
          pushSnapshot('edit', 'eval_transform')
          for (const a of applied) applyPatchToLive(bindRef, a.op, a.jp, a.value)
          audit({ op: 'edit', detail: `eval_transform(${applied.length} patches)`, timestamp: Date.now() })
          lastReadHash = hashValue(bindRef)
          return `已通过脚本 transform(patches) 更新主数据(${applied.length} 个 patch,耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
        }
        // 整体替换模式:脚本返回完整新值
        const chk = schema.safeParse(result)
        if (!chk.success) return toolError({ code: 'SCHEMA_INVALID', message: `脚本返回值校验失败,未写入(transform 模式要求返回主数据的完整新值且符合 schema)`, hint: `确认脚本 return 了完整新值(非部分);或返回 {patches:[...]} 走增量模式;按 describe_data() 查看格式`, details: formatZodIssues(chk.error.issues) })
        if (bindRef === null || typeof bindRef !== 'object') {
          return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform 无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
        }
        pushSnapshot('edit', 'eval_transform')
        if (chk.data !== null && typeof chk.data === 'object') {
          if (allowKeys) {
            // 白名单模式:merge 语义,只更新 schema 声明字段,隐藏字段保留不动
            safeMerge(bindRef as Record<string, any>, chk.data)
          } else {
            restoreInPlace(bindRef as Record<string, unknown> | unknown[], chk.data)
          }
        }
        audit({ op: 'edit', detail: 'eval_transform', timestamp: Date.now() })
        lastReadHash = hashValue(bindRef)
        return `已通过脚本 transform 更新主数据(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
      }
      return safeStringify({ ok: true, result: res.result, elapsedMs: res.elapsedMs })
    },
    {
      name: 'eval_script',
      description:
        '在隔离的 Web Worker 沙箱里对主数据跑自定义 JS 脚本(无 window/document 访问,fetch/XHR/WebSocket/importScripts 已禁用,超时 3s 可终止)。脚本以 `data` 为入参(主数据的深拷贝),返回值即结果。mode:query(默认,只读,把返回值回给 LLM,适合过滤/映射/聚合/统计大数组)、transform(把返回值作为主数据的新整体值,经 schema 校验后就地落地,适合批量重写)。transform 支持两种返回形式:① 完整新值(整体替换);② {patches:[{op,jsonPath,value},...]} 增量 patch(按 patch 应用,避免大对象整体重传,任一 patch 失败或整体 schema 校验失败则不写入)。query 不改主数据。脚本内可用标准 JS(Array/Object/JSON/Math 等)与 async/await。jsonPath(可选,子树模式):仅对 jsonPath 指向的子树执行(降低大 JSON 深拷贝/执行成本),transform 时返回值作为该子树的新值。',
      schema: z.object({
        script: z.string().describe('JS 脚本体,如 data.filter(c=>c.stock>0).map(c=>c.id);入参名 data;末尾表达式或 return 即返回值'),
        mode: z.enum(['query', 'transform']).optional().describe('query=只读返回结果(默认),transform=校验后落地为新值'),
        jsonPath: z.string().optional().describe('子树模式:仅对 jsonPath 指向的子树执行(降低大 JSON 成本);transform 时返回值作为该子树新值'),
      }),
    },
  )

  // ============ 高层直观工具:read / write(合并 describe+get / set+edit+delete+自动锁+自动快照) ============
  const readSlot = tool(
    async ({ jsonPath, jsonPaths, fields, depth, offset, limit }) => {
      const h = hashValue(bindRef)  // 整体 hash(与 get_data 一致,乐观锁比对整体);多路径/分页/单路径统一取一次
      lastReadHash = h
      // 多路径模式:一次读多个不相关子路径(各路径独立投影/拦截/裁剪;非法路径单项标错,不整批失败),省多轮往返
      if (jsonPaths && jsonPaths.length) {
        const lines = jsonPaths.map((jpRaw) => {
          const jp = jpRaw || ''
          if (!isPathAllowed(jp, schema, allowKeys)) return `- ${jp || '(根)'}: [PATH_DENIED: 不在 schema 声明字段内]`
          let target = jp ? getByPath(bindRef, jp) : bindRef
          if (!jp) target = projectBySchema(target, allowKeys)
          else if (allowKeys) { const ss = getSchemaAtPath(schema, jp); if (ss) target = projectBySchemaDeep(target, ss) }
          let resolved = target
          if (opts.interceptors?.read) { try { resolved = opts.interceptors.read(resolved) } catch (e) { return `- ${jp}: [READ_INTERCEPT: ${(e as Error).message}]` } }
          if (fields && fields.length) resolved = projectFields(resolved, fields)
          if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
          if (resolved === undefined) return `- ${jp} = (undefined)`
          return `- ${jp} = ${safeStringify(resolved)}`
        })
        return `多路径读取(共 ${jsonPaths.length} 项,hash=${h}):\n${lines.join('\n')}`
      }
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常属性路径,如 components.0.text(数组索引数字)' })
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `read @ "${jp}" 不在 schema 声明字段内`, hint: '主数据仅暴露 schema 声明的字段;若需操作该字段,集成方需在 schema 中声明它' })
      }
      let target = jp ? getByPath(bindRef, jp) : bindRef
      // 投影隐藏未声明字段:整体读按顶层白名单;子路径读按该位置的子 schema 递归投影(防 child 不可见字段泄露)
      if (!jp) target = projectBySchema(target, allowKeys)
      else if (allowKeys) {
        const subSchema = getSchemaAtPath(schema, jp)
        if (subSchema) target = projectBySchemaDeep(target, subSchema)
      }
      let resolved = target
      if (opts.interceptors?.read) {
        try { resolved = opts.interceptors.read(resolved) } catch (e) {
          return toolError({ code: 'READ_INTERCEPT', message: `read 拦截器抛错: ${(e as Error).message}` })
        }
      }
      if (fields && fields.length) resolved = projectFields(resolved, fields)
      if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
      const desc = !jsonPath ? `主数据说明: ${description}\n格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 write 会返回结构化错误)。字段约束(类型/min/max/enum/必填/默认)见 systemPrompt「可操作数据」段,或用 schema_data({ jsonPath }) 按需查。\n\n` : ''
      const proj = fields && fields.length ? `(字段裁剪:${fields.join(',')})` : ''
      const dlim = depth !== undefined && depth !== null ? `(深度≤${depth})` : ''
      const meta = proj || dlim ? ` ${proj}${dlim}` : ''
      // 数组分页(仅当 resolved 是数组 + 传了 offset/limit):切片 + total/hasMore,避免大数组一次性返回
      if ((offset !== undefined || limit !== undefined) && Array.isArray(resolved)) {
        const total = resolved.length
        const off = Math.max(0, offset ?? 0)
        const lim = Math.min(200, Math.max(1, limit ?? 50))
        const items = resolved.slice(off, off + lim)
        const hasMore = off + lim < total
        return `${desc}主数据${jp ? ` @ ${jp}` : ''} 数组分页[offset=${off},limit=${lim}]${meta} = ${safeStringify(items)} (total=${total}, hasMore=${hasMore}) (hash=${h})`
      }
      if (resolved === undefined) return `${desc}主数据${jp ? ` @ ${jp}` : ''}${meta} = (undefined) (hash=${h})`
      return `${desc}主数据${jp ? ` @ ${jp}` : ''}${meta} = ${safeStringify(resolved)} (hash=${h})`
    },
    {
      name: 'read',
      description:
        '读取主数据(高层入口,合并 describe/get)。不传 jsonPath → 返回主数据说明 + 格式提示(含字段约束);传 jsonPath → 返回该子路径当前值 + hash;传 jsonPaths → 一次读多个不相关子路径(省多轮往返)。hash 用于乐观锁(默认 autoLock,write 时自动比对,无需手动传)。fields(字段裁剪)/depth(深度截断)减体积;offset+limit 对数组目标分页(返回切片 + total/hasMore)。集成方可能经 read 拦截器对返回值脱敏/派生。',
      schema: z.object({
        jsonPath: z.string().optional().describe('要读的子路径(相对主数据根,如 components.0.text);不传则读整个主数据并返回说明'),
        jsonPaths: z.array(z.string()).optional().describe('多路径读取:一次读多个不相关子路径(与 jsonPath 互斥,优先于 jsonPath);返回各路径值,非法路径单项标错不整批失败'),
        fields: z.array(z.string()).optional().describe('字段裁剪:只返回指定字段(对对象/数组元素投影),减少返回体积,如 ["id","title"]'),
        depth: z.number().int().min(0).optional().describe('嵌套深度限制:0=只根占位,1=根+子,递归到 depth 层后用 {...}/[...] 占位截断,减少深层返回体积'),
        offset: z.number().int().min(0).optional().describe('数组分页起始偏移(仅当读取目标是数组时生效,默认 0),配合 limit 分页读大数组'),
        limit: z.number().int().min(1).max(200).optional().describe('数组分页每页条数(默认 50,上限 200;仅数组时生效),返回切片 + total/hasMore'),
      }),
    },
  )

  const writeSlot = tool(
    async ({ value, patch, patches, del, dryRun }) => {
      let intent: 'set' | 'edit' | 'delete' = 'set'
      if (del) intent = 'delete'
      else if (patches && patches.length) intent = 'edit'
      else if (patch) intent = 'edit'
      let payload: unknown = patch?.value !== undefined ? patch.value : value  // patch 自带 value 优先(与 patches 一致,消除双语义歧义);未填回退顶层 value(向后兼容)
      let patchList: { op: EditOp; jsonPath: string; value?: unknown }[] | undefined
      if (opts.interceptors?.write) {
        try {
          const interceptInput =
            intent === 'delete' ? { del: true, jsonPath: patch?.jsonPath }
            : intent === 'edit' && patches && patches.length ? { patches }
            : intent === 'edit' ? { op: patch!.op ?? 'set', jsonPath: patch!.jsonPath || '', value: payload }
            : value
          const intercepted = opts.interceptors.write(interceptInput, bindRef)
          if (intercepted && typeof intercepted === 'object' && 'error' in (intercepted as any)) {
            return toolError({ code: 'WRITE_INTERCEPT', message: `write 拦截器拒绝: ${(intercepted as any).error}` })
          }
          if (intent === 'delete') {
            // delete 仅校验/拒绝,不写值
          } else if (intent === 'edit' && patches && patches.length) {
            // 批量:拦截器返回新 patches 数组(或原样)
            patchList = (intercepted && Array.isArray(intercepted)) ? (intercepted as any) : patches
          } else if (intent === 'edit') {
            // 单 patch edit:拦截器收到 { op, jsonPath, value },可能返回:
            // ① 原样/修改后的 { op, jsonPath, value } → 取 .value,同步 patch.op/jsonPath
            // ② 修改后的 value(非 { op, ... } 对象)→ 直接用
            if (intercepted && typeof intercepted === 'object' && 'op' in (intercepted as any) && 'jsonPath' in (intercepted as any)) {
              const ir = intercepted as any
              if (ir.op) patch!.op = ir.op
              if (ir.jsonPath !== undefined) patch!.jsonPath = ir.jsonPath
              payload = ir.value
            } else {
              payload = intercepted
            }
          } else {
            // set 整体替换:拦截器收到完整 value,返回修改后的 value
            payload = intercepted
          }
        } catch (e) {
          return toolError({ code: 'WRITE_INTERCEPT', message: `write 拦截器抛错: ${(e as Error).message}` })
        }
      }
      const effHash = autoLock ? lastReadHash : undefined
      // dryRun 预检:乐观锁手动比对(不调 onConflict 挂起,只返回冲突信息;dryRun 不实际写无需人工介入)
      if (dryRun && effHash !== undefined) {
        const curHash = hashValue(bindRef)
        if (curHash !== effHash) return toolError({ code: 'VERSION_CONFLICT', message: `dryRun 预检发现乐观锁冲突: expectedHash=${effHash} 当前 hash=${curHash}(主数据在你 read 后被改)`, hint: '重新 read 拿最新 hash 再预检/写' })
      }

      if (intent === 'delete') {
        if (!patch?.jsonPath) return toolError({ code: 'MISSING_VALUE', message: 'delete 需要 patch.jsonPath 指定要删的子路径(主数据整体不可删,用 write(value) 整体替换)', hint: '如 patch:{jsonPath:"components.0"}, del:true' })
        if (isUnsafePath(patch.jsonPath)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${patch.jsonPath}" 含非法段`, hint: '使用正常属性路径' })
        if (!isPathAllowed(patch.jsonPath, schema, allowKeys)) {
          return toolError({ code: 'PATH_DENIED', message: `write delete @ "${patch.jsonPath}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可删' })
        }
        const conflict = await handleConflict('delete', effHash)
        if (conflict !== null) return conflict
        if (dryRun) {
          const dClone = deepClone(bindRef)
          const dOk = deleteByPath(dClone, patch.jsonPath)
          return dOk ? `dryRun(delete): 将删除 @ ${patch.jsonPath}。预览剩余:${safeStringify(dClone, 600)}。未实际写入、未入快照。` : `dryRun(delete): @ ${patch.jsonPath} 不存在(无需删除)。未实际写入。`
        }
        pushSnapshot('delete')
        const ok = deleteByPath(bindRef, patch.jsonPath)
        audit({ op: 'delete', detail: patch.jsonPath, timestamp: Date.now() })
        lastReadHash = hashValue(bindRef)
        return ok ? `已删除主数据 @ ${patch.jsonPath}` : `主数据 @ ${patch.jsonPath} 不存在(无需删除)`
      }

      if (intent === 'edit') {
        if (bindRef == null || typeof bindRef !== 'object') return toolError({ code: 'NOT_OBJECT', message: `edit 仅适用于对象/数组主数据,当前是 ${bindRef === undefined ? 'undefined' : typeof bindRef}`, hint: '叶子用 write(value) 整体设置' })
        const conflict = await handleConflict('edit', effHash)
        if (conflict !== null) return conflict
        // 统一为 patch 列表:批量用 patches(或拦截器转换后的 patchList);单个用 [patch + 顶层 value]
        const list: { op: EditOp; jsonPath: string; value?: unknown }[] = patchList
          ? patchList
          : (patches && patches.length) ? patches
          : [{ op: patch!.op ?? 'set', jsonPath: patch!.jsonPath || '', value: payload }]
        const clone = deepClone(bindRef)
        const applied: { op: EditOp; jp: string; value: unknown }[] = []
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          const jp = p.jsonPath || ''
          if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `patches[${i}] jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径,如 components.0.text' })
          if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `patches[${i}] @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可写' })
          const op = p.op
          let pVal: unknown
          if (op !== 'remove') {
            if (p.value === undefined || p.value === '') return toolError({ code: 'MISSING_VALUE', message: `patches[${i}] ${op} 操作需要 value`, hint: `op 为 ${op} 时 value 必填;删除请用 op:'remove'` })
            const pr = maybeParseValue(p.value)
            if (pr.parseError) return jsonParseError(`patches[${i}]`, p.value, pr.parseError)
            pVal = pr.parsed
          }
          const patchErr = applyPatchToClone(clone, op, jp, pVal)
          if (patchErr) return toolError({ code: 'PATCH_FAILED', message: `patches[${i}]: ${patchErr}`, hint: '检查 op 与目标类型:merge 需对象,append 需数组' })
          applied.push({ op, jp, value: pVal })
        }
        const res = schema.safeParse(clone)
        if (!res.success) return zodError('', res.error.issues)
        if (dryRun) {
          return `dryRun(edit): ${applied.length} 个 patch 预检通过(schema 校验 OK)。预览结果:${safeStringify(clone, 600)}。未实际写入、未入快照。`
        }
        pushSnapshot('edit')
        for (const a of applied) applyPatchToLive(bindRef, a.op, a.jp, a.value)
        audit({ op: 'edit', detail: `${applied.length} 个 patch${applied.length > 1 ? '(批量)' : ''}`, value: applied.map((a) => `${a.op}@${a.jp}`), timestamp: Date.now() })
        lastReadHash = hashValue(bindRef)
        return `已 write(edit) 主数据(${applied.length} 个 patch)。当前值:${safeStringify(bindRef, 600)} (新 hash=${hashValue(bindRef)})`
      }

      // set 整体
      let parsed: unknown
      const pr = maybeParseValue(payload)
      if (pr.parseError) return jsonParseError('', payload, pr.parseError)
      parsed = pr.parsed
      const conflict = await handleConflict('set', effHash)
      if (conflict !== null) return conflict
      const res = schema.safeParse(parsed)
      if (!res.success) return zodError('', res.error.issues)
      if (dryRun) {
        return `dryRun(set): schema 校验通过。预览新值:${safeStringify(res.data, 600)}。未实际写入、未入快照。`
      }
      if (bindRef === null || typeof bindRef !== 'object') {
        return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),write(set) 无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹(如 {value:"x"})或集成方通过 sdk.setData 替换 bind' })
      }
      pushSnapshot('set')
      if (res.data !== null && typeof res.data === 'object') {
        if (allowKeys) {
          // 白名单模式(schema 是 ZodObject 子集):merge 语义,只更新 schema 声明字段,隐藏字段保留不动(防误删)
          safeMerge(bindRef as Record<string, any>, res.data)
        } else {
          restoreInPlace(bindRef as Record<string, unknown> | unknown[], res.data)
        }
      }
      audit({ op: 'set', value: res.data, timestamp: Date.now() })
      lastReadHash = hashValue(bindRef)
      return `已 write(set) 主数据 = ${safeStringify(res.data, 600)} (新 hash=${hashValue(bindRef)})${allowKeys ? '(白名单模式:仅更新 schema 声明字段,未声明字段保留)' : ''}`
    },
    {
      name: 'write',
      description:
        '写入主数据(高层入口,合并 set/edit/delete + 自动乐观锁 + 自动快照)。四种意图:① 整体替换 write({ value }) value 为整个 JSON 对象(推荐)或字符串;② 单个增量 patch write({ patch:{op,jsonPath,value} }) op=set/remove/merge/append,jsonPath 相对主数据根(如 components.0.props.title),patch.value 是该 patch 的值(自带,与 patches 一致——string/number 直传该字段新值,勿包成 {字段:值} 对象);也兼容 write({ value, patch:{op,jsonPath} }) 顶层 value 形式(向后兼容,但优先用 patch.value 避免与①整体 set 的 value 语义混淆);③ 批量增量 write({ patches:[{op,jsonPath,value},...] }) 一次原子应用多个 patch(任一失败整体不写入,适合一次改多处);④ 删除 write({ patch:{jsonPath}, del:true })。写入自动经 schema 校验(失败不写)+ 自动存快照(可 restore_data 回退)+ 自动乐观锁(autoLock,用你最后 read 到的 hash 比对,冲突则 VERSION_CONFLICT)。集成方可能经 write 拦截器校验/转换/拒绝(批量模式拦截器收到 {patches},返回新 patches 数组或 {error})。dryRun(可选):预检模式,走完整校验链(schema + 白名单 + patch 应用到 clone)但不落盘/入快照,返回预览(四意图均支持,复杂改动先看会改成啥、能否过 schema)。',
      schema: z.object({
        value: z.unknown().optional().describe('JSON 对象(推荐,如 {title:"x"})或 JSON 字符串;set 整体或单个 patch 的 set/merge/append 必填'),
        patch: z.object({
          op: z.enum(['set', 'remove', 'merge', 'append']).optional().describe('增量操作:set 设值/remove 删/merge 合并对象/append 追加数组。单 patch edit 缺省按 set;del 模式(write({patch:{jsonPath},del:true}))不读 op 可省略'),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);set/remove 必填,merge/append 不填则作用于根'),
          value: z.unknown().optional().describe('该 patch 的值(JSON 直传或 JSON 字符串);set/merge/append 必填,remove 不需。与顶层 value 二选一:优先 patch.value,未填则回退顶层 value(向后兼容)。推荐用 patch.value(自带,与 patches 元素一致,无歧义)'),
        }).optional().describe('单个增量编辑(自带 value,与 patches 元素一致);传 patch(无 patches)走单 patch edit 语义'),
        patches: z.array(z.object({
          op: z.enum(['set', 'remove', 'merge', 'append']),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径;set/remove 必填,merge/append 不填则作用于根'),
          value: z.unknown().optional().describe('JSON 值(推荐直传)或 JSON 字符串;set/merge/append 必填,remove 不需'),
        })).optional().describe('批量增量编辑:一次原子应用多个 patch(任一失败则整体不写入,clone 试跑全部 + schema 校验通过才落 live)。适合一次改多处,减少多轮往返'),
        del: z.boolean().optional().describe('true 则删除 patch.jsonPath 指定的子路径(等价 delete_data)'),
        dryRun: z.boolean().optional().describe('预检模式:走完整校验链(schema + 白名单 + patch 应用到 clone)但不落盘、不入快照,返回预览。四意图(value/patch/patches/del)均支持;乐观锁冲突照常检测(返回 VERSION_CONFLICT 不挂起)'),
      }),
    },
  )

  const schemaData = tool(
    async ({ jsonPath }) => {
      const jp = jsonPath || ''
      const sub = jp ? getSchemaAtPath(schema, jp) : schema
      if (!sub) return toolError({ code: 'PATH_DENIED', message: `schema @ "${jp}" 不存在`, hint: 'jsonPath 需在 schema 声明字段内(用 read() 不传 jsonPath 查看顶层字段)' })
      return `schema${jp ? ` @ ${jp}` : ''} = ${safeStringify(describeSchemaNode(sub))}`
    },
    { name: 'schema_data', description: '查看主数据(或子路径)的字段约束:类型/min/max/enum/必填/默认值/嵌套 shape。写前查约束,避免写错重试。不传 jsonPath 查根;传子路径(如 components.0)查该位置约束。', schema: z.object({ jsonPath: z.string().optional().describe('要查约束的子路径;不传查根 schema') }) },
  )

  const diffData = tool(
    async ({ snapshotId, against }) => {
      const useAgainst = against !== undefined && against !== null
      let base: unknown
      let label: string
      if (useAgainst) {
        // against 可能是 JSON 字符串(LLM 直传),走 maybeParseValue 与 set_data/write 的 value 处理对齐(parse 失败保留原串)
        let v = against
        if (typeof v === 'string') {
          const pr = maybeParseValue(v)
          if (!pr.parseError) v = pr.parsed
        }
        base = v
        label = 'against'
      } else {
        if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可对比', hint: 'set/edit/delete 自动存快照;或传 against 一段 JSON 值直接对比' })
        const entry = snapshotId !== undefined ? snapshots.find((s) => s.id === snapshotId) : snapshots[snapshots.length - 1]
        if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${snapshotId}`, hint: '不传 snapshotId 用最近一次;或传 against' })
        base = entry.value
        label = `快照 #${entry.id}`
      }
      // 当前主数据按白名单投影(与快照/against 对比口径一致,隐藏未声明字段)
      const cur = allowKeys ? projectBySchema(bindRef, allowKeys) : bindRef
      const diffs = diffObjects(base, deepClone(cur))
      if (!diffs.length) return `无差异:当前主数据与 ${label} 完全相同。`
      return `差异(当前 vs ${label},共 ${diffs.length} 处):\n${diffs.map((d) => `  ${d.path}: ${safeStringify(d.from)} → ${safeStringify(d.to)}`).join('\n')}`
    },
    { name: 'diff_data', description: '对比当前主数据与某快照(默认最近)或一段 JSON(against)的差异,返回结构化 {path, from→to} 列表。供 verify 自纠/冲突诊断/操作审计("刚才改了啥")。snapshotId 指定快照;against 传一段 JSON 值(与 snapshotId 互斥,传则忽略快照)。', schema: z.object({ snapshotId: z.number().int().optional().describe('对比的快照序号;不传则最近一次'), against: z.unknown().optional().describe('对比的一段 JSON 值(与 snapshotId 互斥;传则忽略快照)') }) },
  )

  const tools: StructuredToolInterface[] = [
    describeData, getData, setData, editData, deleteData,
    snapshotData, listDataSnapshots, restoreData, historyData,
    queryData, searchData, evalScript,
    readSlot, writeSlot, schemaData, diffData,
  ]
  Object.defineProperty(tools, 'controller', { value: controller, enumerable: false, configurable: false, writable: false })
  return tools
}


