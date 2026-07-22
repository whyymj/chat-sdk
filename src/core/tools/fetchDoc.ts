/**
 * GET 文档工具 —— 浏览器内抓取文档
 *
 * 现实约束:浏览器 fetch 仅能获取同源或服务端已配置 CORS 的资源,
 * 跨域会被拦截;跨域抓取需后端代理(本期不提供)。
 * 超长内容截断(可配合 vfs 外存做大结果处理)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const MAX_CHARS = 20000

export const fetchDocumentTool = tool(
  async ({ url, as }) => {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (!res.ok) {
        return `请求失败:HTTP ${res.status} ${res.statusText}(${url})`
      }
      const text = await res.text()
      const body =
        text.length > MAX_CHARS
          ? text.slice(0, MAX_CHARS) + `\n…[已截断,原长度 ${text.length}]`
          : text
      const fmt = as === 'markdown' ? 'markdown' : 'text'
      return `文档内容(${url},${fmt}):\n\n${body}`
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      // 浏览器跨域/网络错误通常表现为 "Failed to fetch" / "NetworkError"
      if (/Failed to fetch|NetworkError|CORS|blocked/i.test(msg)) {
        return `获取失败:可能是 CORS 跨域拦截或网络错误(${msg})。浏览器仅能 GET 同源或服务端已配置 CORS 的资源;跨域抓取需后端代理。`
      }
      return `获取失败:${msg}`
    }
  },
  {
    name: 'fetch_document',
    description:
      '以 GET 请求抓取文档/网页/接口文本。仅支持同源或已配置 CORS 的 URL;跨域会被浏览器拦截。',
    schema: z.object({
      url: z.string().describe('要抓取的 URL(同源或已配 CORS)'),
      as: z.enum(['text', 'markdown']).optional().describe('返回格式,默认 text'),
    }),
  },
)

export const fetchDocTools = [fetchDocumentTool]
