/**
 * Verify 自检中间件 —— agent 返回前跑领域 check,不通过则回灌 feedback 触发自纠
 *
 * 把集成方的 check(VerifyCheck)包成 beforeReturn 钩子:
 *   - ok=true  → 放行 return
 *   - ok=false → feedback 回灌为 user 消息,继续循环自纠(受 createAgent maxVerifyAttempts 约束防死循环)
 *
 * 自纠上限(maxVerifyAttempts)由 createAgent 层兜底,中间件不自己计数 ——
 * 预算耗尽时 createAgent 根本不调 beforeReturn(见 createAgent 钩子点:预算检查前置)。
 *
 * 通用 check 高度领域相关且不可靠,框架只提供模板;内置机械 check(createWriteBackCheck)见期三。
 * 对抗式验证(adversarial:spawn 找茬子 agent)见期四。
 */
import type { ZodType } from 'zod'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Middleware } from './middleware'
import type { HarnessState } from './state'
import type { SubagentLlmConfig } from './subagent'
import { createAgent } from './createAgent'

/** verify check 上下文:与 beforeReturn 底层一致(BaseMessage[],含 system 头 + agent 最新回复 + 历史 tool_result) */
export interface VerifyCheckContext {
  messages: BaseMessage[]
  /** harness 状态;含 verifyAttempts(check 可读,但预算兜底已在 createAgent 层) */
  state: HarnessState
}

/** verify check 结果 */
export interface VerifyCheckResult {
  ok: boolean
  /** ok=false 时的修正指引(回灌给 agent 触发自纠);省略则用默认文案 */
  feedback?: string
}

/** 领域校验函数:ok=true 放行 return,ok=false 用 feedback 回灌自纠 */
export type VerifyCheck = (ctx: VerifyCheckContext) => Promise<VerifyCheckResult> | VerifyCheckResult

export interface VerifyMiddlewareOptions {
  /** 领域校验函数(必填) */
  check: VerifyCheck
  /**
   * 对抗式验证:check 通过后 spawn 一个无工具的"找茬"子 agent(refute 姿态)审查 agent 回复找错误,
   * 突破自审 confirmation bias;verdict 表明无问题 → 放行,否则回灌。复查 window 交 createWriteBackCheck,故子 agent 无工具。
   */
  adversarial?: { llm: SubagentLlmConfig | BaseChatModel }
}

/**
 * 创建 verify 自检中间件。
 * @example
 * createVerifyMiddleware({
 *   check: async ({ messages }) => {
 *     const last = messages[messages.length - 1]
 *     return { ok: !!last?.content, feedback: '回复为空' }
 *   },
 * })
 */
export function createVerifyMiddleware(opts: VerifyMiddlewareOptions): Middleware {
  return {
    name: 'verify',
    async beforeReturn({ messages, state, log }) {
      const res = await opts.check({ messages, state })
      if (!res.ok) return res.feedback ?? '结果未通过验证,请复查。'
      // check 通过 + 对抗验证开启:spawn 找茬子 agent(refute 姿态)再审,突破自审 confirmation bias
      if (opts.adversarial) {
        log?.('middleware', { stage: 'adversarial_start', model: describeLlm(opts.adversarial.llm) })
        const advFeedback = await runAdversarial(messages, opts.adversarial.llm, log)
        log?.('middleware', { stage: 'adversarial_done', clean: advFeedback === null, feedback: advFeedback })
        if (advFeedback) return advFeedback
      }
      return null
    },
  }
}

// ===== 内置 domain check:写后读回验证(期三)=====

/** 写 window 的工具名(set/edit/delete) */
const WRITE_WINDOW_TOOLS = new Set(['set_window_prop', 'edit_window_prop', 'delete_window_prop'])

/** windowOps 写工具的拒绝文案(校验失败/范围拒绝/不存在等);ToolMessage content 命中则视为合法拒绝,读回无值是预期 */
const WRITE_REJECTED_RE = /校验失败|未在注册表中声明|未注册|不存在|仅支持|必须是/

/**
 * 扫描整个会话的写操作(非仅最近一轮):所有 AIMessage 中 set/edit/delete 的 tool_call。
 * 按 path 去重,保留每个 path 的最后一次操作(后写覆盖先写,如 set 后 delete 以 delete 为准)。
 * 保留 callId 供 createWriteBackCheck 关联 ToolMessage 判断写是否被合法拒绝。
 */
function extractWrites(messages: BaseMessage[]): Array<{ path: string; op: string; callId?: string }> {
  const byPath = new Map<string, { path: string; op: string; callId?: string }>()
  for (const m of messages) {
    const tcs = (m as any)?.tool_calls
    if (!Array.isArray(tcs)) continue
    for (const tc of tcs) {
      if (WRITE_WINDOW_TOOLS.has(tc.name) && typeof tc?.args?.path === 'string') {
        byPath.set(tc.args.path, { path: tc.args.path, op: tc.name, callId: tc.id })
      }
    }
  }
  return [...byPath.values()]
}

/** 收集所有 ToolMessage 的 callId → content(供判断写是否被 windowOps 合法拒绝) */
function collectToolResults(messages: BaseMessage[]): Map<string, string> {
  const results = new Map<string, string>()
  for (const m of messages) {
    const id = (m as any)?.tool_call_id
    const content = (m as any)?.content
    if (typeof id === 'string' && typeof content === 'string') results.set(id, content)
  }
  return results
}

/** 轻量按点路径读取(支持数字索引,如 page.components.0.text);与 windowOps 内部 getByPath 同语义 */
function readByPath(root: unknown, path: string): unknown {
  if (root == null) return undefined
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export interface WriteBackCheckOptions {
  /** path → zod schema(由 createPageAgent 从 windowProps 构造注入);省略则只校验「读回非空」不校验 schema */
  schemas?: Record<string, ZodType>
  /** 读 window 的根对象(默认 globalThis.window;page-agent 零桥接 = 宿主 window) */
  window?: unknown
}

/**
 * 写后读回验证 —— 机械验证「写入生效 + 符合 schema」,不做语义判断。
 * - 无写操作 → 放行(ok)
 * - 写被 windowOps 合法拒绝(ToolMessage content 命中 WRITE_REJECTED_RE,如校验失败/范围拒绝)→ 跳过(读回无值是预期,不误报)
 * - set/edit 后读回为空 → 未生效
 * - set/edit 后读回不符合 schema → 校验失败
 * - delete 后读回仍有值 → 未删干净(读回空 = 删除成功,放行)
 *
 * 注:windowOps 写入(setByPath)同步更新值,readByPath 读底层值即可见新值,无需 nextTick。
 * @example createPageAgent({ capabilities:{verify:true}, verify:{ maxAttempts:1 } })  // check 省略 → 默认用本函数
 */
export function createWriteBackCheck(opts: WriteBackCheckOptions = {}): VerifyCheck {
  const root = opts.window ?? (globalThis as any).window
  const schemas = opts.schemas ?? {}
  return async ({ messages }) => {
    const writes = extractWrites(messages)
    if (!writes.length) return { ok: true }
    const toolResults = collectToolResults(messages)
    const issues: string[] = []
    for (const { path, op, callId } of writes) {
      // 写被 windowOps 合法拒绝 → 读回无值是预期,跳过(避免误报"未生效"误导 agent 去修一个本就该失败的写)
      const resultContent = callId ? toolResults.get(callId) : undefined
      if (resultContent && WRITE_REJECTED_RE.test(resultContent)) continue
      const current = readByPath(root, path)
      if (op === 'delete_window_prop') {
        if (current !== undefined) issues.push(`${path} 删除后读回仍有值,疑似未生效`)
      } else {
        // set/edit_window_prop:读回应有值 + 符合 schema
        if (current === undefined || current === null) {
          issues.push(`写入 ${path} 后读回为空,疑似未生效`)
        } else if (schemas[path]) {
          const res = schemas[path].safeParse(current)
          if (!res.success) issues.push(`${path} 读回值不符合 schema:${res.error.issues?.[0]?.message ?? '校验失败'}`)
        }
      }
    }
    return issues.length ? { ok: false, feedback: issues.join(';\n') } : { ok: true }
  }
}

// ===== 对抗式验证(期四:spawn 找茬子 agent,refute 姿态)=====

/** 判定 llm 是模型实例(BaseChatModel)还是配置对象(与 subagent/createPageAgent 同逻辑) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 描述 llm(供日志/调试面板显示对抗模型信息) */
function describeLlm(llm: SubagentLlmConfig | BaseChatModel): string {
  return isChatModel(llm) ? ((llm as any).model ?? (llm as any).modelName ?? '<实例>') : (llm.model ?? '<配置>')
}

/** 对抗审查"无问题"放行判定(verdict 命中 → 子 agent 未找出问题) */
const ADVERSARIAL_CLEAN_RE = /无问题|没有问题|未发现问题|没有发现|没问题|未发现/

/** 判定对抗审查 verdict 是否"干净"(无问题)——导出供集成方/测试复用 */
export function isAdversarialClean(verdict: string): boolean {
  return ADVERSARIAL_CLEAN_RE.test(verdict)
}

/** 提取最近一轮的 user 需求 + assistant 最终回复(最后一条无 tool_calls 的 AIMessage) */
function extractLastTurn(messages: BaseMessage[]): { lastUser: string; lastReply: string } {
  let lastUser = ''
  let lastReply = ''
  for (const m of messages) {
    if (m instanceof HumanMessage) {
      lastUser = typeof m.content === 'string' ? m.content : ''
    } else if (m instanceof AIMessage && !((m as any).tool_calls?.length > 0)) {
      lastReply = typeof m.content === 'string' ? m.content : ''
    }
  }
  return { lastUser, lastReply }
}

/**
 * 对抗式验证:构造无工具审查子 agent,refute 姿态挑 agent 回复的错。
 * - 无工具纯文本审查(复查 window 交 createWriteBackCheck)
 * - verdict 表明无问题 → null(放行);否则返回子 agent 找出的问题
 * - 依赖 LLM,运行时行为(同 subagent/mcp 手动验证);isAdversarialClean 纯函数已自测
 */
async function runAdversarial(
  messages: BaseMessage[],
  llm: SubagentLlmConfig | BaseChatModel,
  log?: (type: string, data: unknown) => void,
): Promise<string | null> {
  const { lastUser, lastReply } = extractLastTurn(messages)
  if (!lastReply) return null // 无最终回复可审,放行
  const prompt = [
    '你是严格的对抗式审查者,目标是找出以下 AI 助手回复的错误并证明它有问题(事实错误 / 遗漏 / 逻辑矛盾 / 与需求不符)。',
    `用户需求:${lastUser || '(未明确)'}`,
    `助手回复:${lastReply}`,
    '只报告具体、可验证的问题。若确实无问题,只回复"无问题"。',
  ].join('\n')
  const sys = '你是严格的对抗式审查者,只找问题不赞美。目标是反驳,不是改进。'
  // 对抗子 agent 的日志经 onLog 转发到主 debugLogs(带 source:'adversarial' 标签,调试面板可区分)
  const forwardLog = log ? (e: { type: string; data: unknown }) => log(e.type, { ...(e.data as object), source: 'adversarial' }) : undefined
  const child = createAgent(
    isChatModel(llm)
      ? { llm, maxToolRounds: 1, systemPrompt: sys, onLog: forwardLog }
      : { apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model, temperature: 0, maxTokens: llm.maxTokens, maxToolRounds: 1, systemPrompt: sys, onLog: forwardLog },
  )
  const verdict = await child.invoke([{ role: 'user', content: prompt, timestamp: Date.now() }])
  log?.('middleware', { stage: 'adversarial_verdict', verdict, source: 'adversarial' })
  return isAdversarialClean(verdict) ? null : verdict.trim()
}
