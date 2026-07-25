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


  // ===== dataSlotOps 动态注册(controller.add/remove/list)=====
  {
    const w = (globalThis as any).window
    w.dyn = {}
    const tools = createDataSlotOps([
      { path: 'dyn.base', description: '初始注册', schema: z.string() },
    ])
    const t = byName(tools)
    // controller 挂在工具数组上(不可枚举)
    const controller = (tools as any).controller
    assert(!!controller, 'createDataSlotOps 返回的工具数组上挂有 controller')
    assert(Array.isArray(tools) && tools.length === 13, 'controller 不可枚举不影响数组长度/遍历(仍 13 工具)')

    // 初始只有 dyn.base
    assert(controller.list().length === 1 && controller.has('dyn.base'), '初始 list 仅含 dyn.base')
    assert(controller.has('dyn.unknown') === false, 'has 未注册 path 返回 false')

    // 动态新增 dyn.late(懒加载组件场景)
    controller.add({ path: 'dyn.late', description: '动态注册项', schema: z.number().int().min(0) })
    assert(controller.has('dyn.late') && controller.list().length === 2, 'add 后 has 命中 + list 数量+1')
    // 新增项立即对工具生效:set 合法值写入
    let r = await invoke(t['set_data_slot'], { path: 'dyn.late', value: '42' })
    assert(w.dyn.late === 42 && /已设置/.test(r), '动态注册后 set 立即生效(写成功)')
    // B:写操作成功返回附「当前可操作 path 列表」提示
    assert(/当前可操作 path:/.test(r) && r.includes('dyn.base') && r.includes('dyn.late'), 'B:set 返回附当前可操作 path 列表')
    // schema 校验同样生效
    r = await invoke(t['set_data_slot'], { path: 'dyn.late', value: '-1' })
    assert(/SCHEMA_INVALID/.test(r) && w.dyn.late === 42, '动态注册项的 schema 校验生效(非法值不写)')
    // 未动态注册的 path 仍被拒
    r = await invoke(t['set_data_slot'], { path: 'dyn.never', value: '1' })
    assert(/未在注册表中声明/.test(r), '未注册 path 仍被范围控制拒绝')

    // 覆盖已注册项(改 schema)
    controller.add({ path: 'dyn.base', description: '改后', schema: z.enum(['a', 'b']) })
    r = await invoke(t['set_data_slot'], { path: 'dyn.base', value: '"a"' })
    assert(w.dyn.base === 'a', '覆盖注册项后按新 schema 写入')
    r = await invoke(t['set_data_slot'], { path: 'dyn.base', value: '"x"' })
    assert(/SCHEMA_INVALID/.test(r), '覆盖后按新 schema 校验(旧 string schema 不再适用)')

    // 移除注册项
    const removed = controller.remove('dyn.late')
    assert(removed === true && !controller.has('dyn.late'), 'remove 返回 true 且 has 变 false')
    assert(controller.list().length === 1, 'remove 后 list 数量-1(只剩 dyn.base)')
    // 移除后 set 被拒
    r = await invoke(t['set_data_slot'], { path: 'dyn.late', value: '1' })
    assert(/未在注册表中声明/.test(r), 'remove 后 set 被拒(已不在注册表)')
    // 移除不存在的 path 返回 false
    assert(controller.remove('dyn.late') === false, 'remove 不存在 path 返回 false')

    // 清理
    delete w.dyn
  }
}
