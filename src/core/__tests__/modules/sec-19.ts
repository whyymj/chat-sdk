import { z } from 'zod'
import { createDataOps, filterByToolMode } from '../../tools/dataOps'
import { extractSchemaHint } from '../../presets'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
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
    assert(wt.length === 13 && wt[0].name === 'describe_data', 'defineDataToolset 工厂产出 13 个数据工具(11 基础 + read/write 高层入口)')

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
    // advanced 模式 → 保留底层 get/describe 提示
    const mwAdv = createUsageHintsMiddleware({ planning: true, subagent: true }, true, 'advanced')
    const segAdv = mwAdv.augmentPrompt?.(createState()) || ''
    assert(/describe_data/.test(segAdv), 'dataOps 开 + advanced → 注入 describe 用法')
    assert(/get_data/.test(segAdv), 'dataOps 开 + advanced → 注入 get_data 读真实值再改用法')

    // planning 关 → 无 write_todos 提示
    const mwNoPlan = createUsageHintsMiddleware({ planning: false, subagent: true }, true)
    const segNoPlan = mwNoPlan.augmentPrompt?.(createState()) || ''
    assert(!/write_todos/.test(segNoPlan), 'planning 关 → 不注入 write_todos 提示')

    // hasDataOps=false → 无 snapshot 提示
    const mwNoData = createUsageHintsMiddleware({ planning: true, subagent: true }, false)
    const segNoData = mwNoData.augmentPrompt?.(createState()) || ''
    assert(!/restore_data/.test(segNoData), '无数据工具 → 不注入 snapshot 提示')

    // 全关 → undefined(不增上下文)
    const mwNone = createUsageHintsMiddleware({ planning: false, subagent: false }, false)
    assert(mwNone.augmentPrompt?.(createState()) === undefined, '全关 → augmentPrompt 返回 undefined(不增上下文)')

    assert(mwFull.name === 'usageHints', '中间件 name=usageHints')
  }

  // ============ filterByToolMode(工具呈现模式筛选)============
  console.log('\n[filterByToolMode]')
  {
    const config = { schema: z.any(), bind: { x: 1 } as any, description: 'd' }
    const all = createDataOps(config)  // 13 个工具
    const names = (ts: any[]) => ts.map((t) => t.name)
    // advanced → 全暴露(13)
    const adv = filterByToolMode(all, 'advanced')
    assert(adv.length === 13 && adv.length === all.length, 'advanced → 全暴露(13 工具)')
    // simple → 隐藏底层 describe/get/set/edit/delete(5),保留 read/write + query/search/eval/snapshot/list/restore(8)
    const simple = filterByToolMode(all, 'simple')
    const simpleNames = names(simple)
    assert(simple.length === 8, 'simple → 8 工具(隐藏 5 底层,保留 read/write + query/search/eval/snapshot/list/restore)')
    assert(['read', 'write', 'query_data', 'search_data', 'eval_script', 'snapshot_data', 'list_data_snapshots', 'restore_data'].every((n) => simpleNames.includes(n)), 'simple → 含 read/write + 高级查询/快照工具')
    assert(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data'].every((n) => !simpleNames.includes(n)), 'simple → 隐藏底层 describe/get/set/edit/delete')
    // minimal → 只 read/write
    const minimal = filterByToolMode(all, 'minimal')
    assert(minimal.length === 2 && names(minimal).includes('read') && names(minimal).includes('write'), 'minimal → 只 read/write')
    // 默认(不传 mode)= simple
    const def = filterByToolMode(all)
    assert(def.length === 8, '默认 toolMode = simple')
  }

  // ============ extractSchemaHint(io 契约注入 systemPrompt 用)============
  console.log('\n[extractSchemaHint]')
  {
    // zod object:提取字段名 + description
    const schema = z.object({ title: z.string().describe('页面标题'), count: z.number() })
    const hint = extractSchemaHint(schema)
    assert(/- title: 页面标题/.test(hint) && /- count/.test(hint), 'extractSchemaHint: object → 提取字段名 + description')
    // 无 description 的字段:只显示字段名(或 typeName)
    const schema2 = z.object({ name: z.string() })
    assert(/- name/.test(extractSchemaHint(schema2)), 'extractSchemaHint: 无 description → 仍含字段名')
    // 非 object schema:用 description 兜底
    const scalar = z.string().describe('一个字符串')
    assert(/一个字符串/.test(extractSchemaHint(scalar)), 'extractSchemaHint: 非 object → 用 description 兜底')
    // 无 description 的非 object:兜底提示
    assert(/read/.test(extractSchemaHint(z.string())), 'extractSchemaHint: 无 description 非 object → 兜底提示用 read')
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
}
