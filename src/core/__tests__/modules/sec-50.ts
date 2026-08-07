import { analyzeContext } from '../../utils/contextAnalysis'
import { createContextInspectorMiddleware } from '../../harness/contextInspector'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

// context-inspector:analyzeContext 纯函数(分类切分 + token 估算)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[context-inspector: analyzeContext 分类切分 + token 估算]')

  // ① system 标记段分类:各 augmentPrompt 段归对应桶 + 身份段归 systemPrompt
  {
    const sys = new SystemMessage(
      ['你是助手。', '', '## 可操作数据\ntitle: 标题', '', '## 能力使用提示\n用 read/write', '', '## 当前主线目标\n完成 X', '', '## 工作记忆\npaths: a.b'].join('\n\n'),
    )
    const snap = analyzeContext([sys, new HumanMessage('问题')])
    const keys = snap.categories.map((c) => c.key)
    assert(keys.includes('systemPrompt'), 'analyzeContext: 身份段归 systemPrompt 桶')
    assert(keys.includes('dataHint'), 'analyzeContext: ## 可操作数据 → dataHint')
    assert(keys.includes('usageHints'), 'analyzeContext: ## 能力使用提示 → usageHints')
    assert(keys.includes('mission'), 'analyzeContext: ## 当前主线目标 → mission')
    assert(keys.includes('workingMemory'), 'analyzeContext: ## 工作记忆 → workingMemory')
    assert(keys.includes('current'), 'analyzeContext: 最新 user → current')
  }

  // ② 标记前缀定位(段内 \n\n 不误拆):schema hint 多行含空行仍归 dataHint(msgCount=1)
  {
    const sys = new SystemMessage('身份\n\n## 可操作数据\ntitle: 标题\n\n描述行1\n\n描述行2')
    const snap = analyzeContext([sys])
    const dataHint = snap.categories.find((c) => c.key === 'dataHint')
    assert(!!dataHint && dataHint.msgCount === 1, 'analyzeContext: 标记定位 —— 段内含 \\n\\n 不被误拆为多段(msgCount=1)')
  }

  // ③ toolResults 含 tool_calls.args(工具参数在 assistant 消息,漏估会低估 write/patch 占用)
  {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'write', args: { patch: { jsonPath: 'a.b', value: 'x'.repeat(200) } } }] as any,
    })
    const tool = new ToolMessage({ tool_call_id: 'c1', content: '写入成功' })
    const snap = analyzeContext([new HumanMessage('改'), ai, tool])
    const tr = snap.categories.find((c) => c.key === 'toolResults')
    assert(!!tr && tr.msgCount === 2, 'analyzeContext: toolResults 计 args + content(msgCount=2:assistant tool_call + ToolMessage)')
    assert(!!tr && tr.tokens > 0, 'analyzeContext: toolResults tokens 含 args(不漏估工具参数)')
  }

  // ④ history vs current:最新 user → current,其余 user → history
  {
    const snap = analyzeContext([new HumanMessage('旧问题'), new AIMessage('旧答'), new HumanMessage('新问题')])
    const cur = snap.categories.find((c) => c.key === 'current')
    const hist = snap.categories.find((c) => c.key === 'history')
    assert(!!cur && !!hist, 'analyzeContext: history/current 分桶')
    assert(!!cur && cur.msgCount === 1, 'analyzeContext: 最新 user → current(1)')
    assert(!!hist && hist.msgCount === 1, 'analyzeContext: 旧 user → history(1)')
  }

  // ⑤ 占比合计≈1 + occupancy/thresholdRatio/contextWindow 透传 + 降序
  {
    const sys = new SystemMessage('身份\n\n## 可操作数据\nx')
    const snap = analyzeContext([sys, new HumanMessage('问')], { contextWindow: 1000, thresholdRatio: 0.5 })
    const pctSum = snap.categories.reduce((s, c) => s + c.pct, 0)
    assert(Math.abs(pctSum - 1) < 0.001, 'analyzeContext: 占比合计≈1(分类无遗漏)')
    assert(snap.occupancy > 0 && snap.occupancy < 1, 'analyzeContext: occupancy = totalTokens/contextWindow')
    assert(snap.thresholdRatio === 0.5, 'analyzeContext: thresholdRatio 透传')
    assert(snap.contextWindow === 1000, 'analyzeContext: contextWindow 透传')
    assert(snap.categories[0].tokens >= snap.categories[snap.categories.length - 1].tokens, 'analyzeContext: categories 按 tokens 降序')
  }

  // ⑥ 无标记 system → 全归 systemPrompt;空桶不出现
  {
    const snap = analyzeContext([new SystemMessage('纯身份无标记')])
    const sp = snap.categories.find((c) => c.key === 'systemPrompt')
    assert(!!sp && sp.tokens > 0, 'analyzeContext: 无标记 system 全归 systemPrompt')
    assert(snap.categories.length === 1, 'analyzeContext: 仅 systemPrompt 一桶(其他空桶不出现)')
  }

  // ⑦ 中间件 createContextInspectorMiddleware:wrapModelCall 写快照 + getSnapshot 读
  {
    const mw = createContextInspectorMiddleware({ contextWindow: 1000, thresholdRatio: 0.5 })
    const req = { messages: [new SystemMessage('身份\n\n## 可操作数据\nx'), new HumanMessage('问')], state: {} as any }
    const next = async () => ({ message: new AIMessage('答'), toolCalls: [], content: '答' }) as any
    assert(!mw.getSnapshot(), 'context-inspector 中间件:初始无快照')
    await mw.wrapModelCall!(req as any, next as any)
    const snap = mw.getSnapshot()
    assert(!!snap, 'context-inspector 中间件:wrapModelCall 后有快照')
    assert(!!snap && snap.contextWindow === 1000 && snap.thresholdRatio === 0.5, 'context-inspector 中间件:opts 透传到 snapshot')
    assert(!!snap && snap.categories.some((c) => c.key === 'dataHint'), 'context-inspector 中间件:快照含分类(analyzeContext 复用)')
  }
}
