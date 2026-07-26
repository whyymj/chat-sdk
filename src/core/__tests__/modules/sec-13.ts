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

// beforeReturn 自纠钩子(runBeforeReturn 执行器:agent 返回前拦截自纠)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[beforeReturn 自纠钩子]')
  {
    // stream 自纠循环本身依赖 LLM,按惯例手动验证(同 subagent/mcp);此处覆盖纯函数 runBeforeReturn 的拼接逻辑(= 自纠触发条件)
    const state = createState()
    assert(state.verifyAttempts === 0, 'createInitialState 初始化 verifyAttempts=0(自纠计数起点)')

    const ctx = { messages: [], state, response: { message: {}, toolCalls: [], content: 'r' } } as any

    let fb = await runBeforeReturn(
      [
        { name: 'a', beforeReturn: () => null },
        { name: 'b', beforeReturn: () => null },
      ],
      ctx,
    )
    assert(fb === null, '所有钩子返回 null → 放行 return(不自纠)')

    fb = await runBeforeReturn(
      [
        { name: 'a', beforeReturn: () => '问题1' },
        { name: 'b', beforeReturn: () => '问题2' },
      ],
      ctx,
    )
    assert(fb === '问题1\n\n问题2', '多个 feedback 正序拼接(任一非 null 即触发自纠)')

    fb = await runBeforeReturn(
      [
        { name: 'a', beforeReturn: () => null },
        { name: 'b', beforeReturn: () => '问题2' },
      ],
      ctx,
    )
    assert(fb === '问题2', '跳过 null 钩子,只拼接非 null feedback')

    fb = await runBeforeReturn([{ name: 'a' }, { name: 'b' }], ctx)
    assert(fb === null, '中间件无 beforeReturn 钩子 → 放行 return')

    fb = await runBeforeReturn([{ name: 'a', beforeReturn: async () => '异步问题' }], ctx)
    assert(fb === '异步问题', '支持异步 beforeReturn 钩子')
  }
}
