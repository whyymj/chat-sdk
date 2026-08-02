/**
 * 环境探查工具 —— agent 读取宿主 window 环境信息(胜任排查调试的"看环境"能力)
 *
 * 定位:区别于 get_dom(读 DOM 结构,深度遍历,opt-in,有 token 成本),inspect_env 是**轻量、默认开启**的环境探测:
 *  - 无参:返回 window 安全摘要(location / navigator / viewport / document),不用传参即可用
 *  - key 参:读指定 window[key](集成方可挂调试变量,如 window.__DEBUG__ / window.appConfig 供 agent 排查)
 *  - 安全:safeSerialize 跳过 function/symbol/bigint/DOM 节点;WeakSet 防循环引用;getter try/catch;限深度/键数/字符串长度
 *
 * 场景:排查「当前页面 URL/浏览器/视口」「集成方调试变量值」「页面是否在正确环境」「为何没生效(看环境状态)」。
 * capabilities.inspectEnv 默认开(轻量只读,排查刚需);`false` 关。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/** DOM-like 判定(不引 window/Element 全局,纯形状判断,便于 Node 单测) */
function isDomLike(v: object): boolean {
  const o = v as { tagName?: unknown; nodeType?: unknown; nodeName?: unknown }
  return typeof o.tagName === 'string' ||
    (typeof o.nodeType === 'number' && typeof o.nodeName === 'string')
}

/**
 * 安全序列化任意值(给 LLM 看):跳过 function/symbol/bigint/DOM 节点;WeakSet 防循环引用;
 * 限深度 + 键数(≤50)+ 字符串长度(≤maxLen);getter try/catch 防 getter 抛错中断。
 * 纯函数(不依赖 window),可单测。
 */
export function safeSerialize(value: unknown, depth = 3, maxLen = 2000, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > maxLen ? value.slice(0, maxLen) + '…(已截断)' : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'function') return `[Function: ${(value as { name?: string }).name || 'anonymous'}]`
  if (typeof value === 'symbol') return (value as symbol).toString()
  if (typeof value === 'bigint') return `${(value as bigint).toString()}n`
  if (typeof value !== 'object') return String(value)
  // 对象类型
  const obj = value as object
  if (isDomLike(obj)) {
    const o = obj as { tagName?: string; nodeName?: string }
    return o.tagName ? `[Element: <${o.tagName.toLowerCase()}>]` : `[Node: ${o.nodeName}]`
  }
  if (seen?.has(obj)) return '[Circular]'
  const next = seen ?? new WeakSet<object>()
  next.add(obj)
  if (Array.isArray(value)) {
    const arr = value.slice(0, 100).map((x) => safeSerialize(x, depth - 1, maxLen, next))
    if (value.length > 100) arr.push(`…(共 ${value.length} 项,已截断)`)
    return arr
  }
  if (depth < 0) return '(对象,已截断)'
  const out: Record<string, unknown> = {}
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (i >= 50) { out['…'] = `(共 ${keys.length} 键,已截断)`; break }
    try {
      out[k] = safeSerialize((obj as Record<string, unknown>)[k], depth - 1, maxLen, next)
    } catch {
      out[k] = '(getter 抛错)'
    }
  }
  return out
}

/**
 * 环境摘要(无参时返回)。接受可选 win 参数(默认全局 window;测试可传 mock,Node 环境无 window 时退化为空)。
 */
export function getEnvSummary(win?: Window & typeof globalThis): Record<string, unknown> {
  const fallback = {} as Window & typeof globalThis
  const w = win ?? (typeof window !== 'undefined' ? window : fallback)
  const nav = w.navigator
  const loc = w.location
  const doc = w.document
  return {
    location: {
      href: loc?.href, origin: loc?.origin, protocol: loc?.protocol,
      host: loc?.host, hostname: loc?.hostname, pathname: loc?.pathname, search: loc?.search,
    },
    navigator: {
      userAgent: nav?.userAgent, language: nav?.language, languages: nav?.languages,
      platform: nav?.platform, onLine: nav?.onLine,
    },
    viewport: {
      innerWidth: w.innerWidth, innerHeight: w.innerHeight,
      devicePixelRatio: w.devicePixelRatio, scrollX: w.scrollX, scrollY: w.scrollY,
    },
    document: doc ? {
      title: doc.title, readyState: doc.readyState, characterSet: doc.characterSet,
    } : '(无 document)',
  }
}

export const inspectEnvTool = tool(
  ({ key }) => {
    if (key) {
      const w = (typeof window !== 'undefined' ? window : {}) as Record<string, unknown>
      const value = w[key]
      return JSON.stringify({
        key, exists: value !== undefined, type: typeof value, value: safeSerialize(value),
      }, null, 2)
    }
    return JSON.stringify(getEnvSummary(), null, 2)
  },
  {
    name: 'inspect_env',
    description:
      '读取宿主页面环境信息(排查调试用,默认开启)。不传参 = 返回环境摘要(location 的 URL/origin/path、navigator 的浏览器/语言、viewport 视口尺寸、document 的 title/readyState);传 key = 读取指定 window 属性值(如 inspect_env({key:"appConfig"}) 读集成方挂的调试变量 window.appConfig)。用于排查「当前页面在哪/什么浏览器/视口多大/调试变量值是什么」。轻量只读,大结果自动外存 vfs。',
    schema: z.object({
      key: z.string().optional().describe('要读取的 window 属性名(如 "appConfig"/"__DEBUG__");不传 = 返回环境摘要'),
    }),
  },
)

/** 环境探查工具集(静态数组,随 capabilities.inspectEnv 默认装配) */
export const inspectTools = [inspectEnvTool]
