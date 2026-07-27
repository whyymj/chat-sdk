import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineDataToolset } from '../../toolsets'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'
import { createTodosMiddleware } from '../../harness/todos'
import { createSkillsMiddleware, defineSkill, resolveDocKind, normalizeVfsPath, readSkillDoc, type SkillsController } from '../../harness/skills'
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

// skills 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[skills middleware]')
  {
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'demo', description: '演示', getContent: () => 'SKILL FULL CONTENT' }),
    ])
    const seg = mw.augmentPrompt?.(createState())
    assert(seg?.includes('demo') && /Skills/.test(seg || ''), 'skills 索引注入 system prompt')

    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'demo' })
    assert(/SKILL FULL CONTENT/.test(r), 'load_skill 返回全文')

    r = await invoke(ls, { name: 'demo' })
    assert(/已在本轮加载|无需重复/.test(r), 'load_skill 重复加载被防')

    r = await invoke(ls, { name: 'nope' })
    assert(/未找到/.test(r), 'load_skill 未知名报错')
  }

  console.log('\n[skills middleware 全文缓存 + 跨轮重新 load]')
  {
    // 用计数器验证 getContent 只调一次(缓存命中后不再调)
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'cached', description: '缓存测试', getContent: () => { getContentCalls++; return 'CACHED CONTENT ' + getContentCalls } }),
    ])
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    // 首次 load → getContent 调一次,返回内容含计数 1
    let r = await invoke(ls, { name: 'cached' })
    assert(getContentCalls === 1 && /CACHED CONTENT 1/.test(r), '首次 load_skill → getContent 调一次,返回首次内容')
    // 同轮再 load → 被拦截(loaded Set)
    r = await invoke(ls, { name: 'cached' })
    assert(/已在本轮加载|无需重复/.test(r) && getContentCalls === 1, '同轮再 load → 被 loaded 拦截,getContent 不再调')
    // 模拟跨轮:beforeAgent 清 loaded Set,允许重新 load,但用缓存(getContent 不再调)
    ;(mw as any).beforeAgent?.(createState())
    r = await invoke(ls, { name: 'cached' })
    assert(/CACHED CONTENT 1/.test(r) && getContentCalls === 1, '跨轮 beforeAgent 清 loaded → 允许重新 load,但用缓存(getContent 不再调,返回首次内容)')
  }

  console.log('\n[skills controller.set/invalidateCache → 动态替换同名 skill]')
  {
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'dyn', description: 'v1', getContent: () => { getContentCalls++; return 'V1 ' + getContentCalls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    assert(ctrl && typeof ctrl.set === 'function' && typeof ctrl.get === 'function' && typeof ctrl.invalidateCache === 'function', 'controller 暴露 set/get/invalidateCache')
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v1', 'controller.get 返回初始 skill')
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'dyn' })
    assert(/V1 1/.test(r) && getContentCalls === 1, '首次 load v1 → getContent 调一次')
    // 同名 skill 替换为 v2(getContent 返回不同内容)
    let v2Calls = 0
    ctrl.set([defineSkill({ name: 'dyn', description: 'v2', getContent: () => { v2Calls++; return 'V2 ' + v2Calls } })])
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v2', 'controller.set → get 返回 v2')
    // set 已清 contentCache + loaded,直接 load 取 v2 全文
    r = await invoke(ls, { name: 'dyn' })
    assert(/V2 1/.test(r) && v2Calls === 1, 'setSkills 同名替换 → 清缓存,下次 load 取 v2 全文(getContent 重新调一次)')
    // augmentPrompt 反映新 skill 索引
    const idx = (mw as any).augmentPrompt?.() as string
    assert(/v2/.test(idx) && !/v1/.test(idx), 'augmentPrompt 反映 setSkills 后的 v2 索引')
  }

  console.log('\n[skills controller.invalidateCache → 指定/全部清缓存]')
  {
    let c1Calls = 0, c2Calls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'a', description: 'A', getContent: () => { c1Calls++; return 'A' + c1Calls } }),
      defineSkill({ name: 'b', description: 'B', getContent: () => { c2Calls++; return 'B' + c2Calls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    await invoke(ls, { name: 'a' })
    await invoke(ls, { name: 'b' })
    assert(c1Calls === 1 && c2Calls === 1, '两个 skill 各 load 一次,getContent 各调一次')
    ;(mw as any).beforeAgent?.(createState())  // 清 loaded 允许重 load
    // 仅清 a 的缓存
    ctrl.invalidateCache('a')
    let r = await invoke(ls, { name: 'a' })
    assert(/A2/.test(r) && c1Calls === 2, 'invalidateCache(a) → a 重新 getContent,b 仍用缓存')
    r = await invoke(ls, { name: 'b' })
    ;(mw as any).beforeAgent?.(createState())
    assert(/B1/.test(r) && c2Calls === 1, 'b 仍命中缓存(getContent 不再调)')
    // 全清
    ctrl.invalidateCache()
    ;(mw as any).beforeAgent?.(createState())
    await invoke(ls, { name: 'a' })
    r = await invoke(ls, { name: 'b' })
    assert(/B2/.test(r) && c1Calls === 3 && c2Calls === 2, 'invalidateCache() 全清 → a/b 都重新 getContent(a=3 次,b=2 次)')
  }
}
