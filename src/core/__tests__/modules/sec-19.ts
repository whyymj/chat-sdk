import { z } from 'zod'
import { routeError, asAgentError } from '../../tools/toolError'
import { createDataOps, filterByToolMode } from '../../tools/dataOps'
import { extractSchemaHint } from '../../presets'
import { diffObjects } from '../../tools/jsonUtils'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { resolveCapabilities, CAPABILITIES } from '../../capabilities'
import { inspectTools } from '../../tools/envTool'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc } from '../../harness/skills'
import { createPermissionsMiddleware } from '../../harness/permissions'
import { createMemoryMiddleware } from '../../harness/memory'
import { applyUpdate, runBeforeAgent, runAfterModel, runBeforeReturn } from '../../harness/middleware'
import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { runPool } from '../../utils/pool'
import { createSubagentMiddleware, createSubagentsMiddleware } from '../../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, isAdversarialClean } from '../../harness/verify'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'
import { createCheckpointManager, createCheckpointMiddleware } from '../../harness/checkpoint'
import { extractText } from '../../mcp/client'
import { createInitialState as createState } from '../../harness/state'
import {
  encodeKey,
  estimateBytes,
  selectForEviction,
  isQuotaError,
  defaultMaxBytesFor,
  createMemoryBackend,
  createSessionStore,
} from '../../backends/storage'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars } from '../../utils/modelCaps'
import { useContextManager } from '../../composables/useContextManager'
import { resolveContextOptions } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/dataSlotQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

import type { TestCtx } from './_ctx'

// 对抗式验证(isAdversarialClean verdict 判定)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[adversarial verdict 判定]')
  {
    assert(isAdversarialClean('无问题') === true, 'verdict "无问题" → 放行(返回 true)')
    assert(isAdversarialClean('经过审查,没有问题。') === true, 'verdict "没有问题" → 放行')
    assert(isAdversarialClean('未发现问题') === true, 'verdict "未发现问题" → 放行')
    assert(isAdversarialClean('回复缺少价格字段,请补充') === false, 'verdict 含具体问题 → 触发自纠(返回 false)')
    assert(isAdversarialClean('逻辑矛盾:前后说法不一致') === false, 'verdict 含问题 → 触发自纠')
  }

  // ============ toolsets + selectBuiltinTools(内置工具集导出 + caps 筛选)============
  console.log('\n[toolsets + selectBuiltinTools]')
  {
    // fetchTools 静态预设(工具数组)
    assert(fetchTools.length === fetchDocTools.length && fetchTools[0].name === 'fetch_document', 'fetchTools 静态预设含 fetch_document')

    // defineDataToolset 工厂(依赖 data 单主对象,故为工厂)
    const config = { schema: z.enum(['light', 'dark']), bind: { $dummy: true } as any, description: '主题' }
    const wt = defineDataToolset(config)
    assert(wt.length === 14 && wt[0].name === 'describe_data', 'defineDataToolset 工厂产出 14 个数据工具(9 基础 + read/write/schema_data/history_data/diff_data;snapshot_data/list_data_snapshots 已移除)')

    // selectBuiltinTools:默认全装(dataOps + fetch)
    const dataOps = createDataOps(config)
    const all = selectBuiltinTools(undefined, dataOps, fetchDocTools)
    assert(all.length === dataOps.length + fetchDocTools.length, 'selectBuiltinTools 默认全装(dataOps + fetch)')

    // dataOps:false → 不含数据工具,fetch 仍在
    const noData = selectBuiltinTools({ dataOps: false }, dataOps, fetchDocTools)
    assert(noData.length === fetchDocTools.length && noData.every((t) => t.name === 'fetch_document'), 'dataOps:false → 只剩 fetch_document')

    // fetch:false → 不含 fetch,数据工具仍在
    const noFetch = selectBuiltinTools({ fetch: false }, dataOps, fetchDocTools)
    assert(noFetch.length === dataOps.length && noFetch.every((t) => t.name !== 'fetch_document'), 'fetch:false → 只剩数据工具')

    // 两者都关 → 空
    const none = selectBuiltinTools({ dataOps: false, fetch: false }, dataOps, fetchDocTools)
    assert(none.length === 0, 'dataOps + fetch 都关 → 工具池空')

    // inspect_env 默认开(=== false 才关):传 inspect 数组时默认装入
    const withInspect = selectBuiltinTools(undefined, dataOps, fetchDocTools, undefined, inspectTools)
    assert(withInspect.some((t) => t.name === 'inspect_env'), 'selectBuiltinTools 默认装 inspect_env(inspectEnv 默认开)')
    assert(withInspect.length === dataOps.length + fetchDocTools.length + inspectTools.length, 'selectBuiltinTools 默认含 inspect(默认开,dataOps+fetch+inspect)')
    // inspectEnv:false → 不含 inspect(其他不变)
    const noInspect = selectBuiltinTools({ inspectEnv: false }, dataOps, fetchDocTools, undefined, inspectTools)
    assert(noInspect.every((t) => t.name !== 'inspect_env') && noInspect.length === dataOps.length + fetchDocTools.length, 'inspectEnv:false → 不含 inspect_env(其余不变)')
    // 不传 inspect 数组 → 即使默认开也无 inspect 可装(不报错)
    const noInspectArr = selectBuiltinTools(undefined, dataOps, fetchDocTools)
    assert(noInspectArr.every((t) => t.name !== 'inspect_env'), '未传 inspect 数组 → 不含 inspect(默认开但无源)')
  }

  // ============ usageHints 中间件(能力用法默认提示,克制注入)============
  console.log('\n[usageHints middleware]')
  {
    // 全开 → 含 planning/snapshot/spawn 三条提示
    const mwFull = createUsageHintsMiddleware({ planning: true, subagent: true }, true)
    const segFull = mwFull.augmentPrompt?.(createState()) || ''
    assert(/write_todos/.test(segFull) && /restore_data/.test(segFull) && /spawn_agent/.test(segFull), '能力全开 → 注入 planning/snapshot/spawn 用法')
    // dataOps 开 + simple(默认)→ 主推 read/write(高层入口)
    assert(/\bread\b/.test(segFull) && /\bwrite\b/.test(segFull), 'dataOps 开 + simple → 注入 read/write 高层用法')
    assert(/offset|分页/.test(segFull), 'dataOps 开 + simple → 注入分页(offset)用法(refine-dataops 可达性)')
    assert(/history_data/.test(segFull), 'dataOps 开 + simple → 注入 history_data 提示(followup 可达性)')
    // advanced 模式 → 保留底层 get/describe 提示
    const mwAdv = createUsageHintsMiddleware({ planning: true, subagent: true }, true, 'advanced')
    const segAdv = mwAdv.augmentPrompt?.(createState()) || ''
    assert(/describe_data/.test(segAdv), 'dataOps 开 + advanced → 注入 describe 用法')
    assert(/get_data/.test(segAdv), 'dataOps 开 + advanced → 注入 get_data 读真实值再改用法')
    assert(/offset|分页/.test(segAdv), 'dataOps 开 + advanced → 注入分页用法(refine-dataops 可达性)')
    assert(/diff_data/.test(segAdv), 'dataOps 开 + advanced → 注入 diff_data 提示(followup 可达性)')

    // planning 关 → 无 write_todos 提示
    const mwNoPlan = createUsageHintsMiddleware({ planning: false, subagent: true }, true)
    const segNoPlan = mwNoPlan.augmentPrompt?.(createState()) || ''
    assert(!/write_todos/.test(segNoPlan), 'planning 关 → 不注入 write_todos 提示')

    // hasDataOps=false → 无 snapshot 提示
    const mwNoData = createUsageHintsMiddleware({ planning: true, subagent: true }, false)
    const segNoData = mwNoData.augmentPrompt?.(createState()) || ''
    assert(!/restore_data/.test(segNoData), '无数据工具 → 不注入 snapshot 提示')

    // 全关 → undefined(不增上下文)
    const mwNone = createUsageHintsMiddleware({ planning: false, subagent: false, inspectEnv: false }, false)
    assert(mwNone.augmentPrompt?.(createState()) === undefined, '全关 → augmentPrompt 返回 undefined(不增上下文)')

    assert(mwFull.name === 'usageHints', '中间件 name=usageHints')
  }

  // ============ filterByToolMode(工具呈现模式筛选)============
  console.log('\n[filterByToolMode]')
  {
    const config = { schema: z.any(), bind: { x: 1 } as any, description: 'd' }
    const all = createDataOps(config)  // 14 个工具(移除 snapshot_data/list_data_snapshots)
    const names = (ts: any[]) => ts.map((t) => t.name)
    // advanced → 全暴露(14)
    const adv = filterByToolMode(all, 'advanced')
    assert(adv.length === 14 && adv.length === all.length, 'advanced → 全暴露(14 工具;simplify-toolset 移除 snapshot/list)')
    // simple → 隐藏 9 个底层(describe/get/set/edit/delete/schema_data/snapshot/list/diff),保留 read/write + query/search/eval/restore/history(7)
    const simple = filterByToolMode(all, 'simple')
    const simpleNames = names(simple)
    assert(simple.length === 7, 'simple → 7 工具(evolve 精简:去 snapshot/list,补 history_data;diff_data 只 advanced)')
    assert(['read', 'write', 'query_data', 'search_data', 'eval_script', 'restore_data', 'history_data'].every((n) => simpleNames.includes(n)), 'simple → 含 read/write + query/search/eval/restore/history')
    assert(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'schema_data', 'diff_data'].every((n) => !simpleNames.includes(n)), 'simple → 隐藏底层 5 + schema_data + diff_data(snapshot_data/list_data_snapshots 已彻底移除)')
    // minimal → 只 read/write
    const minimal = filterByToolMode(all, 'minimal')
    assert(minimal.length === 2 && names(minimal).includes('read') && names(minimal).includes('write'), 'minimal → 只 read/write')
    // 默认(不传 mode)= simple
    const def = filterByToolMode(all)
    assert(def.length === 7, '默认 toolMode = simple')
  }

  // ============ history_data(只读查看快照,evolve-default-toolset 期一)============
  console.log('\n[history_data 只读快照]')
  {
    const config = { schema: z.object({ name: z.string(), tags: z.array(z.string()) }), bind: { name: 'a', tags: ['x'] } as any, description: 'd' }
    const tools = createDataOps(config)
    const t = byName(tools)
    // 无快照 → NO_SNAPSHOT
    assert(/NO_SNAPSHOT/.test(await invoke(t.history_data, {})), 'history_data 无快照 → NO_SNAPSHOT')
    // 写一次产生快照(写前值 a/x 入栈)
    await invoke(t.write, { value: { name: 'b', tags: ['y'] } })
    // 默认查最近快照 → 含写前值(name=a),且当前 bind 不变
    const h = await invoke(t.history_data, {})
    assert(/快照 #1/.test(h) && /"name":"a"/.test(h), 'history_data 默认最近快照 → 含写前值(name=a)')
    assert(/"name":"b"/.test(await invoke(t.read, {})), 'history_data 只读 → 当前 bind 不变(仍 b/y)')
    // 子路径查
    const hsub = await invoke(t.history_data, { jsonPath: 'tags' })
    assert(/\["x"\]/.test(hsub), 'history_data jsonPath → 只看子路径(快照 tags=[x])')
    // id 不存在
    assert(/SNAPSHOT_NOT_FOUND/.test(await invoke(t.history_data, { id: 999 })), 'history_data id 不存在 → SNAPSHOT_NOT_FOUND')
  }

  // ============ evolve 期二:read 多路径/分页 + write dryRun + eval 子树(paging 拆分)============
  console.log('\n[evolve 期二:read 多路径/分页 + write dryRun + eval 子树]')
  {
    const config = {
      schema: z.object({ title: z.string(), items: z.array(z.object({ id: z.number(), name: z.string() })), flag: z.boolean() }),
      bind: { title: 't', items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }], flag: true },
      description: 'd',
    } as any
    const tools = createDataOps(config)
    const t = byName(tools)

    // read 多路径:一次读多个不相关子路径
    const mp = await invoke(t.read, { jsonPaths: ['title', 'flag'] })
    assert(/多路径读取/.test(mp) && /- title = "t"/.test(mp) && /- flag = true/.test(mp), 'read jsonPaths → 多路径读取各值')
    // 多路径含非法路径 → 单项标错不整批失败
    const mpErr = await invoke(t.read, { jsonPaths: ['title', 'nope'] })
    assert(/PATH_DENIED/.test(mpErr) && /- title = "t"/.test(mpErr), 'read jsonPaths 非法路径 → 单项标错,合法路径仍返回')

    // read 数组分页
    const pg = await invoke(t.read, { jsonPath: 'items', offset: 1, limit: 1 })
    assert(/数组分页\[offset=1,limit=1\]/.test(pg) && /total=3/.test(pg) && /hasMore=true/.test(pg), 'read offset/limit → 数组分页切片 + total/hasMore')
    const pgLast = await invoke(t.read, { jsonPath: 'items', offset: 2, limit: 5 })
    assert(/hasMore=false/.test(pgLast), 'read 分页到末尾 → hasMore=false')

    // write dryRun(set):校验通过但不落盘
    const dr = await invoke(t.write, { value: { title: 'new', items: [], flag: false }, dryRun: true })
    assert(/dryRun\(set\)/.test(dr) && /未实际写入/.test(dr), 'write dryRun(set) → 预检通过返回预览')
    assert(/"title":"t"/.test(await invoke(t.read, {})), 'write dryRun(set) → bind 未变(title 仍 t)')
    // dryRun 校验失败也不写入
    const drFail = await invoke(t.write, { value: { title: 123 }, dryRun: true })
    assert(/SCHEMA_INVALID|invalid_type/.test(drFail), 'write dryRun 校验失败 → 返回 schema 错误')
    assert(/"title":"t"/.test(await invoke(t.read, {})), 'write dryRun 校验失败 → bind 仍不变')
    // dryRun(edit patch)
    const drEdit = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title' }, value: 'X', dryRun: true })
    assert(/dryRun\(edit\)/.test(drEdit), 'write dryRun(edit) → 预检通过返回预览')
    assert(/"title":"t"/.test(await invoke(t.read, {})), 'write dryRun(edit) → bind 未变')
    // dryRun(delete)
    const drDel = await invoke(t.write, { patch: { op: 'remove', jsonPath: 'flag' }, del: true, dryRun: true })
    assert(/dryRun\(delete\)/.test(drDel), 'write dryRun(delete) → 预检返回预览')
    assert(/"flag":true/.test(await invoke(t.read, {})), 'write dryRun(delete) → bind 未变(flag 仍 true)')
    // dryRun 去掉 dryRun 必成功写入(set 同值)
    const real = await invoke(t.write, { value: { title: 'new2', items: config.bind.items, flag: false } })
    assert(/已 write\(set\)/.test(real), 'write 非 dryRun → 实际写入')
    assert(/"title":"new2"/.test(await invoke(t.read, {})), 'write 非 dryRun → bind 已变(title=new2)')

    // eval_script 子树:jsonPath 路径校验(node 无 Worker,不实际跑脚本,只验子树分支)
    const evBad = await invoke(t.eval_script, { script: 'data', jsonPath: 'nope' })
    assert(/PATH_DENIED/.test(evBad), 'eval_script jsonPath 非法 → PATH_DENIED(子树路径校验)')
    const evOk = await invoke(t.eval_script, { script: 'data', jsonPath: 'items' })
    assert(!/PATH_DENIED/.test(evOk), 'eval_script jsonPath 合法 → 不 PATH_DENIED(进入子树执行分支)')
  }

  // ============ diffObjects + diff_data(evolve 期三)============
  console.log('\n[diffObjects + diff_data]')
  {
    // diffObjects 白盒
    assert(diffObjects({ a: 1, b: 2 }, { a: 1, b: 3 }).length === 1, 'diffObjects → 对象叶子差异(仅 b 变)')
    assert(diffObjects({ a: 1 }, { a: 1 }).length === 0, 'diffObjects → 相同对象无差异')
    assert(diffObjects([1, 2, 3], [1, 2]).length === 1, 'diffObjects → 数组末尾元素差异')
    assert(diffObjects({ a: 1 }, { b: 1 })[0].path === 'a', 'diffObjects → key 删除+新增(a from 1 to undefined)')
    assert(diffObjects(1, 2)[0].from === 1 && diffObjects(1, 2)[0].to === 2, 'diffObjects → 叶子不同记 from/to')
    assert(diffObjects('x', 'x').length === 0, 'diffObjects → 叶子相同无差异')

    // diff_data 工具(advanced;对比当前 vs 快照/against)
    const cfg = { schema: z.object({ name: z.string(), age: z.number() }), bind: { name: 'a', age: 1 }, description: 'd' } as any
    const tools = createDataOps(cfg)
    const t = byName(tools)
    await invoke(t.write, { value: { name: 'b', age: 2 } })  // 产生快照(写前 a/1),当前变 b/2
    const d1 = await invoke(t.diff_data, {})
    assert(/差异/.test(d1) && /name.*"a".*"b"/.test(d1) && /age.*1.*2/.test(d1), 'diff_data 默认最近快照 → 列出 name/age 差异')
    const d2 = await invoke(t.diff_data, { against: { name: 'b', age: 2 } })
    assert(/无差异/.test(d2), 'diff_data against=当前值 → 无差异')
    const d3 = await invoke(t.diff_data, { against: { name: 'X', age: 9 } })
    assert(/差异/.test(d3) && /name.*"X".*"b"/.test(d3), 'diff_data against 不同 JSON → 列出差异(from=against X → 当前 b)')
    // 无快照 + 不传 against → NO_SNAPSHOT
    const t2 = byName(createDataOps({ schema: z.object({ x: z.string() }), bind: { x: '1' }, description: 'd' } as any))
    assert(/NO_SNAPSHOT/.test(await invoke(t2.diff_data, {})), 'diff_data 无快照 + 不传 against → NO_SNAPSHOT')
  }

  // ============ extractSchemaHint(io 契约注入 systemPrompt 用)============
  console.log('\n[extractSchemaHint]')
  {
    // zod object:提取字段名 + description
    const schema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const hint = extractSchemaHint(schema)
    assert(/- title \(string\): 页面标题/.test(hint) && /- count \(number\)/.test(hint), 'extractSchemaHint: object → 提取字段名 + 类型 + description')
    // 无 description 的字段:只显示字段名(或 typeName)
    const schema2 = z.object({ name: z.string() })
    assert(/- name/.test(extractSchemaHint(schema2)), 'extractSchemaHint: 无 description → 仍含字段名')
    // 非 object schema:用 description 兜底
    const scalar = z.string().describe('一个字符串')
    assert(/一个字符串/.test(extractSchemaHint(scalar)), 'extractSchemaHint: 非 object → 用 description 兜底')
    // 无 description 的非 object:兜底提示
    assert(/\(root\)/.test(extractSchemaHint(z.string())), 'extractSchemaHint: 无 description 非 object → fallback 根节点类型标注')
    // 空/undefined
    assert(extractSchemaHint(undefined) === '', 'extractSchemaHint: undefined → 空串')
  }

  // ============ skills 文档源(doc:http 远程 / vfs 本地)============
  console.log('\n[skills 文档源]')
  {
    // resolveDocKind 判定来源
    assert(resolveDocKind('https://host/g.md') === 'http', 'resolveDocKind: https → http')
    assert(resolveDocKind('http://host/g.md') === 'http', 'resolveDocKind: http → http')
    assert(resolveDocKind('//host/g.md') === 'http', 'resolveDocKind: 协议相对 // → http')
    assert(resolveDocKind('vfs://skills/g.md') === 'vfs', 'resolveDocKind: vfs:// → vfs')
    assert(resolveDocKind('skills/g.md') === 'vfs', 'resolveDocKind: 裸路径 → vfs')
    assert(resolveDocKind('/skills/g.md') === 'vfs', 'resolveDocKind: /abs 路径 → vfs')

    // normalizeVfsPath 去前缀 + 规范化
    assert(normalizeVfsPath('vfs://skills/g.md') === 'skills/g.md', 'normalizeVfsPath: 去 vfs:// 前缀')
    assert(normalizeVfsPath('/skills/g.md') === 'skills/g.md', 'normalizeVfsPath: 去前导 /')
    assert(normalizeVfsPath('skills//g.md') === 'skills/g.md', 'normalizeVfsPath: 合并重复斜杠')

    // readSkillDoc vfs 分支(http 分支含 fetch,运行时手动验证)
    const vfsOk = await readSkillDoc('vfs://skills/g.md', () => '# 指南\n正文')
    assert(vfsOk.ok && vfsOk.content === '# 指南\n正文', 'readSkillDoc: vfs 文档存在 → 返回内容')

    const vfsMiss = await readSkillDoc('vfs://skills/missing.md', () => undefined)
    assert(!vfsMiss.ok && /未找到/.test(vfsMiss.error), 'readSkillDoc: vfs 文档不存在 → 未找到')

    const vfsNoInst = await readSkillDoc('skills/g.md')
    assert(!vfsNoInst.ok && /vfs 未启用/.test(vfsNoInst.error), 'readSkillDoc: vfs 路径但未注入 readVfs → 提示未启用')

    // load_skill 整体:doc 优先于 getContent
    const mw = createSkillsMiddleware([defineSkill({ name: 'doc-skill', description: 'd', doc: 'vfs://x.md' })], {
      readVfs: () => '文档正文',
    })
    const loadTool = byName(mw.tools || [])
    const r1 = await invoke(loadTool.load_skill, { name: 'doc-skill' })
    assert(/文档正文/.test(r1), 'load_skill: doc 源 → 读取文档注入(优先于 getContent)')
    const r2 = await invoke(loadTool.load_skill, { name: 'doc-skill' })
    assert(/已在本轮加载/.test(r2), 'load_skill: 重复加载 → 提示无需重复')
  }

  // ============ subagents 预声明(子 agent → use_<id> 委派工具)============
  console.log('\n[subagents 预声明]')
  {
    const mw = createSubagentsMiddleware(
      [
        { id: 'researcher', description: '调研专家' },
        { id: 'writer', description: '文案撰写' },
        { id: 'bad-id!', description: '不合法 id' },
        { id: 'researcher', description: '重复 id' },
      ],
      { llm: { apiKey: 'x' }, allTools: [] },
    )
    const names = (mw.tools as any[]).map((t) => t.name)
    assert(names.includes('use_researcher') && names.includes('use_writer'), 'subagents → 每个 config 生成 use_<id> 工具')
    assert(names.length === 2, '不合法 id + 重复 id 被跳过(剩 2 个)')
    const seg = mw.augmentPrompt?.(createState()) || ''
    assert(/use_researcher.*调研专家/.test(seg), 'augmentPrompt 注入子 agent 索引(use_<id>: desc)')
    assert(mw.name === 'subagents', '中间件 name=subagents')
  }

  // ============ unify-error-model:routeError / asAgentError(三档错误模型)============
  // 注:routeError 框架内置 catch 点当前未消费(用简化硬编码路由);此处验证导出可用 + 行为正确,
  // 为未来 wrapToolCall 自动路由扩展锁行为(见 change fix-unify-error-half-done)。
  console.log('\n[unify-error-model: routeError / asAgentError]')
  {
    // routeError 纯函数:severity → 路由
    assert(routeError({ severity: 'recoverable', message: 'x' }) === 'feedback', 'routeError → recoverable=feedback(回灌 LLM)')
    assert(routeError({ severity: 'fatal', message: 'x' }) === 'abort', 'routeError → fatal=abort(emit+中断)')
    assert(routeError({ severity: 'observable', message: 'x' }) === 'log', 'routeError → observable=log(记录不中断)')
    // asAgentError 归一化:普通 Error 用 defaultSeverity;已是 AgentError 不覆盖
    assert(asAgentError(new Error('boom'), 'fatal').severity === 'fatal', 'asAgentError → 普通 Error 用 defaultSeverity')
    assert(asAgentError(new Error('boom'), 'fatal').message === 'boom', 'asAgentError → 提取 Error.message')
    assert(asAgentError({ severity: 'recoverable', message: 'x' }, 'fatal').severity === 'recoverable', 'asAgentError → 已是 AgentError 不覆盖')
    assert(asAgentError('string err', 'observable').message === 'string err', 'asAgentError → 非 Error 字符串归一化')
    assert(asAgentError(undefined, 'observable').severity === 'observable', 'asAgentError → undefined 用 defaultSeverity')
    assert(asAgentError(new Error('x')).severity === 'fatal', 'asAgentError → 不传 defaultSeverity 默认 fatal')
  }

  // ============ capabilities 注册表 + resolveCapabilities(p2-refactor 子项 4)============
  console.log('\n[capabilities: resolveCapabilities 单一解析]')
  {
    // 未传 caps:全用默认(opt-out 开 / opt-in 关)
    const dft = resolveCapabilities(undefined)
    assert(dft.dataOps === true, 'resolveCapabilities → 未传 dataOps(opt-out)默认开')
    assert(dft.planning === true, 'resolveCapabilities → 未传 planning(opt-out)默认开')
    assert(dft.inspectEnv === true, 'resolveCapabilities → 未传 inspectEnv(opt-out)默认开')
    assert(dft.verify === false, 'resolveCapabilities → 未传 verify(opt-in)默认关')
    assert(dft.domInspect === false, 'resolveCapabilities → 未传 domInspect(opt-in)默认关')
    assert(dft.tracing === false, 'resolveCapabilities → 未传 tracing(opt-in)默认关')
    assert(dft.automation === false, 'resolveCapabilities → 未传 automation(opt-in)默认关')
    // opt-out 显式 false → 关
    const off = resolveCapabilities({ dataOps: false, planning: false })
    assert(off.dataOps === false, 'resolveCapabilities → dataOps:false 显式关(opt-out)')
    assert(off.planning === false, 'resolveCapabilities → planning:false 显式关(opt-out)')
    assert(off.fetch === true, 'resolveCapabilities → 未传 fetch(opt-out)仍开')
    // opt-in 显式 true → 开
    const on = resolveCapabilities({ verify: true, tracing: true, automation: true })
    assert(on.verify === true, 'resolveCapabilities → verify:true 显式开(opt-in)')
    assert(on.tracing === true, 'resolveCapabilities → tracing:true 显式开(opt-in)')
    assert(on.automation === true, 'resolveCapabilities → automation:true 显式开(opt-in)')
    assert(on.dataOps === true, 'resolveCapabilities → opt-in 开时 opt-out 未传仍开')
    // requires:draftWrite 需 dataOps+vfs,任一关 → draftWrite 强制关(防"开 draft 但关 dataOps"无意义组合)
    const dr1 = resolveCapabilities({ draftWrite: true })
    assert(dr1.draftWrite === true, 'resolveCapabilities → draftWrite:true + dataOps/vfs 默认开 → 开(requires 满足)')
    const dr2 = resolveCapabilities({ draftWrite: true, dataOps: false })
    assert(dr2.draftWrite === false, 'resolveCapabilities → draftWrite:true 但 dataOps:false → 强制关(requires 未满足)')
    const dr3 = resolveCapabilities({ draftWrite: true, vfs: false })
    assert(dr3.draftWrite === false, 'resolveCapabilities → draftWrite:true 但 vfs:false → 强制关(requires 未满足)')
    // CAPABILITIES 注册表完整(20 开关;13 opt-out + 7 opt-in,skillHostScript opt-in / focus opt-out 新增)
    assert(CAPABILITIES.length === 20, 'CAPABILITIES 注册表 → 20 开关')
    assert(CAPABILITIES.filter((c) => c.defaultOn).length === 13, 'CAPABILITIES → 13 opt-out(默认开)')
    assert(CAPABILITIES.filter((c) => !c.defaultOn).length === 7, 'CAPABILITIES → 7 opt-in(默认关)')
    // skillHostScript opt-in 默认关 + requires skills
    const shs = CAPABILITIES.find((c) => c.name === 'skillHostScript')!
    assert(!!shs && shs.defaultOn === false && shs.requires?.includes('skills'), '✓ skillHostScript:opt-in 默认关 + requires skills')
    // 全量解析后每个 capability 都有明确 boolean(无 undefined)
    const all = resolveCapabilities({ dataOps: false, verify: true, domInspect: true, tracing: true, automation: true, todoDeps: true })
    for (const c of CAPABILITIES) {
      assert(typeof all[c.name] === 'boolean', `resolveCapabilities → ${c.name} 解析为 boolean(非 undefined)`)
    }
  }
}
