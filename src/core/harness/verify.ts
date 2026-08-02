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
   * 对抗式验证:check 通过后 spawn 一个"找茬"子 agent(refute 姿态)审查 agent 回复找错误,
   * 突破自审 confirmation bias;verdict 表明无问题 → 放行,否则回灌。
   * tools:只读工具集(由 createChatSdk 从 allTools 白名单筛选注入),让子 agent 能实证读回 window 检查而非臆测;
   *        省略/为空则退化为单轮纯文本审查(复查 window 交 createWriteBackCheck)。
   */
  adversarial?: { llm: SubagentLlmConfig | BaseChatModel; tools?: unknown[] }
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
        log?.('middleware', { stage: 'adversarial_start', model: describeLlm(opts.adversarial.llm), tools: (opts.adversarial.tools ?? []).length })
        const advFeedback = await runAdversarial(messages, opts.adversarial.llm, log, opts.adversarial.tools)
        log?.('middleware', { stage: 'adversarial_done', clean: advFeedback === null, feedback: advFeedback })
        if (advFeedback) return advFeedback
      }
      return null
    },
  }
}

// ===== 内置 domain check:写后读回验证(期三)=====

/** 写数据的工具名(set/edit/delete + 高层 write) */
const WRITE_DATA_TOOLS = new Set(['set_data', 'edit_data', 'delete_data', 'write'])

/** dataOps 写工具的拒绝文案(校验失败/范围拒绝/不存在等);ToolMessage content 命中则视为合法拒绝,读回无值是预期 */
const WRITE_REJECTED_RE = /校验失败|SCHEMA_INVALID|未注册|不存在|仅支持|必须是|NOT_OBJECT|PATH_UNSAFE|VERSION_CONFLICT|WRITE_INTERCEPT/

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
      if (!WRITE_DATA_TOOLS.has(tc.name)) continue
      const callId = tc.id
      const args = (tc?.args ?? {}) as Record<string, any>
      if (tc.name === 'write') {
        // write 高层工具:jsonPath 嵌在 patch/patches,展开逐条;op 归一化为 set_data/edit_data/delete_data,
        // 复用 createWriteBackCheck 现有判断(op==='delete_data' → 删后读回应空;否则读回应有值 + schema 校验)
        if (args.del && args.patch?.jsonPath) {
          byPath.set(args.patch.jsonPath, { path: args.patch.jsonPath, op: 'delete_data', callId })
        } else if (Array.isArray(args.patches) && args.patches.length) {
          for (const p of args.patches) {
            const pp = typeof p?.jsonPath === 'string' ? p.jsonPath : ''
            byPath.set(pp, { path: pp, op: p?.op === 'remove' ? 'delete_data' : 'edit_data', callId })
          }
        } else if (args.patch) {
          const pp = typeof args.patch.jsonPath === 'string' ? args.patch.jsonPath : ''
          byPath.set(pp, { path: pp, op: args.patch.op === 'remove' ? 'delete_data' : 'edit_data', callId })
        } else {
          // write({value}) 整体 set → path ''
          byPath.set('', { path: '', op: 'set_data', callId })
        }
      } else {
        // set_data/edit_data/delete_data:扁平 jsonPath(整体写不传 → '')
        const p = typeof args.jsonPath === 'string' ? args.jsonPath : ''
        byPath.set(p, { path: p, op: tc.name, callId })
      }
    }
  }
  return [...byPath.values()]
}

/** 收集所有 ToolMessage 的 callId → content(供判断写是否被 dataOps 合法拒绝) */
function collectToolResults(messages: BaseMessage[]): Map<string, string> {
  const results = new Map<string, string>()
  for (const m of messages) {
    const id = (m as any)?.tool_call_id
    const content = (m as any)?.content
    if (typeof id === 'string' && typeof content === 'string') results.set(id, content)
  }
  return results
}

/** 轻量按点路径读取(支持数字索引,如 page.components.0.text);与 dataOps 内部 getByPath 同语义 */
function readByPath(root: unknown, path: string): unknown {
  if (path === '') return root  // 空路径 = 整体 root
  if (root == null) return undefined
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export interface WriteBackCheckOptions {
  /** path → zod schema(由 createChatSdk 从 data 构造注入,键 '' 为主数据整体 schema);省略则只校验「读回非空」不校验 schema。支持 getter 函数:运行时每次 check 调用取最新(适配 sdk.setData 动态替换) */
  schemas?: Record<string, ZodType> | (() => Record<string, ZodType>)
  /**
   * 读回的根对象。优先于 `window`。
   * - 单对象 data 模式:传 bind 对象(或 getter `() => liveData()?.bind`,适配 sdk.setData 运行时替换)
   * - 旧 windowProps 模式:省略则用 `window`(默认 globalThis.window;零桥接 = 宿主 window)
   * 支持 getter:每次 check 调用取最新
   */
  root?: unknown | (() => unknown)
  /** 读 window 的根对象(旧 windowProps 模式;data 模式应传 root)。默认 globalThis.window */
  window?: unknown
}

/**
 * 写后读回验证 —— 机械验证「写入生效 + 符合 schema」,不做语义判断。
 * - 无写操作 → 放行(ok)
 * - 写被 dataOps 合法拒绝(ToolMessage content 命中 WRITE_REJECTED_RE,如校验失败/范围拒绝)→ 跳过(读回无值是预期,不误报)
 * - set/edit 后读回为空 → 未生效
 * - set/edit 后读回不符合 schema → 校验失败
 * - delete 后读回仍有值 → 未删干净(读回空 = 删除成功,放行)
 *
 * 注:dataOps 写入(setByPath)同步更新值,readByPath 读底层值即可见新值,无需 nextTick。
 * @example createChatSdk({ capabilities:{verify:true}, verify:{ maxAttempts:1 } })  // check 省略 → 默认用本函数
 */
export function createWriteBackCheck(opts: WriteBackCheckOptions = {}): VerifyCheck {
  // root 优先于 window;支持 getter(适配 sdk.setData 运行时替换 bind)
  const rootRef: () => unknown =
    typeof opts.root === 'function' ? (opts.root as () => unknown)
    : opts.root !== undefined ? () => opts.root
    : () => opts.window ?? (globalThis as any).window
  // schemas 支持静态对象或 getter(单对象场景:键 '' → 整体 schema;每次 check 取最新)
  const schemasRef: () => Record<string, ZodType> =
    typeof opts.schemas === 'function' ? (opts.schemas as () => Record<string, ZodType>) : () => (opts.schemas ?? {}) as Record<string, ZodType>
  return async ({ messages }) => {
    const writes = extractWrites(messages)
    if (!writes.length) return { ok: true }
    const toolResults = collectToolResults(messages)
    const schemas = schemasRef()
    const rootSchema = schemas['']  // 单对象整体 schema(键 '')
    const root = rootRef()  // 每次 check 取最新 root(适配 sdk.setData 动态替换 bind)
    const issues: string[] = []
    for (const { path, op, callId } of writes) {
      // 写被 dataOps 合法拒绝 → 读回无值是预期,跳过(避免误报"未生效"误导 agent 去修一个本就该失败的写)
      const resultContent = callId ? toolResults.get(callId) : undefined
      if (resultContent && WRITE_REJECTED_RE.test(resultContent)) continue
      const current = readByPath(root, path)
      if (op === 'delete_data') {
        if (current !== undefined) issues.push(`${path} 删除后读回仍有值,疑似未生效`)
      } else {
        // set/edit/write:读回应有值 + 整体 schema 校验整个 root(单对象:任一字段非法都会致整体校验失败)
        if (current === undefined || current === null) {
          issues.push(`写入 ${path} 后读回为空,疑似未生效`)
        } else if (rootSchema) {
          const res = rootSchema.safeParse(root)
          if (!res.success) issues.push(`${path} 读回值不符合 schema:${res.error.issues?.[0]?.message ?? '校验失败'}`)
        }
      }
    }
    return issues.length ? { ok: false, feedback: issues.join(';\n') } : { ok: true }
  }
}

// ===== 对抗式验证(期四:spawn 找茬子 agent,refute 姿态)=====

/** 判定 llm 是模型实例(BaseChatModel)还是配置对象(与 subagent/createChatSdk 同逻辑) */
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
  tools?: unknown[],
): Promise<string | null> {
  const { lastUser, lastReply } = extractLastTurn(messages)
  if (!lastReply) return null // 无最终回复可审,放行
  const hasTools = Array.isArray(tools) && tools.length > 0
  const prompt = [
    '你是严格的对抗式审查者,目标是找出以下 AI 助手回复的错误并证明它有问题(事实错误 / 遗漏 / 逻辑矛盾 / 与需求不符)。',
    `用户需求:${lastUser || '(未明确)'}`,
    `助手回复:${lastReply}`,
    hasTools
      ? '重点检查主数据修改:① jsonPath 是否正确(是否误写不存在的子路径);② 值类型是否符合主数据 schema;③ 语义是否符合字段 description。可用只读工具(read / get_data / describe_data 等)读回实际值实证。'
      : '只报告具体、可验证的问题。',
    '若确实无问题,只回复"无问题"。',
  ].join('\n')
  const sys = '你是严格的对抗式审查者,只找问题不赞美。目标是反驳,不是改进。'
  // 对抗子 agent 的日志经 onLog 转发到主 debugLogs(带 source:'adversarial' 标签,调试面板可区分)
  const forwardLog = log ? (e: { type: string; data: unknown }) => log(e.type, { ...(e.data as object), source: 'adversarial' }) : undefined
  // 配只读工具 → 多轮实证审查(maxToolRounds 4);无工具 → 单轮文本审查(退化为现状)
  const child = createAgent(
    isChatModel(llm)
      ? { llm, tools: tools as any, maxToolRounds: hasTools ? 4 : 1, systemPrompt: sys, onLog: forwardLog }
      : { apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model, temperature: 0, maxTokens: llm.maxTokens, tools: tools as any, maxToolRounds: hasTools ? 4 : 1, systemPrompt: sys, onLog: forwardLog },
  )
  const verdict = await child.invoke([{ role: 'user', content: prompt, timestamp: Date.now() }])
  log?.('middleware', { stage: 'adversarial_verdict', verdict, source: 'adversarial' })
  return isAdversarialClean(verdict) ? null : verdict.trim()
}
