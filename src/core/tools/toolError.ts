/**
 * 统一工具错误格式 —— 结构化、可操作,供 LLM 程序化排查
 *
 * 设计:
 *  - 所有工具错误统一返回 `ERROR: {json}`(单行 JSON,前缀 ERROR),LLM 一眼识别且可解析 details
 *  - 含错误码(error,机器可读蛇形大写)+ 人类可读 message + 可操作 hint(怎么修)+ 相关 path + 结构化 details
 *  - zod 校验失败:提取 issues 成 details(每条 path/expected/received/message),而非一长串 zod message
 *  - JSON 解析失败:带原解析错误(位置)
 *
 * LLM 排查路径:看 error 分类 → 看 message 细节 → 看 details 定位 → 按 hint 修复重试
 */

export interface ToolErrorInput {
  /** 机器可读错误码(大写蛇形),LLM 据此分类处理 */
  code: string
  /** 人类可读:具体发生了什么 */
  message: string
  /** 建议的修复动作(可操作) */
  hint?: string
  /** 相关属性路径 */
  path?: string
  /** 额外结构化细节(zod issues / 匹配位置 / 实际值等) */
  details?: unknown
}

/** 格式化工具错误为 `ERROR: {json}` 字符串 */
export function toolError(e: ToolErrorInput): string {
  const obj: Record<string, unknown> = { error: e.code, message: e.message }
  if (e.path !== undefined) obj.path = e.path
  if (e.hint) obj.hint = e.hint
  if (e.details !== undefined) obj.details = e.details
  return `ERROR: ${JSON.stringify(obj)}`
}

/** 提取 zod 校验失败 issues 为结构化 details(每条:路径/期望/实际/消息/码),最多 10 条 */
export function formatZodIssues(issues: unknown[]): unknown[] {
  return issues.slice(0, 10).map((raw) => {
    const iss = raw as Record<string, unknown>
    const path = Array.isArray(iss.path) ? iss.path.join('.') : String(iss.path ?? '')
    const out: Record<string, unknown> = { path: path || '(root)', message: iss.message }
    if (iss.expected !== undefined) out.expected = iss.expected
    if (iss.received !== undefined) out.received = iss.received
    if (iss.code !== undefined) out.code = iss.code
    return out
  })
}

/** zod 校验失败 → toolError(常用,封装一次) */
export function zodError(path: string, issues: unknown[]): string {
  return toolError({
    code: 'SCHEMA_INVALID',
    path,
    message: `值不符合 "${path}" 的 schema(${issues.length} 处问题)`,
    hint: `用 read({jsonPath:"${path}"}) 查看当前值,按 describe_data() 查看主数据 schema,修正后重试;改大对象优先用 write 的 patch 增量(只发改动部分)`,
    details: formatZodIssues(issues),
  })
}

/** JSON 解析失败 → toolError,带原解析错误 */
export function jsonParseError(path: string | undefined, raw: unknown, err: unknown): string {
  const msg = (err as Error)?.message || String(err)
  const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return toolError({
    code: 'JSON_PARSE',
    ...(path !== undefined ? { path } : {}),
    message: `value 不是合法 JSON:${msg}`,
    hint: `检查引号/逗号/括号是否闭合;字符串值需双引号包裹(如 '"dark"' 表示字符串 dark,数字直接写如 5);预览前 80 字符:${rawStr.slice(0, 80)}`,
  })
}

// ============ 统一错误模型(unify-error-model)============
// 三档 severity,把"错误该不该中断/回灌/外发"做成显式 AgentError.severity,各 catch 点按档路由。
// 默认 Error = fatal(保守:未显式分类的错误视为需中断,暴露问题优于静默吞);observable 必须显式声明。
// toolError 产出的 ERROR: 字符串本身就是 recoverable 载体(工具返回内容回灌 LLM),协议不变。

/** 错误严重程度三档:recoverable(回灌 LLM 自纠)/ fatal(emit error + 中断)/ observable(记日志不中断) */
export type ErrorSeverity = 'recoverable' | 'fatal' | 'observable'

/** 统一错误对象(结构化,跨层传递;普通 Error 经 asAgentError 归一化) */
export interface AgentError {
  severity: ErrorSeverity
  message: string
  code?: string
  context?: unknown
}

/** 错误路由:recoverable→feedback(回灌)/ fatal→abort(中断)/ observable→log(记录不中断) */
export type ErrorRouting = 'feedback' | 'abort' | 'log'

/**
 * 路由纯函数:据 severity 返回 feedback / abort / log。
 *
 * ⚠️ 框架内置 catch 点(coreExecTool / afterAgent / emit / invoke)当前用**简化硬编码路由**,**未消费本函数**。
 *   本函数作为公共工具导出:① 供集成方自定义中间件 catch 按 severity 决策;② 为未来 `wrapToolCall` 执行器
 *   实现 `AgentError(recoverable)→feedback` 自动路由预留扩展口(届时在执行器接通,catch 点/接口零改动)。
 *   保留导出(不删)= 为后续功能升级留低改动面接通路径(见 change fix-unify-error-half-done)。
 */
export function routeError(err: AgentError): ErrorRouting {
  if (err.severity === 'recoverable') return 'feedback'
  if (err.severity === 'fatal') return 'abort'
  return 'log'
}

/** 把任意错误归一化为 AgentError:已是 AgentError(含 severity+message)则原样返回不覆盖;普通 Error 用 defaultSeverity(默认 fatal) */
export function asAgentError(err: unknown, defaultSeverity: ErrorSeverity = 'fatal'): AgentError {
  if (err && typeof err === 'object' && 'severity' in err && typeof (err as AgentError).severity === 'string' && 'message' in err) {
    return err as AgentError
  }
  const message = err instanceof Error ? err.message : String(err)
  return { severity: defaultSeverity, message, context: err }
}

/** AgentError 便捷工厂 */
export function agentError(severity: ErrorSeverity, message: string, code?: string, context?: unknown): AgentError {
  return { severity, message, code, context }
}
