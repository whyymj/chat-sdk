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

// 安全:merge 原型污染 + jsonPath 边界
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[security: merge 原型污染 + jsonPath 边界]')
  {
    const bind: any = { a: 1, items: ['x'] }
    const tools = createDataOps({
      schema: z.object({ a: z.number(), items: z.array(z.string()) }).passthrough(),
      bind,
      description: 'p',
    })
    const t = byName(tools)

    // merge value 含 __proto__/constructor:不应污染 Object.prototype,不应给目标加 own 危险键
    let r = await invoke(t['edit_data'], { op: 'merge', jsonPath: '', value: '{"__proto__":{"polluted":true},"constructor":{"x":1},"b":2}' })
    assert(bind.b === 2, 'merge: 正常键 b 落地')
    assert(!Object.prototype.hasOwnProperty.call(bind, '__proto__'), 'merge: 目标无 __proto__ own 属性')
    assert(!Object.prototype.hasOwnProperty.call(bind, 'constructor'), 'merge: 目标无 constructor own 属性')
    assert(({} as any).polluted === undefined, 'merge: 未污染 Object.prototype(__proto__ 未生效)')
    assert(({} as any).x === undefined, 'merge: 未污染 Object.prototype(constructor 未生效)')

    // jsonPath 含 __proto__ 段:一律拒绝(PATH_UNSAFE)
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: '__proto__.polluted', value: 'true' })
    assert(/PATH_UNSAFE/.test(r), 'edit: jsonPath 含 __proto__ 被拒')
    assert(({} as any).polluted === undefined, 'edit: __proto__ jsonPath 未造成污染')

    // set 越界数组索引:schema 校验在副本上拦截稀疏空洞,不写入
    r = await invoke(t['edit_data'], { op: 'set', jsonPath: 'items.5', value: '"y"' })
    assert(/SCHEMA_INVALID|PATCH_FAILED/.test(r), 'edit: set 越界数组索引被 schema 拦截(不产生稀疏空洞)')
    assert(bind.items.length === 1 && bind.items[0] === 'x', 'edit: 越界 set 未改动原数组')
  }

  // ============ ReAct 循环健壮性(收口综合 / afterAgent 兜底 / 逐轮 trim)============
  console.log('\n[harness loop: 收口综合 + afterAgent 兜底 + 逐轮 trim]')
  {
    // mock LLM:按 scripts 顺序返回响应(支持 tool_calls 或纯文本);不绑工具(allTools 空时 createAgent 不调 bindTools)
    class MockLLM extends BaseChatModel {
      scripts: Array<{ content?: string; toolCalls?: Array<{ id?: string; name: string; args?: any }> }>
      idx = 0
      constructor(scripts: any[]) { super({}); this.scripts = scripts }
      _llmType(): string { return 'mock' }
      async *_streamResponseChunks(_messages: any, _options: any): AsyncGenerator<any> {
        const s = this.scripts[this.idx++] ?? { content: '完成。' }
        const tcc = (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: JSON.stringify(tc.args ?? {}), index: i }))
        yield { text: s.content ?? '', message: new AIMessageChunk({ content: s.content ?? '', tool_call_chunks: tcc }), generationInfo: {} }
      }
      async _generate(_messages: any, _options: any): Promise<any> {
        const s = this.scripts[this.idx++] ?? { content: '完成。' }
        const msg = new AIMessage({ content: s.content ?? '', tool_calls: (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: tc.args ?? {} })) })
        return { generations: [{ text: s.content ?? '', message: msg }], llmOutput: {} }
      }
    }

    // ① 收口综合:工具轮耗尽(末尾是 ToolMessage)→ 强制再跑一轮综合,返回最终回答而非"请简化问题"
    const mockA = new MockLLM([
      { toolCalls: [{ name: 'noop', args: {} }] },
      { toolCalls: [{ name: 'noop', args: {} }] },
      { content: '最终综合回答' },
    ])
    const agentA = createAgent({ llm: mockA as any, maxToolRounds: 2, maxRetries: 0 })
    let finalA = ''
    await agentA.stream([{ role: 'user', content: '做点事', timestamp: Date.now() }], (e) => { if (e.type === 'done') finalA = e.content }, undefined)
    assert(finalA === '最终综合回答', '收口综合:工具轮耗尽后强制再跑一轮综合,返回最终回答(非"请简化问题")')

    // ② afterAgent 兜底:模型抛错时 stream reject,但 afterAgent 经 finally 仍执行(中间件清理不跳过)
    class ThrowingLLM extends MockLLM {
      async *_streamResponseChunks(): AsyncGenerator<any> { throw new Error('boom') }
      async _generate(): Promise<any> { throw new Error('boom') }
    }
    let afterAgentRan = false
    const mw: Middleware = { name: 'rec', afterAgent: () => { afterAgentRan = true; return undefined } }
    const agentB = createAgent({ llm: new ThrowingLLM([]) as any, middleware: [mw], maxToolRounds: 5, maxRetries: 0 })
    let threwB = false
    try { await agentB.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined) } catch { threwB = true }
    assert(threwB, '异常路径:模型抛错时 stream 仍 reject(错误不被吞)')
    assert(afterAgentRan, '异常路径:afterAgent 经 finally 兜底仍执行(中间件清理不跳过)')

    // ②+ 压缩统计捕获:createAgent 在 compressInput 后把 stats 写入 state.lastCompression
    let capturedStats: any = undefined
    const compressMw: Middleware = {
      name: 'fake-compress',
      compressInput: async (msgs) => ({ messages: msgs, stats: { triggered: true, roundsTotal: 4, roundsSummarized: 2, roundsRecalled: 1, originalMessages: 8, compressedMessages: 5, strategy: 'token-window+llm_summary' } }),
      afterAgent: (st) => { capturedStats = st.lastCompression },
    }
    const agentC = createAgent({ llm: new MockLLM([{ content: 'ok' }]) as any, middleware: [compressMw], maxToolRounds: 2, maxRetries: 0 })
    await agentC.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined)
    assert(capturedStats && capturedStats.triggered === true && capturedStats.strategy === 'token-window+llm_summary', '压缩统计:compressInput stats 写入 state.lastCompression(afterAgent 可观测)')

    // ③ 逐轮 trim 纯函数:tool 结果累积超放行上限 → 最早 ToolMessage 压缩为占位摘要(保留 tool_call_id)
    const big = 'x'.repeat(1000)
    const msgs = [new SystemMessage('sys'), new HumanMessage('q'), new ToolMessage({ tool_call_id: '1', content: big }), new ToolMessage({ tool_call_id: '2', content: big })]
    const out = trimContextIfNeededImpl(msgs, 1500)
    assert(out.length === 4, 'trim: 消息数不变(只压内容不删消息)')
    const total = out.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
    assert(total < 2000, 'trim: 总字符从 ~2004 降到阈值附近(<2000)')
    assert(out[0].content === 'sys' && out[1].content === 'q', 'trim: system/human 原样保留')
    assert(/已自动压缩/.test(out[2].content as string), 'trim: 最早 ToolMessage 压缩为占位摘要')
    assert((out[2] as any).tool_call_id === '1', 'trim: 保留 tool_call_id(结构完整,模型仍能对应)')
    const out2 = trimContextIfNeededImpl(msgs, 5000)
    assert(out2 === msgs, 'trim: 未超阈值原样返回同引用')

    // keep 自适应:小阈值保留首 100,大阈值保留首 400(clamp)
    const smallKeep = trimContextIfNeededImpl(msgs, 1500)
    assert(/保留首 100/.test(smallKeep[2].content as string), 'trim: keep 自适应(小阈值→100)')
    const bigMsgs = [new SystemMessage('s'), new HumanMessage('q'), new ToolMessage({ tool_call_id: '1', content: 'x'.repeat(300000) })]
    const bigKeep = trimContextIfNeededImpl(bigMsgs, 200000)
    assert(/保留首 400/.test(bigKeep[2].content as string), 'trim: keep 自适应(大阈值→400)')
  }
}
