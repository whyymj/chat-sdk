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

// dataOps:单主对象 基础(set/get/delete + schema 校验)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[dataOps]')
  {
    const appObj: any = { theme: 'light', count: 0 }
    const tools = createDataOps({
      schema: z.object({
        theme: z.enum(['light', 'dark']),
        count: z.number().int().min(0),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)

    // set_data 整体替换(合法)
    let r = await invoke(t['set_data'], { value: '{ "theme": "dark", "count": 3 }' })
    assert(appObj.theme === 'dark' && appObj.count === 3 && /已设置/.test(r), 'set_data 合法值生效 + 返回成功')

    // set_data 非法值被 schema 校验拦截(不写入)
    r = await invoke(t['set_data'], { value: '{ "theme": "red", "count": 1 }' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.theme === 'dark', 'set_data 非法值被 schema 校验拦截(不写入,返回结构化错误码)')

    // set_data 缺字段被校验拦截
    r = await invoke(t['set_data'], { value: '{ "theme": "dark" }' })
    assert(/SCHEMA_INVALID/.test(r), 'set_data 缺必填字段被校验拦截')

    // get_data 读整个主数据
    r = await invoke(t['get_data'], {})
    assert(/dark/.test(r) && /hash=/.test(r), 'get_data 不传 jsonPath 返回整个主数据 + hash')

    // get_data 读子路径
    r = await invoke(t['get_data'], { jsonPath: 'theme' })
    assert(/dark/.test(r) && /hash=/.test(r), 'get_data 传 jsonPath 返回子路径值 + hash')

    // get_data 读不存在的子路径
    r = await invoke(t['get_data'], { jsonPath: 'nope' })
    assert(/undefined/.test(r), 'get_data 读不存在的子路径返回 undefined')

    // edit_data 增量 set 子路径(合法)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '5' })
    assert(appObj.count === 5 && /已 edit/.test(r), 'edit_data set 子路径生效')

    // edit_data 非法值被校验拦截(整体仍经 schema)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '"not a number"' })
    assert(/SCHEMA_INVALID/.test(r) && appObj.count === 5, 'edit_data 非法值被 schema 校验拦截(不写入)')

    // delete_data 删子路径
    r = await invoke(t['delete_data'], { jsonPath: 'count' })
    assert(!('count' in appObj) && /已删除/.test(r), 'delete_data 删子路径生效')

    // delete_data 删不存在的子路径
    r = await invoke(t['delete_data'], { jsonPath: 'nope' })
    assert(/不存在/.test(r), 'delete_data 删不存在的子路径返回不存在')

    // describe_data 返回说明
    r = await invoke(t['describe_data'], {})
    assert(/应用配置/.test(r), 'describe_data 返回主数据说明')
  }
}
