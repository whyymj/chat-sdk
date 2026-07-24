/**
 * 上下文压缩预设档位 —— 降低配置学习难度,对特殊情况保持灵活
 *
 * 普通场景选档(contextPreset)即可;特殊情况经 contextOptions 细参覆盖个别字段。
 * 默认 'auto':按模型窗口自适应,LLM 摘要 + 关键词召回。
 */
import type { ContextManagerOptions } from '../composables/useContextManager'

export type ContextPreset = 'auto' | 'conservative' | 'aggressive'

/**
 * - auto:默认,按模型窗口自适应;LLM 摘要 + 召回 Top-3;触发阈值 0.5、窗口 0.4
 * - conservative:大模型/省成本;更晚触发(0.7)、保留更多近期(0.5)、召回 Top-2、用零成本索引摘要(关 LLM)
 * - aggressive:小模型/省上下文;更早触发(0.3)、保留少(0.3)、召回 Top-5、LLM 摘要更连贯压缩
 */
export const CONTEXT_PRESETS: Record<ContextPreset, Partial<ContextManagerOptions>> = {
  auto: { summaryThresholdRatio: 0.5, windowRatio: 0.4, recallTopK: 3, enableRecall: true },
  conservative: { summaryThresholdRatio: 0.7, windowRatio: 0.5, recallTopK: 2, enableRecall: true, enableLLMSummary: false },
  aggressive: { summaryThresholdRatio: 0.3, windowRatio: 0.3, recallTopK: 5, enableRecall: true, enableLLMSummary: true },
}

export interface ContextOptionsInput {
  contextPreset?: ContextPreset
  contextOptions?: Partial<ContextManagerOptions> | false
}

/**
 * 解析压缩配置:预设档位(默认 auto)提供合理默认 → contextOptions 细参覆盖个别字段 → contextWindow/enableLLMSummary 兜底。
 * 纯函数,可单测。
 */
export function resolveContextOptions(
  options: ContextOptionsInput,
  modelContextWindow: number,
): Partial<ContextManagerOptions> {
  const preset = CONTEXT_PRESETS[options.contextPreset ?? 'auto'] ?? {}
  const userOpts = options.contextOptions === false ? {} : (options.contextOptions ?? {})
  return {
    ...preset,
    ...userOpts,
    contextWindow: userOpts.contextWindow ?? modelContextWindow,
    enableLLMSummary: userOpts.enableLLMSummary ?? preset.enableLLMSummary ?? true,
  }
}
