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
 * 内置常见模型表(longest-match:model 名子串匹配,大小写不敏感;多命中取 pattern 源字符串最长的条目 = 最具体)。
 * 数字随厂商升级会变,仅作兜底;集成方显式声明优先覆盖。
 */
const MODEL_TABLE: Array<{ pattern: RegExp; caps: ModelCaps }> = [
  { pattern: /deepseek-v4/i, caps: { contextWindow: 1048576, maxOutputTokens: 393216 } }, // v4:1M 上下文 / 384K 输出
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
  { pattern: /qwen-max|qwen-plus/i, caps: { contextWindow: 32768, maxOutputTokens: 8192 } }, // Qwen-Max/Plus:默认 32K(128K 需申请)/ 8K 输出
  { pattern: /qwen2\.5-1m|qwen-1m/i, caps: { contextWindow: 1048576, maxOutputTokens: 8192 } }, // Qwen2.5-1M:1M / 8K
  { pattern: /qwen2\.5/i, caps: { contextWindow: 32768, maxOutputTokens: 8192 } }, // Qwen2.5:默认 32K / 8K
  { pattern: /glm-5\.2/i, caps: { contextWindow: 1048576, maxOutputTokens: 65536 } }, // GLM-5.2:1M / 64K
  { pattern: /glm-5/i, caps: { contextWindow: 200000, maxOutputTokens: 65536 } }, // GLM-5/5.1:200K / 64K
  { pattern: /glm-4\.[6-9]/i, caps: { contextWindow: 131072, maxOutputTokens: 131072 } }, // GLM-4.6/4.7:128K / 128K 输出
  { pattern: /glm-4\.5/i, caps: { contextWindow: 131072, maxOutputTokens: 98304 } }, // GLM-4.5:128K / 96K 输出
  { pattern: /glm-4|glm4/i, caps: { contextWindow: 131072, maxOutputTokens: 4096 } }, // GLM-4:128K / 4K
  { pattern: /kimi-k3/i, caps: { contextWindow: 1048576, maxOutputTokens: 65536 } }, // Kimi K3:1M / 64K
  { pattern: /kimi-k2|kimi|moonshot/i, caps: { contextWindow: 262144, maxOutputTokens: 32768 } }, // Kimi K2/Moonshot:256K / 32K
  { pattern: /yi-34b|yi-large/i, caps: { contextWindow: 32768, maxOutputTokens: 4096 } },
]

/** 保守缺省(未知模型按 32K 上下文 / 4K 输出,避免大模型假设导致 OOM) */
export const DEFAULT_CAPS: ModelCaps = { contextWindow: 32768, maxOutputTokens: 4096 }

/**
 * 最小支持上下文窗口(harden-context-resilience):contextWindow < 此值 → throw。
 * 排除小窗口模型(128K 档主流如 DeepSeek/GPT-4o/GLM-4.6 亦不满足),强制用 ≥200K 大窗口模型
 * (GLM-5.2 1M / Claude 200K / Kimi 256K+ / Qwen-1M / DeepSeek-v4 1M)。
 * 设计假设窗口 ≥ 此值:全局预算宽松、单条超窗口几乎不可能、压缩/offload 阈值有余量。
 */
export const MIN_CONTEXT_WINDOW = 200000

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
    // longest-match:按"实际匹配到的子串长度"降序取最具体的 —— 用匹配长度而非 pattern.source.length(后者会被 | 分支数虚高,如 `glm-4|glm4` source 长 9 但只匹配 `glm-4` 5 字符,反而压过更具体的 `glm-4.5`)。消除 first-match 顺序依赖(harden-model-caps-matching)
    const hits = MODEL_TABLE
      .map((e) => {
        const m = e.pattern.exec(opts.model!)
        return m ? { caps: e.caps, matchedLen: m[0].length } : null
      })
      .filter((x): x is { caps: ModelCaps; matchedLen: number } => x !== null)
    if (!hits.length) return undefined
    hits.sort((a, b) => b.matchedLen - a.matchedLen)
    return hits[0].caps
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
 * vfs 不可用时的放行上限(字符数):等价于 token 窗口的 20%(1 token≈3.5 字符 → 代码用 0.7 字符倍率实现),clamp [offloadThreshold, 200000]。
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
