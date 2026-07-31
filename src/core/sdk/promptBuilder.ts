/**
 * System prompt 构建纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction)。
 * 含 DEFAULT_SYSTEM_PROMPT + buildDataPrompt(可操作数据段)+ buildSystemPrompt(统一入口)。
 *
 * buildSystemPrompt 为纯函数(结构化入参,无闭包依赖),便于后续 fix-introspection-consistency 的
 * getEffectiveSystemPrompt 复用 —— prompt 拼装收敛为单一真相源。
 */
import { systemPromptHelpers, extractSchemaHint } from '../presets'
import type { DataConfig } from '../tools/dataOps'

/**
 * 默认 systemPrompt —— 用户未传 systemPrompt 时使用。
 * 定位:通用「JSON 操作助手」(规范化 JSON 操作 agent)——通过专用工具安全读写集成方声明的主数据对象(bind)。
 * 含身份 + 能力概述 + 可靠写入规则(改前先读、动态先查、字段以工具返回为准、写错看校验错误重试、优先增量 patch)。
 * 用户传了 systemPrompt 则完全覆盖此默认;默认 appendReliableWriteRules:true,会在自定义 systemPrompt 末尾用 '---' 分隔线追加 reliableWriteRules(避免集成方忘写写入规则);设 false 关闭。
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是一个 JSON 操作助手。集成方声明了一个主数据对象(含 zod schema 校验),你通过专用工具安全地读写它来完成任务。',
  '所有写操作都经范围控制(仅 schema 声明字段内)与 schema 校验(不合法会返回结构化错误而非写入),并自动留快照可回退。',
  '大对象/数组优先用增量 patch(只发改动)而非整体重传,避免输出被截断。',
  '---',
  systemPromptHelpers.reliableWriteRules,
].join('\n\n')

/** 拼接「可操作数据」段到 systemPrompt:从 data 的 schema 字段 .describe() 自动提取注入 */
export function buildDataPrompt(data: DataConfig | undefined): string {
  if (!data) return ''
  const hint = extractSchemaHint(data.schema)
  return `\n\n## 可操作数据(字段以 read 工具返回的实际值为准)\n${data.description ? data.description + '\n' : ''}${hint}`
}

/**
 * 统一 systemPrompt 的 base 段入口:处理 appendReliableWriteRules 分支 + '---' 分割线。
 *  - 传 systemPrompt:默认末尾追加 reliableWriteRules(用 '---' 分隔用户内容与 SDK 追加的写入规则);设 appendReliableWriteRules:false 则不追加
 *  - 不传 systemPrompt:用 DEFAULT_SYSTEM_PROMPT(已内置 reliableWriteRules,不重复追加)
 * 纯函数(结构化入参,无闭包依赖),返回值不含「可操作数据」段(该段由 dataHint 中间件每轮动态拼)。
 */
export function buildSystemPrompt(opts: { systemPrompt?: string; appendReliableWriteRules?: boolean }): string {
  const appendRwr = opts.appendReliableWriteRules !== false
  return opts.systemPrompt
    ? (appendRwr ? opts.systemPrompt + '\n\n---\n\n' + systemPromptHelpers.reliableWriteRules : opts.systemPrompt)
    : DEFAULT_SYSTEM_PROMPT
}
