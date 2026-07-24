/**
 * 能力用法提示中间件 —— 各内置能力开启时,向 system prompt 注入一行简短用法引导。
 *
 * 设计(design §4):
 *  - 克制:仅在该能力开启时注入对应提示,一行/能力;全部关闭时返回 undefined(不增上下文)。
 *  - 由 createChatSdk 构造(它知道 caps),非各能力中间件自注入(中间件不感知 caps)。
 *  - 装载栈最前 → 其 augmentPrompt 段紧跟 base systemPrompt。
 *  - 绝不覆盖集成方 systemPrompt(拼接在其后,由 buildSystemPrompt 组装)。
 */
import type { Middleware } from './middleware'

/** capabilities 子集(仅用法提示相关开关) */
type HintCapabilityFlags = { planning?: boolean; windowOps?: boolean; subagent?: boolean }

/**
 * @param caps 能力开关(planning / windowOps / subagent)
 * @param hasWindowOps 是否实际装了 window 操作工具(用于判断 snapshot 回退提示是否有意义)
 */
export function createUsageHintsMiddleware(caps: HintCapabilityFlags | undefined, hasWindowOps: boolean): Middleware {
  return {
    name: 'usageHints',
    augmentPrompt: () => {
      const hints: string[] = []
      if (caps?.planning !== false) hints.push('多步任务建议先 write_todos 拆解为步骤并逐步推进。')
      if (hasWindowOps) hints.push('修改属性出错时可用 restore_window_snapshot(path) 回退最近一次。')
      if (caps?.subagent !== false) hints.push('独立子任务可 spawn_agent 委派(只读工具,过程不占主上下文)。')
      return hints.length ? '## 能力使用提示\n' + hints.join('\n') : undefined
    },
  }
}