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

// trimMemoryMessagesImpl(内存轮数上限裁剪:旧摘要合并,防逐级丢失)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[trimMemoryMessagesImpl]')
  {
    // 造消息:每轮 = user + assistant。maxMemoryRounds=3,造 5 轮 → 触发裁剪保留最近 3 轮
    const mk = (i: number): AgentMessage[] => [
      { role: 'user', content: `问题${i}`, timestamp: i },
      { role: 'assistant', content: `回复${i}`, timestamp: i + 1 },
    ]
    let msgs: AgentMessage[] = []
    for (let i = 1; i <= 5; i++) msgs.push(...mk(i))

    // 1. 首次裁剪:older=前2轮,生成摘要 system,保留最近3轮
    const r1 = trimMemoryMessagesImpl(msgs, 3)
    assert(r1.trimmed === true, '超 maxMemoryRounds → 触发裁剪')
    assert(r1.deleteFrom === 0 && r1.deleteCount === 4, '删除前2轮(4条消息)')
    assert(r1.summary.role === 'system' && /【更早对话摘要\(2 轮\)/.test(r1.summary.content), '生成摘要 system(2 轮)')
    assert(/问题1/.test(r1.summary.content) && /问题2/.test(r1.summary.content), '摘要含 older 轮内容')

    // 应用首次裁剪:头部摘要 + 最近3轮
    msgs = [r1.summary, ...msgs.slice(r1.deleteCount)]

    // 2. 再加2轮 → 6条+头部摘要,rounds=5轮(头部摘要被 groupRounds 跳过)→ 再次触发
    for (let i = 6; i <= 7; i++) msgs.push(...mk(i))
    const r2 = trimMemoryMessagesImpl(msgs, 3)
    assert(r2.trimmed === true, '再次超限 → 再次触发')
    // 关键:新摘要必须含旧摘要正文(累积),否则更早摘要被静默丢弃
    assert(/问题1/.test(r2.summary.content) && /问题2/.test(r2.summary.content), '旧摘要(问题1/2)并入新摘要,不丢累积')
    assert(/含累积/.test(r2.summary.content), '新摘要标注"含累积"')
    assert(/【续】/.test(r2.summary.content), '旧摘要作"续"段追加')
    assert(/问题3/.test(r2.summary.content) && /问题4/.test(r2.summary.content), '新 older(问题3/4)也并入')

    // 3. 未超限不触发
    const r3 = trimMemoryMessagesImpl([r1.summary, ...mk(1), ...mk(2), ...mk(3)], 3)
    assert(r3.trimmed === false, '未超 maxMemoryRounds → 不触发')

    // 4. maxMemoryRounds<=0 关闭
    const r4 = trimMemoryMessagesImpl(msgs, 0)
    assert(r4.trimmed === false, 'maxMemoryRounds<=0 → 关闭不裁剪')
  }


  // ===== dataOps controller(set/update 换 schema/bind,单主对象)=====
  {
    const dataObj: any = { base: 'init' }
    const tools = createDataOps({
      schema: z.object({ base: z.string() }),
      bind: dataObj,
      description: '初始',
    })
    const t = byName(tools)
    // controller 挂在工具数组上(不可枚举)
    const controller = (tools as any).controller
    assert(!!controller, 'createDataOps 返回的工具数组上挂有 controller')
    assert(Array.isArray(tools) && tools.length === 16, 'controller 不可枚举不影响数组长度/遍历(仍 16 工具)')

    // get() 返回当前 config
    const cfg = controller.get()
    assert(cfg.description === '初始' && cfg.bind === dataObj, 'controller.get() 返回当前 config(schema/bind/description)')

    // set() 换整个 config(新 schema + 新 bind + 新 description),清快照
    const newObj: any = { count: 5 }
    controller.set({ schema: z.object({ count: z.number().int().min(0) }), bind: newObj, description: '改后' })
    const cfg2 = controller.get()
    assert(cfg2.description === '改后' && cfg2.bind === newObj, 'controller.set() 换 config 后 get() 反映新值')
    // 新 schema 立即对工具生效:edit_data 合法值写入新 bind
    let r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '42' })
    assert(newObj.count === 42 && /已 edit/.test(r), 'set 换 config 后 edit 立即按新 schema 生效(写新 bind)')
    // 旧 bind 不再被工具操作(工具操作新 bind)
    assert(dataObj.base === 'init', 'set 换 bind 后旧 bind 不受工具影响')
    // 新 schema 校验生效
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'count', value: '-1' })
    assert(/SCHEMA_INVALID/.test(r) && newObj.count === 42, 'set 换 schema 后按新 schema 校验(非法值不写)')

    // update() 只换 bind(保留 schema/description),清快照
    const newerObj: any = { count: 10 }
    controller.update(newerObj)
    assert(controller.get().bind === newerObj && controller.get().description === '改后', 'controller.update() 只换 bind,保留 schema/description')
    r = await invoke(t['get_data'], { jsonPath: 'count' })
    assert(/10/.test(r), 'update 换 bind 后 get_data 读新 bind 值')

    // set 后快照被清:list_data_snapshots 无历史
    r = await invoke(t['list_data_snapshots'], {})
    assert(/#0|空|无/.test(r) || !/#1/.test(r), 'set/update 换 config 后清快照(list 无历史)')
  }
}
