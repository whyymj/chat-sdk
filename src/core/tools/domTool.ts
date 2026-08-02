/**
 * DOM 读取工具 —— agent 读渲染后的页面 DOM 结构(胜任自动化 agent 的"看"能力)
 *
 * 定位:区别于 eval_script(沙箱内自由脚本,返回文本),get_dom 是**结构化、受限、深度可控**的只读工具:
 *  - 结构化 JSON 返回(LLM 易消费,vs eval_script 文本)
 *  - 只读 + 属性白名单(不执行脚本,默认不暴露全部 attribute,防敏感属性泄露)
 *  - 深度截断(防大 DOM 爆炸 token)
 *
 * 场景:agent 改完数据后回看渲染效果是否正确、定位元素、验证样式落地、辅助 UI 设计问答。
 * 大结果(超 offload 阈值)由 createAgent 的 coreExecTool 统一外存 vfs,本工具不自行截断。
 *
 * capabilities.domInspect 默认关闭(opt-in):读 DOM 有 token 成本,集成方按需开启。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/** 默认暴露的 attribute 白名单(不传 attrs 时);data-* 始终包含(业务标记常挂此)。
 * 注意:`value` 不进默认白名单 —— 表单 <input value>/<textarea> 可能含敏感数据(密码/token/PII),
 * 默认暴露会把敏感值灌入 LLM 上下文(进而可能被写数据/外发)。需要时集成方显式传 attrs:['value']。 */
const DEFAULT_ATTRS = ['id', 'class', 'href', 'src', 'alt', 'title', 'style', 'role', 'aria-label', 'name', 'type']

/** 硬禁 attr 名(即使 LLM 把它们加进 attrs 白名单也排除):value 表单值(密码/token/PII)、
 * on* 事件处理器(可嵌脚本)、srcdoc/formaction 可嵌脚本/改表单动作。
 * 安全审查(perf-security HIGH):attrs 是 LLM 可控入参,不硬禁则默认白名单形同虚设。 */
const DENY_ATTR_RE = /^(value|srcdoc|formaction|on\w+)$/i
/** 敏感命名 attr(token/key/secret/password/auth/cred/csrf/session,如 data-token / data-api-key / data-csrf):
 * 即使命中白名单也排除,防凭据泄漏。 */
const DENY_ATTR_SENSITIVE_RE = /token|secret|password|passwd|api[-_]?key|auth|cred|csrf|session/i

/** 结构化 DOM 节点 */
export interface DomNode {
  tag: string
  attrs: Record<string, string>
  /** 直接文本子节点(不含子孙节点文本,trim) */
  text?: string
  /** 子节点(按深度递归展开) */
  children?: DomNode[]
  /** 深度截断时的子节点数(未展开,仅报数量省 token) */
  childCount?: number
}

export interface DomReadOptions {
  /** 遍历深度(0 = 只根节点) */
  depth: number
  /** 属性白名单;不传 = DEFAULT_ATTRS + data-*;传了 = 严格白名单(不含 data-*) */
  attrs?: string[]
  /** 是否包含直接文本(默认 true) */
  includeText?: boolean
}

/**
 * 纯函数:DOM Element → 结构化 DomNode(可单测,传入 mock node)。
 * 与浏览器解耦,测试用 duck-typing 假对象(tagName/attributes/childNodes/children)。
 */
export function domToStructure(node: Element | null, opts: DomReadOptions): DomNode | null {
  if (!node) return null
  const { depth, attrs: attrWhitelist, includeText = true } = opts
  const strict = attrWhitelist !== undefined
  const allow = attrWhitelist ?? DEFAULT_ATTRS

  const pickAttrs = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const a of Array.from(el.attributes)) {
      const ok = strict ? allow.includes(a.name) : (allow.includes(a.name) || a.name.startsWith('data-'))
      if (!ok) continue
      // 硬 DENY(安全):即使 LLM 把敏感 attr 加进 attrs 白名单也排除,防表单值/凭据/脚本泄漏
      if (DENY_ATTR_RE.test(a.name) || DENY_ATTR_SENSITIVE_RE.test(a.name)) continue
      out[a.name] = a.value
    }
    return out
  }

  const walk = (el: Element, d: number): DomNode => {
    const result: DomNode = { tag: el.tagName.toLowerCase(), attrs: pickAttrs(el) }
    if (includeText) {
      // 直接文本子节点(nodeType 3 = TEXT_NODE),不含子孙文本
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent || '')
        .join('')
        .trim()
      if (direct) result.text = direct
    }
    const kids = Array.from(el.children)
    if (d > 0) {
      if (kids.length) result.children = kids.map((k) => walk(k, d - 1))
    } else if (kids.length) {
      // 深度截断:不展开,只报数量
      result.childCount = kids.length
    }
    return result
  }

  return walk(node, depth)
}

export const getDomTool = tool(
  ({ selector, depth, attrs, includeText }) => {
    const root = selector ? document.querySelector(selector) : document.body
    if (!root) return `未找到匹配元素:selector="${selector}"`
    const struct = domToStructure(root, {
      depth: depth ?? 3,
      attrs,
      includeText: includeText ?? true,
    })
    if (!struct) return `selector="${selector}" 未匹配到元素`
    return JSON.stringify(struct, null, 2)
  },
  {
    name: 'get_dom',
    description:
      '读取页面渲染后的 DOM 结构(结构化返回 tag/attrs/text/children)。用于检查实际渲染效果、定位元素、验证修改是否生效(改完数据看页面是否如期变化)。depth 控制遍历深度(默认 3,防大 DOM 爆 token),attrs 限定返回属性(默认 id/class/style/href 等常用 + data-*)。大结果自动外存 vfs。',
    schema: z.object({
      selector: z.string().optional().describe('CSS 选择器(默认 body,读整个页面)'),
      depth: z.number().int().min(0).max(10).optional().describe('遍历深度(默认 3;0 只读根节点)'),
      attrs: z.array(z.string()).optional().describe('属性白名单(传了 = 严格白名单;不传 = 默认常用 + data-*)'),
      includeText: z.boolean().optional().describe('是否包含直接文本(默认 true)'),
    }),
  },
)

/** DOM 读取工具集(静态数组,随 capabilities.domInspect 装配) */
export const domTools = [getDomTool]
