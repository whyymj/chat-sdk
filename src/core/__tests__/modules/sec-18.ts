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

// createWriteBackCheck(写后读回验证)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[createWriteBackCheck]')
  {
    const schemas = { 'app.theme': z.enum(['light', 'dark']), 'app.count': z.number().int() }
    const mkAi = (toolCalls: any[]) => ({ tool_calls: toolCalls, content: '' }) as any

    // 1. 无写操作 → ok
    let win: any = { app: { theme: 'dark', count: 0 } }
    let check = createWriteBackCheck({ window: win, schemas })
    let r = await check({ messages: [mkAi([])], state: createState() })
    assert(r.ok === true, '本轮无写操作 → ok 放行')

    // 2. set 后读回符合 schema → ok
    win = { app: { theme: 'dark', count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'set_data_slot', args: { path: 'app.theme' } }])], state: createState() })
    assert(r.ok === true, 'set 后读回符合 schema → ok')

    // 3. set 后读回为空 → feedback(未生效)
    win = { app: { theme: undefined, count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'set_data_slot', args: { path: 'app.theme' } }])], state: createState() })
    const fb3 = r.feedback
    assert(r.ok === false && !!fb3 && /读回为空/.test(fb3), 'set 后读回为空 → feedback(未生效)')

    // 4. set 后读回不符合 schema → feedback
    win = { app: { theme: 'red', count: 0 } } // 'red' 不在 enum
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'set_data_slot', args: { path: 'app.theme' } }])], state: createState() })
    const fb4 = r.feedback
    assert(r.ok === false && !!fb4 && /不符合 schema/.test(fb4), 'set 后读回不符合 schema → feedback')

    // 5. delete 后读回 undefined → ok(删除成功)
    win = { app: { theme: undefined, count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'delete_data_slot', args: { path: 'app.theme' } }])], state: createState() })
    assert(r.ok === true, 'delete 后读回空 → ok(删除成功)')

    // 6. delete 后读回仍有值 → feedback(未删干净)
    win = { app: { theme: 'dark', count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'delete_data_slot', args: { path: 'app.theme' } }])], state: createState() })
    const fb6 = r.feedback
    assert(r.ok === false && !!fb6 && /删除后读回仍有值/.test(fb6), 'delete 后读回仍有值 → feedback(未删干净)')

    // 7. edit_data_slot 后读回符合 schema → ok
    win = { app: { theme: 'dark', count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data_slot', args: { path: 'app.theme', jsonPath: '', op: 'set' } }])], state: createState() })
    assert(r.ok === true, 'edit 后读回符合 schema → ok')

    // 8. 写被合法拒绝(ToolMessage "校验失败")→ 不误报(ok)
    const mkTool = (callId: string, content: string) => ({ tool_call_id: callId, content }) as any
    win = { app: { theme: undefined, count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({
      messages: [
        mkAi([{ id: 'c1', name: 'set_data_slot', args: { path: 'app.theme' } }]),
        mkTool('c1', '校验失败:值不符合 enum'),
        mkAi([]),
      ],
      state: createState(),
    })
    assert(r.ok === true, '写被合法拒绝(校验失败)→ 不误报"未生效"')

    // 9. set 在更早轮、最近一轮是 get → 仍验证该 set(扫描所有写,非仅最近一轮)
    win = { app: { theme: undefined, count: 0 } }
    check = createWriteBackCheck({ window: win, schemas })
    r = await check({
      messages: [
        mkAi([{ id: 'c1', name: 'set_data_slot', args: { path: 'app.theme' } }]),
        mkTool('c1', '已设置 app.theme = "dark"'),
        mkAi([{ id: 'c2', name: 'get_data_slot', args: { path: 'app.count' } }]),
        mkTool('c2', '0'),
        mkAi([]),
      ],
      state: createState(),
    })
    const fb9 = r.feedback
    assert(r.ok === false && !!fb9 && /读回为空/.test(fb9), 'set 在更早轮、最近是 get → 仍验证该 set')
  }
}
