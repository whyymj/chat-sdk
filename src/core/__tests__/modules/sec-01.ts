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

// dataSlotOps
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[dataSlotOps]')
  {
    const tools = createDataSlotOps([
      { path: 'app.theme', description: '主题', schema: z.enum(['light', 'dark']) },
      { path: 'app.count', description: '计数', schema: z.number().int().min(0) },
    ])
    const t = byName(tools)
    const w = (globalThis as any).window

    let r = await invoke(t['set_data_slot'], { path: 'app.theme', value: '"dark"' })
    assert(w.app.theme === 'dark' && /已设置/.test(r), 'set 合法值生效 + 返回成功')

    r = await invoke(t['set_data_slot'], { path: 'app.theme', value: '"red"' })
    assert(/SCHEMA_INVALID/.test(r) && w.app.theme === 'dark', 'set 非法值被 schema 校验拦截(不写入,返回结构化错误码)')

    r = await invoke(t['set_data_slot'], { path: 'app.unknown', value: '1' })
    assert(/未在注册表中声明/.test(r), 'set 未注册属性被范围控制拒绝')

    // 字段白名单读模式(默认 true):仅注册 path 自身/后代可读,祖先(app)不可读
    r = await invoke(t['get_data_slot'], { path: 'app' })
    assert(/未注册|不可读|不暴露/.test(r), 'whitelist 默认:get 祖先路径(app)被拒(不暴露整体)')

    r = await invoke(t['get_data_slot'], { path: 'app.theme' })
    assert(/dark/.test(r), 'get 注册属性返回值')

    r = await invoke(t['get_data_slot'], { path: 'foo' })
    assert(/未注册/.test(r), 'get 未注册非祖先路径被拒')

    r = await invoke(t['list_data_slots'], {})
    assert(/app\.theme/.test(r) && /app\.count/.test(r), 'list 列出全部注册属性')

    r = await invoke(t['set_data_slot'], { path: 'app.count', value: '5' })
    assert(w.app.count === 5, 'set count(integer)生效')

    r = await invoke(t['delete_data_slot'], { path: 'app.count' })
    assert(!('count' in w.app), 'delete 注册属性生效')

    r = await invoke(t['set_data_slot'], { path: 'app.count', value: '"not a number"' })
    assert(/SCHEMA_INVALID/.test(r), 'set 类型不符被校验拦截(结构化错误码)')
  }
}
