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

// subagent(子 agent 中间件结构 + wrapToolCall)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[subagent]')
  {
    const mw = createSubagentMiddleware({ llm: { apiKey: 'test' }, allTools: [] })
    assert(mw.name === 'subagent', 'subagent: 中间件 name=subagent')
    assert((mw.tools?.length ?? 0) === 2, 'subagent: 贡献 spawn_agent + spawn_agents 两个工具')
    const names = (mw.tools || []).map((t: any) => t.name)
    assert(names.includes('spawn_agent') && names.includes('spawn_agents'), 'subagent: 工具名为 spawn_agent / spawn_agents')
    assert(typeof mw.wrapToolCall === 'function', 'subagent: 有 wrapToolCall(捕获主 signal 供子 agent 继承)')

    // wrapToolCall 透传 next(不阻塞工具执行,且捕获 signal 不影响正常调用)
    const probe = { v: false }
    await mw.wrapToolCall!({ id: '1', name: 'x', args: {}, state: createState() }, async () => {
      probe.v = true
      return { content: 'ok', status: 'done' as const }
    })
    assert(probe.v, 'subagent: wrapToolCall 透传 next(不阻塞工具执行)')
  }
}
