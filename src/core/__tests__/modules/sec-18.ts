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

import type { TestCtx } from './_ctx'

// createWriteBackCheck(写后读回验证,单主对象)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[createWriteBackCheck]')
  {
    // 单对象:整体 schema 挂 '' 键;写操作用 jsonPath 定位子路径
    const schemas = { '': z.object({ theme: z.enum(['light', 'dark']), count: z.number().int() }) }
    const mkAi = (toolCalls: any[]) => ({ tool_calls: toolCalls, content: '' }) as any

    // 1. 无写操作 → ok
    let bind: any = { theme: 'dark', count: 0 }
    let check = createWriteBackCheck({ window: bind, schemas })
    let r = await check({ messages: [mkAi([])], state: createState() })
    assert(r.ok === true, '本轮无写操作 → ok 放行')

    // 2. edit 后读回符合 schema → ok
    bind = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    assert(r.ok === true, 'edit 后读回符合 schema → ok')

    // 3. edit 后读回为空 → feedback(未生效)
    bind = { theme: undefined, count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    const fb3 = r.feedback
    assert(r.ok === false && !!fb3 && /读回为空/.test(fb3), 'edit 后读回为空 → feedback(未生效)')

    // 4. edit 后读回不符合 schema → feedback(theme='red' 不在 enum,整体 schema 校验失败)
    bind = { theme: 'red', count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    const fb4 = r.feedback
    assert(r.ok === false && !!fb4 && /不符合 schema/.test(fb4), 'edit 后读回不符合 schema → feedback')

    // 5. delete 后读回 undefined → ok(删除成功)
    bind = { theme: undefined, count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'delete_data', args: { jsonPath: 'theme' } }])], state: createState() })
    assert(r.ok === true, 'delete 后读回空 → ok(删除成功)')

    // 6. delete 后读回仍有值 → feedback(未删干净)
    bind = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'delete_data', args: { jsonPath: 'theme' } }])], state: createState() })
    const fb6 = r.feedback
    assert(r.ok === false && !!fb6 && /删除后读回仍有值/.test(fb6), 'delete 后读回仍有值 → feedback(未删干净)')

    // 7. set_data 整体写后读回符合 schema → ok
    bind = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({ messages: [mkAi([{ name: 'set_data', args: {} }])], state: createState() })
    assert(r.ok === true, 'set 整体写后读回符合 schema → ok')

    // 8. 写被合法拒绝(ToolMessage "校验失败")→ 不误报(ok)
    const mkTool = (callId: string, content: string) => ({ tool_call_id: callId, content }) as any
    bind = { theme: undefined, count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({
      messages: [
        mkAi([{ id: 'c1', name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }]),
        mkTool('c1', '校验失败:值不符合 enum'),
        mkAi([]),
      ],
      state: createState(),
    })
    assert(r.ok === true, '写被合法拒绝(校验失败)→ 不误报"未生效"')

    // 9. edit 在更早轮、最近一轮是 get → 仍验证该 edit(扫描所有写,非仅最近一轮)
    bind = { theme: undefined, count: 0 }
    check = createWriteBackCheck({ window: bind, schemas })
    r = await check({
      messages: [
        mkAi([{ id: 'c1', name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }]),
        mkTool('c1', '已 edit theme = "dark"'),
        mkAi([{ id: 'c2', name: 'get_data', args: { jsonPath: 'count' } }]),
        mkTool('c2', '0'),
        mkAi([]),
      ],
      state: createState(),
    })
    const fb9 = r.feedback
    assert(r.ok === false && !!fb9 && /读回为空/.test(fb9), 'edit 在更早轮、最近是 get → 仍验证该 edit')

    // 10. root 选项优先于 window:单对象 data 模式 bind 不挂 window,经 root 读回
    let bind2: any = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ root: bind2, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    assert(r.ok === true, 'root 选项优先于 window:edit 后读回符合 schema → ok')

    // 11. root getter:适配 sdk.setData 运行时替换 bind(每次 check 取最新)
    let liveBind: any = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ root: () => liveBind, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    assert(r.ok === true, 'root getter:edit 后读回符合 schema → ok')
    // 替换 bind 后,旧 bind 的写不在新 bind 上 → 读回为空 → feedback(验证 getter 取的是最新 bind)
    liveBind = { theme: undefined, count: 0 }
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    const fb11 = r.feedback
    assert(r.ok === false && !!fb11 && /读回为空/.test(fb11), 'root getter 替换 bind 后:旧写在新 bind 上读回为空 → feedback')

    // 12. root 省略 → 回退 window(旧 windowProps 模式向后兼容)
    const w: any = { theme: 'dark', count: 0 }
    check = createWriteBackCheck({ window: w, schemas })
    r = await check({ messages: [mkAi([{ name: 'edit_data', args: { jsonPath: 'theme', op: 'set' } }])], state: createState() })
    assert(r.ok === true, 'root 省略 → 回退 window(向后兼容)')
  }
}
