// stub BaseChatModel —— node e2e 运行时测基建:可控响应队列驱动真实 agent ReAct 循环(不发 HTTP)
//
// 区别于 browser e2e 的 mockLlm(拦截 LLM 端点 SSE):本 stub 是本地 BaseChatModel 子类,
// createChatSdk 直接拿它当 llm 跑完整 ReAct 循环(工具调用 → tool result → 再调 model → 终止)。
// 用于 budget 超限 / automation 错误恢复 / subagent-writable / todos-tier 等顶层运行时集成测
// (selftest 跑源码触不到 createChatSdk 顶层运行时,现有 e2e 只测 inspect 反射不真跑循环)。
//
// 实现要点(createAgent.ts coreModelCall 契约):
//  - streamer.stream(messages) → 聚合 AIMessageChunk → 从聚合 message 读 tool_calls
//  - BaseChatModel.stream 默认 yield chunk.message(@langchain/core chat_models.js:165)
//  - 故 _streamResponseChunks 须 yield ChatGenerationChunk { text, message: AIMessageChunk }
//  - bindTools 返回 this:stub 按预设队列响应,不依赖 bindTools 注入的工具 schema
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'

/**
 * 响应队列项(按 model 调用顺序消费;越界默认纯文本终止,防队列耗尽死循环):
 *  - { text }                       → 纯文本回复(agent 终止轮)
 *  - { toolCalls: [{ name, args }] } → 工具调用(agent 继续 ReAct)
 *  - { throw: Error }               → model 调用抛错(测 retry / 错误恢复)
 *  - { usage: { total_tokens, ... } } → 塞 additional_kwargs.usage(测 budget token 累计)
 *  - 组合:{ text, toolCalls, usage } 任选字段
 */
export class StubChatModel extends BaseChatModel {
  constructor(responses, opts = {}) {
    super(opts)
    this.responses = responses
    this.index = 0
    /** model 调用次数(断言用,如 budget 超限后应停止再调) */
    this.calls = 0
    // harden-context-resilience:stub 默认声明 ≥200K 窗口(resolveLlm 实例路径读 .contextWindow),过最小窗口校验
    this.contextWindow = opts.contextWindow ?? 200000
  }
  _llmType() { return 'stub' }

  /** 忽略工具绑定:stub 按预设队列响应,不依赖 bindTools 注入的 schema */
  bindTools() { return this }

  _next() {
    this.calls++
    const r = this.responses[this.index]
    if (this.index < this.responses.length) this.index++
    return r ?? { text: '(stub 队列已空,默认终止)' }
  }

  /** stream 路径(createAgent 用):yield ChatGenerationChunk,基类 stream 会 yield chunk.message 给聚合 */
  async *_streamResponseChunks(_messages, _opts, _runm) {
    const resp = this._next()
    if (resp.throw) {
      // throw:string 自动构造 Error;默认 status:400(4xx 非 retryable,防 withRetry 把普通 Error 当网络错误重试 ——
      //   retry.ts isRetryable 对 status undefined 的 Error 返 true,会重试致错误恢复/batch 测语义错乱)
      const err = typeof resp.throw === 'string' ? new Error(resp.throw) : resp.throw
      if (err.status === undefined) err.status = 400
      throw err
    }
    const msg = new AIMessageChunk({
      content: resp.text ?? '',
      tool_calls: (resp.toolCalls ?? []).map((tc, i) => ({
        id: tc.id ?? `call_stub_${this.calls}_${i}`,
        name: tc.name,
        args: tc.args ?? {},
        type: 'tool_call',
      })),
      ...(resp.usage ? { additional_kwargs: { usage: resp.usage } } : {}),
    })
    yield { text: typeof msg.content === 'string' ? msg.content : '', message: msg }
  }

  /** invoke 路径(summaryLlmInvoke 用):聚合 stream chunks → ChatResult */
  async _generate(messages, opts, runm) {
    let agg = null
    for await (const c of this._streamResponseChunks(messages, opts, runm)) {
      agg = agg ? agg.concat(c.message) : c.message
    }
    const msg = agg ?? new AIMessage({ content: '' })
    return {
      generations: [{ text: typeof msg.content === 'string' ? msg.content : '', message: msg }],
      llmOutput: {},
    }
  }
}

/** 便捷工厂:stubModel(resp1, resp2, ...) */
export function stubModel(...responses) {
  return new StubChatModel(responses)
}
