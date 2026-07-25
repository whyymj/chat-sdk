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
type HintCapabilityFlags = {
  planning?: boolean
  windowOps?: boolean
  subagent?: boolean
  humanConfirm?: boolean
  /** 预声明子 agent(用于注入"规划-反思-执行"路由提示;空则不注入) */
  subagents?: { id: string; description: string; temperature?: number }[]
}

/** 高温阈值:≥0.7 视为创意/规划型子 agent */
const CREATIVE_TEMP = 0.7

/**
 * @param caps 能力开关(planning / windowOps / subagent / humanConfirm / subagents)
 * @param hasWindowOps 是否实际装了 window 操作工具(用于判断 snapshot 回退提示是否有意义)
 */
export function createUsageHintsMiddleware(caps: HintCapabilityFlags | undefined, hasWindowOps: boolean): Middleware {
  return {
    name: 'usageHints',
    augmentPrompt: () => {
      const hints: string[] = []
      if (caps?.planning !== false) hints.push('多步任务建议先 write_todos 拆解为步骤并逐步推进。')
      if (hasWindowOps) {
        hints.push('不确定可操作哪些属性时用 list_window_props 查看(动态组件场景下注册表会增删,以工具返回为准,勿凭旧记忆);不确定某属性字段结构时用 describe_window_prop。')
        hints.push('改属性前先 get_window_prop 读其当前真实值,基于真实值改,不要凭记忆。')
        hints.push('修改大对象/数组属性优先用 edit_window_prop 增量 patch(只发改动部分),避免 set 整体重传被 max_tokens 截断导致 JSON 不完整、校验失败。')
        hints.push('修改属性出错时可用 restore_window_snapshot(path) 回退最近一次。')
        hints.push('在大数组里按条件筛选元素用 query_window_prop(JSONPath,如 $[?(@.type=="card" && @.price<100)]),返回匹配元素的 path/index;定位后再 edit_window_prop 改。')
        hints.push('找名字记不清的元素用 search_window_prop(支持 substring/regex/fuzzy 模糊搜索)。')
        hints.push('需要过滤/映射/聚合/批量重写大数组时用 eval_window_script(沙箱脚本,入参 data);只读探查用 mode=query,批量重写用 mode=transform(返回值经校验后落地)。')
      }
      if (caps?.subagent !== false) hints.push('独立子任务可 spawn_agent 委派(只读工具,过程不占主上下文)。')
      if (caps?.subagents?.length) {
        // 按 temperature 识别角色:高温=创意规划,低温=反思审查,未配温度按 description 关键词兜底
        const planners = caps.subagents.filter((s) => (s.temperature ?? 0) >= CREATIVE_TEMP || /规划|创意|设计|方案|brainstorm|plan/i.test(s.description))
        const reflectors = caps.subagents.filter((s) => (s.temperature ?? 0) < CREATIVE_TEMP && /反思|审查|挑刺|校验|review|critique|reflect/i.test(s.description))
        hints.push('【规划-反思-执行·路由】按任务性质选模式,不要对简单任务过度编排:')
        if (planners.length) {
          hints.push(
            `  · 创作/设计/开放性需求(如"设计主题风格""换个感觉")→ 先调 ${planners.map((s) => 'use_' + s.id).join('/')} 出 2-3 套方案(高温创意),`,
          )
          hints.push('    不要自己拍板;拿到方案后,若需用户拍板用 request_human_confirmation 弹选项。')
        }
        if (reflectors.length) {
          hints.push(`  · 严谨/易错/校验类 → 可先调 ${reflectors.map((s) => 'use_' + s.id).join('/')} 反思挑刺(低温审查),据反馈修订。`)
        }
        hints.push('  · 方案定稿后,由你(主 agent)用 edit_window_prop 落地成 JSON(低温度执行 + schema 校验 + 写前确认)。')
        hints.push('  · 简单/明确任务(如"标题改红色")直接执行,不必走规划-反思。')
      }
      if (caps?.humanConfirm) {
        hints.push('【人工确认·必读】以下情形必须先调 request_human_confirmation 征询用户、拿到答复后再继续,不要自行拍板:')
        hints.push('  1) 用户让你「给方案/列选项/我来选/挑一个」时:把每个方案作为一个 option,调 request_human_confirmation(question=简述, options=[方案A,方案B,...], recommendation=你推荐的)。不要只回文字罗列方案让用户自己回复——要用工具把选项做成可点选按钮。')
        hints.push('  2) 需求有歧义/不确定时:调工具问清楚(options 不传则用户答同意或拒绝)。')
        hints.push('  3) 即将执行高风险不可逆操作(删除/覆盖/批量改动)前:调工具确认。')
        hints.push('用户在选项里选了哪个,就按那个方案继续;选「拒绝」则停止并询问如何调整。')
      }
      return hints.length ? '## 能力使用提示\n' + hints.join('\n') : undefined
    },
  }
}