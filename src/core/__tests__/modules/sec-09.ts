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

// retry(模型调用重试 + abort 判定)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[retry]')
  {
    // isAbort
    assert(isAbort({ name: 'AbortError' }) === true, 'isAbort: name===AbortError 命中')
    assert(isAbort(new Error('net')) === false, 'isAbort: 普通 Error 非 abort')
    const ac = new AbortController()
    assert(isAbort(new Error('x'), ac.signal) === false, 'isAbort: 未 aborted 的 signal 不算')
    ac.abort()
    assert(isAbort(new Error('x'), ac.signal) === true, 'isAbort: signal.aborted 命中')

    // isRetryable(必须先排除 abort 再判 status)
    assert(isRetryable({}) === true, 'isRetryable: 网络错误(status undefined)可重试')
    assert(isRetryable({ name: 'TimeoutError' }) === true, 'isRetryable: 超时可重试')
    assert(isRetryable({ status: 429 }) === true, 'isRetryable: 429 可重试')
    assert(isRetryable({ lc_error_code: 'MODEL_RATE_LIMIT' }) === true, 'isRetryable: MODEL_RATE_LIMIT 可重试')
    assert(isRetryable({ status: 500 }) === true, 'isRetryable: 500 可重试')
    assert(isRetryable({ status: 503 }) === true, 'isRetryable: 503 可重试')
    assert(isRetryable({ status: 400 }) === false, 'isRetryable: 400 不重试(参数错误)')
    assert(isRetryable({ status: 401 }) === false, 'isRetryable: 401 不重试(鉴权)')
    assert(isRetryable({ status: 404 }) === false, 'isRetryable: 404 不重试')
    assert(isRetryable({ name: 'AbortError' }) === false, 'isRetryable: AbortError 不重试(即使 status undefined)')
    assert(isRetryable(null) === false, 'isRetryable: null 不重试')

    // withRetry(baseDelayMs:0 避免真实退避等待)
    const r1 = await withRetry(() => Promise.resolve('ok'), { baseDelayMs: 0 })
    assert(r1 === 'ok', 'withRetry: 首次成功直接返回')

    let calls = 0
    const r2 = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw Object.assign(new Error('net'), { status: undefined })
        return 'recovered'
      },
      { baseDelayMs: 0 },
    )
    assert(r2 === 'recovered' && calls === 3, 'withRetry: 网络错误重试 2 次后第 3 次成功')

    // 4xx 不可重试:立即抛,只调 1 次
    let calls4xx = 0
    let threw4xx = false
    try {
      await withRetry(async () => {
        calls4xx++
        throw Object.assign(new Error('bad'), { status: 400 })
      }, { baseDelayMs: 0 })
    } catch (e: any) {
      threw4xx = e.status === 400
    }
    assert(threw4xx && calls4xx === 1, 'withRetry: 4xx 不重试,立即抛')

    // AbortError 不重试:立即抛,只调 1 次
    let callsAbort = 0
    let threwAbort = false
    try {
      await withRetry(async () => {
        callsAbort++
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }, { baseDelayMs: 0 })
    } catch (e: any) {
      threwAbort = e.name === 'AbortError'
    }
    assert(threwAbort && callsAbort === 1, 'withRetry: AbortError 不重试,立即抛')

    // 达到 maxRetries 仍失败:抛错,maxRetries+1 次尝试
    let callsMax = 0
    let threwMax = false
    try {
      await withRetry(async () => {
        callsMax++
        throw new Error('net')
      }, { maxRetries: 2, baseDelayMs: 0 })
    } catch (e: any) {
      threwMax = /net/.test(e.message)
    }
    assert(threwMax && callsMax === 3, 'withRetry: 达上限抛错(maxRetries=2 → 3 次尝试)')

    // 退避回调被触发(验证 onRetry 调用次数 = 重试次数)
    let retryNotified = 0
    try {
      await withRetry(
        async () => {
          throw Object.assign(new Error('net'), { status: undefined })
        },
        { maxRetries: 2, baseDelayMs: 0, onRetry: () => retryNotified++ },
      )
    } catch {
      /* 预期抛错 */
    }
    assert(retryNotified === 2, 'withRetry: onRetry 回调在每次重试前触发(2 次)')
  }
}
