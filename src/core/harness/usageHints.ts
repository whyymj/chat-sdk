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
      if (hasWindowOps) {
        hints.push('修改大对象/数组属性优先用 edit_window_prop 增量 patch(只发改动部分),避免 set 整体重传被 max_tokens 截断导致 JSON 不完整、校验失败。')
        hints.push('修改属性出错时可用 restore_window_snapshot(path) 回退最近一次。')
        hints.push('在大数组里按条件筛选元素用 query_window_prop(JSONPath,如 $[?(@.type=="card" && @.price<100)]),返回匹配元素的 path/index;定位后再 edit_window_prop 改。')
        hints.push('找名字记不清的元素用 search_window_prop(支持 substring/regex/fuzzy 模糊搜索)。')
        hints.push('需要过滤/映射/聚合/批量重写大数组时用 eval_window_script(沙箱脚本,入参 data);只读探查用 mode=query,批量重写用 mode=transform(返回值经校验后落地)。')
      }
      if (caps?.subagent !== false) hints.push('独立子任务可 spawn_agent 委派(只读工具,过程不占主上下文)。')
      return hints.length ? '## 能力使用提示\n' + hints.join('\n') : undefined
    },
  }
}