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
    hint: `按 describe_data_slot("${path}") 查看格式,修正后重试;改大对象优先用 edit_data_slot 增量 patch(只发改动部分)`,
    details: formatZodIssues(issues),
  })
}

/** JSON 解析失败 → toolError,带原解析错误 */
export function jsonParseError(path: string | undefined, raw: string, err: unknown): string {
  const msg = (err as Error)?.message || String(err)
  return toolError({
    code: 'JSON_PARSE',
    ...(path !== undefined ? { path } : {}),
    message: `value 不是合法 JSON:${msg}`,
    hint: `检查引号/逗号/括号是否闭合;字符串值需双引号包裹(如 '"dark"' 表示字符串 dark,数字直接写如 5);预览前 80 字符:${raw.slice(0, 80)}`,
  })
}
