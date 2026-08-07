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

    // ①+ P1-1(arch-review):收口综合经中间件栈 —— wrap-up 不再直接调 coreModelCall 绕过 wrapModelCall/afterModel。
    // 修复前:收口轮 token 不计入 sdk-events afterModel 的 usage 累加(漏计 sdk.usage)、budget 预算闸与用户自定义 wrapModelCall 失效。
    // 验证:计数中间件在收口轮也被调用(主循环 2 轮 + wrap-up 1 轮 = 3 次 model call)。
    {
      let wrapModelCallCount = 0
      let afterModelCount = 0
      const countingMw: Middleware = {
        name: 'p1-1-count',
        wrapModelCall: async (req, next) => { wrapModelCallCount++; return next(req) },
        afterModel: () => { afterModelCount++; return undefined },
      }
      const mockP11 = new MockLLM([
        { toolCalls: [{ name: 'noop', args: {} }] },
        { toolCalls: [{ name: 'noop', args: {} }] },
        { content: '收口综合' },
      ])
      const agentP11 = createAgent({ llm: mockP11 as any, maxToolRounds: 2, maxRetries: 0, middleware: [countingMw] })
      await agentP11.stream([{ role: 'user', content: '做点事', timestamp: Date.now() }], () => {}, undefined)
      assert(wrapModelCallCount === 3, 'P1-1 收口经中间件:wrap-up 轮也走 wrapModelCall(budget/用户埋点参与,不再绕过)')
      assert(afterModelCount === 3, 'P1-1 收口经中间件:wrap-up 轮也走 afterModel(收口 token 计入 sdk.usage,不再漏计)')
    }

    // ①++ P1-4(arch-review):subagent allTools 走 getter —— spawn 时取主 agent 最新工具集
    // (运行时 setTools/addTool 动态加的工具对子 agent 可见,不再用装配期快照)。
    // 验证:spy getter 在 spawn_agent 委派时被调用(子 agent 工具集经 getter 取,非闭包快照)。
    {
      let getterCalls = 0
      const childLlm = new MockLLM([{ content: '子结论' }])
      const subMw = createSubagentMiddleware({ llm: childLlm, allTools: () => { getterCalls++; return [] } })
      const mainLlm = new MockLLM([
        { toolCalls: [{ name: 'spawn_agent', args: { prompt: '查一下' } }] },
        { content: '主综合' },
      ])
      const agentP14 = createAgent({ llm: mainLlm, middleware: [subMw], maxToolRounds: 2, maxRetries: 0 })
      let finalP14 = ''
      await agentP14.stream([{ role: 'user', content: '委派子任务', timestamp: Date.now() }], (e) => { if (e.type === 'done') finalP14 = e.content }, undefined)
      assert(getterCalls >= 1, 'P1-4 subagent getter:spawn 时经 getter 取工具集(动态加的工具对子 agent 可见,不再用装配期快照)')
      assert(finalP14 === '主综合', 'P1-4 subagent getter:spawn 链路正常完成(子 agent 返回结论 → 主综合)')
    }

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

    // ②++ P0-1(主流程审查):压缩/累积摘要经 toLC 转 SystemMessage 后必须送达模型。
    // replaceSystem 只替首部 system,不再 filter 掉所有 system(否则摘要首轮即被剥,长对话跨轮记忆静默失效)。
    // 验证:fake compressInput 产出摘要 system 消息 → 捕获「实际发给模型的消息」含该摘要 SystemMessage。
    {
      let capturedReq: any[] = []
      class CaptureLLM extends MockLLM {
        async *_streamResponseChunks(messages: any): AsyncGenerator<any> {
          capturedReq = messages
          yield { text: '完成', message: new AIMessageChunk({ content: '完成' }), generationInfo: {} }
        }
      }
      const summaryMw: Middleware = {
        name: 'p0-1-summary',
        compressInput: async (msgs) => ({
          messages: [{ role: 'system', content: '【对话历史摘要】之前讨论了 X 的实现细节' }, ...msgs],
          stats: { triggered: true },
        }),
      }
      const agentP01 = createAgent({ llm: new CaptureLLM([]) as any, middleware: [summaryMw], maxToolRounds: 1, maxRetries: 0 })
      await agentP01.stream([{ role: 'user', content: '继续', timestamp: Date.now() }], () => {}, undefined)
      const sysMsgs = capturedReq.filter((m: any) => typeof m._getType === 'function' && m._getType() === 'system')
      assert(sysMsgs.length >= 2, 'P0-1 摘要送达:压缩产出的摘要 SystemMessage 保留(replaceSystem 只替首部,不剥其余 system)')
      assert(sysMsgs.some((m: any) => /对话历史摘要/.test(String(m.content))), 'P0-1 摘要送达:摘要内容确实出现在发给模型的消息里(非被 filter 剥光)')

      // 对照:无摘要注入时,system 仅主 prompt 一条(防 replaceSystem 误保留旧主 prompt)
      let capturedReq2: any[] = []
      class CaptureLLM2 extends MockLLM {
        async *_streamResponseChunks(messages: any): AsyncGenerator<any> { capturedReq2 = messages; yield { text: 'ok', message: new AIMessageChunk({ content: 'ok' }), generationInfo: {} } }
      }
      const agentP01b = createAgent({ llm: new CaptureLLM2([{ content: 'ok' }]) as any, maxToolRounds: 1, maxRetries: 0 })
      await agentP01b.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined)
      const sysMsgs2 = capturedReq2.filter((m: any) => typeof m._getType === 'function' && m._getType() === 'system')
      assert(sysMsgs2.length === 1, 'P0-1 基线:无摘要注入时 system 仅主 prompt 一条(replaceSystem 不重复堆积)')
    }

    // ②++++ P1-d(主流程审查):流式迭代中途失败不重试 —— 已 emit 文本,withRetry 重跑会从头再 emit 致 UI 重复两遍。
    // 修复:仅 stream 启动(连接建立)走重试,迭代中失败直接抛。验证:_streamResponseChunks 只执行 1 次(未重跑重发)。
    {
      let streamCallCount = 0
      class MidStreamFailLLM extends MockLLM {
        async *_streamResponseChunks(): AsyncGenerator<any> {
          streamCallCount++
          yield { text: 'Hello', message: new AIMessageChunk({ content: 'Hello' }), generationInfo: {} }
          throw new Error('mid-stream network reset')  // 已 emit 'Hello' 后迭代中途失败
        }
      }
      const agentP1d = createAgent({ llm: new MidStreamFailLLM([]) as any, maxToolRounds: 1, maxRetries: 2 })
      await agentP1d.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {}, undefined).catch(() => {})
      assert(streamCallCount === 1, 'P1-d 迭代中途失败不重试:_streamResponseChunks 只执行 1 次(未重跑重发致文本重复;旧实现 withRetry 包整体会重跑 maxRetries+1 次)')
    }

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

    // ④ tool_result 事件带耗时(durationMs):工具执行后回填,UI 步骤行展示;独立计时,不依赖 tracing 开关
    const collected: any[] = []
    const agentD = createAgent({ llm: new MockLLM([{ toolCalls: [{ name: 'noop', args: {} }] }, { content: '完成' }]) as any, maxToolRounds: 2, maxRetries: 0 })
    await agentD.stream([{ role: 'user', content: 'go', timestamp: Date.now() }], (e) => collected.push(e), undefined)
    const toolResults = collected.filter((e) => e.type === 'tool_result')
    assert(toolResults.length > 0, 'tool_result 事件发出(工具被调用)')
    assert(toolResults.every((e) => typeof e.durationMs === 'number' && e.durationMs >= 0), 'tool_result 带 durationMs(非负 number,供步骤行展示耗时)')
  }
}
