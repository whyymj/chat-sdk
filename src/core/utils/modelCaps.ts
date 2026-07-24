/**
 * 模型能力解析 + token 估算 —— 让阈值自适应模型,而非固定字数/轮数
 *
 * 上下文窗口与最大输出是两个独立维度(如 DeepSeek-Chat 128K 上下文 / 8K 输出),
 * 固定阈值会导致:1M 模型过早压缩丢信息、8K 模型过晚压缩 OOM、maxTokens 设错被截断。
 *
 * 能力来源(优先级链):集成方显式声明 > 内置模型表按 model 名匹配 > 保守缺省。
 * token 估算:浏览器无 tiktoken,用中文字符 ~1.5 token、其余 ~0.25 token 的粗略近似,够用不求精确。
 */

export interface ModelCaps {
  /** 模型上下文窗口(token) */
  contextWindow: number
  /** 模型最大输出(token) */
  maxOutputTokens: number
}

/**
 * 内置常见模型表(first-match,model 名子串匹配,大小写不敏感)。
 * 数字随厂商升级会变,仅作兜底;集成方显式声明优先覆盖。
 */
const MODEL_TABLE: Array<{ pattern: RegExp; caps: ModelCaps }> = [
  { pattern: /deepseek-reasoner|deepseek-r1/i, caps: { contextWindow: 65536, maxOutputTokens: 8192 } },
  { pattern: /deepseek/i, caps: { contextWindow: 131072, maxOutputTokens: 8192 } },
  { pattern: /gpt-4\.1/i, caps: { contextWindow: 1047576, maxOutputTokens: 32768 } },
  { pattern: /gpt-4o-mini/i, caps: { contextWindow: 131072, maxOutputTokens: 16384 } },
  { pattern: /gpt-4o/i, caps: { contextWindow: 131072, maxOutputTokens: 16384 } },
  { pattern: /gpt-4-turbo|gpt-4-1106|gpt-4-0125/i, caps: { contextWindow: 131072, maxOutputTokens: 4096 } },
  { pattern: /gpt-3\.5/i, caps: { contextWindow: 16385, maxOutputTokens: 4096 } },
  { pattern: /claude-3-7-sonnet/i, caps: { contextWindow: 200000, maxOutputTokens: 8192 } },
  { pattern: /claude-3-5-sonnet/i, caps: { contextWindow: 200000, maxOutputTokens: 8192 } },
  { pattern: /claude-3-opus/i, caps: { contextWindow: 200000, maxOutputTokens: 4096 } },
  { pattern: /claude-3-haiku/i, caps: { contextWindow: 200000, maxOutputTokens: 4096 } },
  { pattern: /qwen-max|qwen2\.5|qwen-plus/i, caps: { contextWindow: 131072, maxOutputTokens: 8192 } },
  { pattern: /glm-4|glm4|glm-4\.5/i, caps: { contextWindow: 131072, maxOutputTokens: 8192 } },
  { pattern: /moonshot|kimi/i, caps: { contextWindow: 131072, maxOutputTokens: 8192 } },
  { pattern: /yi-34b|yi-large/i, caps: { contextWindow: 32768, maxOutputTokens: 4096 } },
]

/** 保守缺省(未知模型按 32K 上下文 / 4K 输出,避免大模型假设导致 OOM) */
export const DEFAULT_CAPS: ModelCaps = { contextWindow: 32768, maxOutputTokens: 4096 }

export interface ResolveCapsOptions {
  /** 模型名(查表用) */
  model?: string
  /** 集成方显式声明:上下文窗口(优先) */
  contextWindow?: number
  /** 集成方显式声明:最大输出(优先) */
  maxOutputTokens?: number
}

/**
 * 解析模型能力:声明优先 > 模型表 > 缺省。
 * 声明值与表值取较大者(集成方可能更了解自家模型上限)。
 */
export function resolveModelCaps(opts: ResolveCapsOptions = {}): ModelCaps {
  const fromTable = (() => {
    if (!opts.model) return undefined
    const hit = MODEL_TABLE.find((e) => e.pattern.test(opts.model!))
    return hit?.caps
  })()
  const contextWindow = opts.contextWindow ?? fromTable?.contextWindow ?? DEFAULT_CAPS.contextWindow
  const maxOutputTokens = opts.maxOutputTokens ?? fromTable?.maxOutputTokens ?? DEFAULT_CAPS.maxOutputTokens
  return { contextWindow, maxOutputTokens }
}

/**
 * 粗略 token 估算(浏览器无 tiktoken):中文字符 ~1.5 token,其余 ~0.25 token。
 * 用于压缩触发/窗口预算,不要求精确,只求量级正确。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.5 + other * 0.25)
}

/** 多条文本 token 估算总和 */
export function estimateTokensMany(texts: string[]): number {
  return texts.reduce((s, t) => s + estimateTokens(t), 0)
}

/**
 * 大结果外存阈值(字符数):按上下文 1% 推导(token→字符 ×3.5),clamp [2000, 20000]。
 * - 1M 上下文 → 20000(上限,避免单工具结果占太多)
 * - 128K → ~4480
 * - 32K → 2000(下限,避免正常小结果频繁外存)
 */
export function offloadThresholdChars(contextWindow: number): number {
  return Math.max(2000, Math.min(20000, Math.round(contextWindow * 0.035)))
}

/**
 * vfs 不可用时的放行上限(字符数):按上下文 20% 推导(token→字符 ×3.5),clamp [offloadThreshold, 200000]。
 * - vfs 不可用时不再固定截断:结果 ≤ 此上限则完整进上下文(信任大模型容量,避免丢信息),
 *   超过才截断兜底。
 * - 1M 上下文 → 200000(上限,~57K token,占 5.7%)
 * - 128K → ~91750(~26K token,占 20%)
 * - 32K → ~22937(~6.5K token,占 20%)
 * 下限取 offloadThreshold,保证放行上限 ≥ 外存阈值(否则 vfs 不可用比可用更早截断)。
 */
export function offloadPassThroughChars(contextWindow: number): number {
  const threshold = offloadThresholdChars(contextWindow)
  return Math.min(200000, Math.max(threshold, Math.round(contextWindow * 0.7)))
}
