import { z } from 'zod'
import { createWindowOps } from '../../tools/windowOps'
import { fetchDocTools } from '../../tools/fetchDoc'
import { selectBuiltinTools, fetchTools, defineWindowToolset } from '../../toolsets'
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
import { jpEval, searchJson } from '../../tools/windowQuery'
import { createAgent, trimContextIfNeededImpl } from '../../harness/createAgent'
import { trimMemoryMessagesImpl } from '../../utils/rounds'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// humanConfirm 中间件(LLM 主动征询:request_human_confirmation)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[humanConfirm 中间件]')
  {
    const tool = createHumanConfirmTool()
    assert(tool.name === HUMAN_CONFIRM_TOOL_NAME, '工具 name=request_human_confirmation')
    assert(/不确定|多种|高风险/.test(tool.description), '工具描述含触发场景(不确定/多方案/高风险)')

    const mw = createHumanConfirmMiddleware()
    assert(mw.name === 'humanConfirm', '中间件 name=humanConfirm')

    let captured: any = null
    const mkCtx = (name: string, args: any, signal?: AbortSignal): any => ({
      name, args, signal, emit: (e: any) => { captured = e },
    })

    // 1. 非 humanConfirm 工具 → 放行 next
    captured = null
    let hit = false
    await mw.wrapToolCall!(mkCtx('get_window_prop', {}), async () => { hit = true; return { content: 'ok', status: 'done' } })
    assert(hit && !captured, '非 humanConfirm 工具 → 放行不发事件')

    // 2. resolve(true) → 同意
    captured = null
    let p = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '改红色还是蓝色?', recommendation: '红色' }), async () => ({ content: 'x', status: 'done' }))
    assert(captured?.type === 'approval_request' && captured.args?.question === '改红色还是蓝色?', 'humanConfirm → 发 approval_request(带 question)')
    captured.resolve(true)
    let r = await p
    assert(/用户同意了方案\(红色\)/.test(r.content), 'resolve(true) → 返回同意(含推荐)')

    // 3. resolve(false) → 拒绝
    captured = null
    let p2 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '删掉?' }), async () => ({ content: 'x', status: 'done' }))
    captured.resolve(false)
    let r2 = await p2
    assert(/用户拒绝/.test(r2.content), 'resolve(false) → 返回拒绝')

    // 4. resolve(string) → 选方案
    captured = null
    let p3 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '选方案', options: ['A', 'B'] }), async () => ({ content: 'x', status: 'done' }))
    captured.resolve('B')
    let r3 = await p3
    assert(/用户选择了:B/.test(r3.content), 'resolve(string) → 返回所选方案')

    // 5. abort 联动:进入时已 abort → 拒绝
    const ac = new AbortController(); ac.abort()
    captured = null
    let p4 = mw.wrapToolCall!(mkCtx(HUMAN_CONFIRM_TOOL_NAME, { question: 'x' }, ac.signal), async () => ({ content: 'x', status: 'done' }))
    let r4 = await p4
    assert(/用户拒绝/.test(r4.content), 'signal 已 abort → 自动拒绝')
  }
}
