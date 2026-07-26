import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
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

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// approval 中间件(人工确认:wrapToolCall 拦截 → approval_request → resolve)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[approval 中间件]')
  {
    const mw = createApprovalMiddleware({ tools: ['set_data'] })
    assert(mw.name === 'approval', '中间件 name=approval')

    let captured: any = null
    const mkCtx = (name: string, args: any, signal?: AbortSignal): any => ({
      name,
      args,
      signal,
      emit: (e: any) => { captured = e },
    })

    // 1. 不需确认的工具 → 直接 next,不发事件
    let nextCalled = false
    await mw.wrapToolCall!(mkCtx('get_data', { path: 'a' }), async () => { nextCalled = true; return { content: 'ok', status: 'done' } })
    assert(nextCalled && !captured, '非确认工具 → 放行 next,不发 approval_request')

    // 2. 需确认 → 发 approval_request,resolve(true) → 执行 next
    captured = null
    let execResult = { content: 'written', status: 'done' as const }
    let p = mw.wrapToolCall!(mkCtx('set_data', { path: 'a', value: 1 }), async () => execResult)
    assert(captured?.type === 'approval_request' && captured.toolName === 'set_data', '确认工具 → 发 approval_request 事件')
    captured.resolve(true)
    let r = await p
    assert(r.content === 'written' && r.status === 'done', 'resolve(true) → 执行工具,返回真实结果')

    // 3. resolve(false) → 返回 error(不执行 next)
    captured = null
    let denied = false
    let p2 = mw.wrapToolCall!(mkCtx('set_data', { path: 'b', value: 2 }), async () => { denied = true; return { content: 'x', status: 'done' } })
    captured.resolve(false)
    let r2 = await p2
    assert(r2.status === 'error' && !denied, 'resolve(false) → 返回 error 且不执行工具')

    // 4. abort 联动:signal 已 aborted → 自动拒绝
    const ac = new AbortController(); ac.abort()
    captured = null
    let p3 = mw.wrapToolCall!(mkCtx('set_data', { path: 'c' }, ac.signal), async () => ({ content: 'x', status: 'done' }))
    let r3 = await p3
    assert(r3.status === 'error', 'signal 已 abort → 自动拒绝')

    // 5. 超时自动拒绝
    const mwT = createApprovalMiddleware({ tools: ['set_data'], timeoutMs: 30 })
    captured = null
    let p4 = mwT.wrapToolCall!(mkCtx('set_data', { path: 'd' }), async () => ({ content: 'x', status: 'done' }))
    let r4 = await p4
    assert(r4.status === 'error', 'timeoutMs 超时 → 自动拒绝')

    // 6. confirm 自定义判定(优先于 tools)
    const mwC = createApprovalMiddleware({ tools: ['set_data'], confirm: (n) => n === 'edit_data' })
    captured = null
    await mwC.wrapToolCall!(mkCtx('set_data', { path: 'e' }), async () => ({ content: 'ok', status: 'done' }))
    assert(!captured, 'confirm 优先于 tools:set_data 不在 confirm 命中 → 放行不发事件')
    captured = null
    let p5 = mwC.wrapToolCall!(mkCtx('edit_data', { path: 'f' }), async () => ({ content: 'ok', status: 'done' }))
    assert(captured?.type === 'approval_request', 'confirm 命中 edit_data → 发确认事件')
    captured.resolve(true)
    assert((await p5).content === 'ok', 'confirm 命中后 resolve(true) → 执行')

    // 7. 不传 tools/confirm → 所有工具都确认
    const mwAll = createApprovalMiddleware({})
    captured = null
    let p6 = mwAll.wrapToolCall!(mkCtx('any_tool', {}), async () => ({ content: 'ok', status: 'done' }))
    assert(captured?.type === 'approval_request', '无 tools/confirm → 所有工具都确认')
    captured.resolve(true)
    await p6

    // 8. tools 空数组 → 不确认任何工具(放行)
    const mwEmpty = createApprovalMiddleware({ tools: [] })
    captured = null
    let nextHit = false
    await mwEmpty.wrapToolCall!(mkCtx('any_tool', {}), async () => { nextHit = true; return { content: 'ok', status: 'done' } })
    assert(!captured && nextHit, 'tools 空数组 → 不确认任何工具,直接放行')
  }
}
