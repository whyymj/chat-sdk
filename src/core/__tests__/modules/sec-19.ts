import { z } from 'zod'
import { createDataSlotOps } from '../../tools/dataSlotOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataSlotToolset } from '../../toolsets'
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

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// 对抗式验证(isAdversarialClean verdict 判定)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[adversarial verdict 判定]')
  {
    // runAdversarial 整体依赖 LLM(createAgent + invoke),按惯例手动验证;此处测 verdict 判定纯函数
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

    // defineDataSlotToolset 工厂(依赖 dataSlots,故为工厂)
    const props = [{ path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) }]
    const wt = defineDataSlotToolset(props)
    assert(wt.length === 13 && wt[0].name === 'list_data_slots', 'defineDataSlotToolset 工厂产出 13 个 数据槽工具(10 原有 + query/search/eval)')

    // selectBuiltinTools:默认全装(dataSlotOps + fetch)
    const winOps = createDataSlotOps(props)
    const all = selectBuiltinTools(undefined, winOps, fetchDocTools)
    assert(all.length === winOps.length + fetchDocTools.length, 'selectBuiltinTools 默认全装(dataSlotOps + fetch)')

    // dataSlotOps:false → 不含 数据槽工具,fetch 仍在
    const noWin = selectBuiltinTools({ dataSlotOps: false }, winOps, fetchDocTools)
    assert(noWin.length === fetchDocTools.length && noWin.every((t) => t.name === 'fetch_document'), 'dataSlotOps:false → 只剩 fetch_document')

    // fetch:false → 不含 fetch,window 仍在
    const noFetch = selectBuiltinTools({ fetch: false }, winOps, fetchDocTools)
    assert(noFetch.length === winOps.length && noFetch.every((t) => t.name !== 'fetch_document'), 'fetch:false → 只剩 数据槽工具')

    // 两者都关 → 空
    const none = selectBuiltinTools({ dataSlotOps: false, fetch: false }, winOps, fetchDocTools)
    assert(none.length === 0, 'dataSlotOps + fetch 都关 → 工具池空')
  }

  // ============ usageHints 中间件(能力用法默认提示,克制注入)============
  console.log('\n[usageHints middleware]')
  {
    // 全开 → 含 planning/snapshot/spawn 三条提示
    const mwFull = createUsageHintsMiddleware({ planning: true, subagent: true }, true)
    const segFull = mwFull.augmentPrompt?.(createState()) || ''
    assert(/write_todos/.test(segFull) && /restore_data_snapshot/.test(segFull) && /spawn_agent/.test(segFull), '能力全开 → 注入 planning/snapshot/spawn 用法')
    // dataSlotOps 开 → 含 list/describe(查当前可操作属性)与 get(读真实值再改)提示
    assert(/list_data_slots/.test(segFull) && /describe_data_slot/.test(segFull), 'dataSlotOps 开 → 注入 list/describe 用法(动态注册场景关键)')
    assert(/get_data_slot/.test(segFull), 'dataSlotOps 开 → 注入 get 读真实值再改用法')

    // planning 关 → 无 write_todos 提示
    const mwNoPlan = createUsageHintsMiddleware({ planning: false, subagent: true }, true)
    const segNoPlan = mwNoPlan.augmentPrompt?.(createState()) || ''
    assert(!/write_todos/.test(segNoPlan), 'planning 关 → 不注入 write_todos 提示')

    // hasDataSlotOps=false → 无 snapshot 提示
    const mwNoWin = createUsageHintsMiddleware({ planning: true, subagent: true }, false)
    const segNoWin = mwNoWin.augmentPrompt?.(createState()) || ''
    assert(!/restore_data_snapshot/.test(segNoWin), '无 数据槽工具 → 不注入 snapshot 提示')

    // 全关(planning/subagent 关 + 无 window)→ undefined(不增上下文)
    const mwNone = createUsageHintsMiddleware({ planning: false, subagent: false }, false)
    assert(mwNone.augmentPrompt?.(createState()) === undefined, '全关 → augmentPrompt 返回 undefined(不增上下文)')

    assert(mwFull.name === 'usageHints', '中间件 name=usageHints')
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
