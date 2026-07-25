/**
 * MCP(Model Context Protocol)client —— 连远程 MCP server,动态把其 tools 转为 page-agent-sdk 工具。
 *
 * - **动态 import**:仅 options.mcp 提供时加载 @modelcontextprotocol/sdk(不用 MCP 不拉 SDK,不强求所有用户装)。
 * - **浏览器仅远程 transport**:`http`(StreamableHTTP,fetch)/ `websocket`(原生 WebSocket)/ `sse`(需 eventsource,浏览器可能要 polyfill)。不支持 stdio(无 node:child_process)。
 * - **零转换**:MCP tool 的 inputSchema(标准 JSON Schema)直传 LangChain tool()(@langchain/core 原生支持 JSON Schema 作 schema),无需 JSON Schema→Zod。
 *
 * SDK 子路径说明(1.29):主入口 `.` 无 index,Client 从 `@modelcontextprotocol/sdk/client`,transport 从
 * `@modelcontextprotocol/sdk/client/<name>.js`(exports `./*` 通配)。
 */
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { Client } from '@modelcontextprotocol/sdk/client'

export type McpTransport = 'http' | 'sse' | 'websocket'

export interface McpServerConfig {
  transport: McpTransport
  /** MCP server 端点 URL(http=StreamableHTTP 端点 / sse=SSE 端点 / websocket=ws URL) */
  url: string
  /** 展示名(用于日志;默认取 url) */
  name?: string
  /** 透传给 transport 的请求 init(headers / 认证等;websocket 忽略) */
  requestInit?: RequestInit
}

export interface McpConnection {
  tools: StructuredToolInterface[]
  close: () => Promise<void>
}

/**
 * MCP callTool 结果 → 纯文本(text/image/resource 拼接;isError 标注)。
 * 纯函数,可单测。
 */
export function extractText(result: {
  content?: Array<{ type: string; text?: string; data?: string; resource?: { text?: string; blob?: string } }>
  isError?: boolean
}): string {
  const content = result?.content
  if (!Array.isArray(content) || !content.length) return ''
  const parts = content
    .map((c) => {
      if (c.type === 'text' && c.text) return c.text
      if (c.type === 'image' && c.data) return `[image:${String(c.data).slice(0, 32)}…]`
      if (c.type === 'audio' && c.data) return '[audio]'
      if (c.type === 'resource' && c.resource) return c.resource.text ?? c.resource.blob ?? ''
      return ''
    })
    .filter(Boolean)
  const text = parts.join('\n')
  return result?.isError ? `工具错误:${text}` : text
}

/** 按 config.transport 动态 import 对应 transport 并构造(按需加载,仅用到的 transport 入包) */
async function buildTransport(config: McpServerConfig): Promise<unknown> {
  const url = new URL(config.url)
  const requestInit = config.requestInit
  if (config.transport === 'http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    return new StreamableHTTPClientTransport(url, { requestInit })
  }
  if (config.transport === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
    return new SSEClientTransport(url, { requestInit })
  }
  const { WebSocketClientTransport } = await import('@modelcontextprotocol/sdk/client/websocket.js')
  return new WebSocketClientTransport(url) // websocket 构造仅接 url,忽略 requestInit
}

/** MCP tool(标准 {name,description,inputSchema})→ LangChain 工具(JSON Schema 直传 schema) */
function toLangChainTool(
  t: { name: string; description?: string; inputSchema: Record<string, unknown> },
  client: Client,
): StructuredToolInterface {
  return tool(
    async (args) => {
      const result = await client.callTool({ name: t.name, arguments: args as Record<string, unknown> })
      return extractText(result as Parameters<typeof extractText>[0])
    },
    {
      name: t.name,
      description: t.description ?? `MCP tool: ${t.name}`,
      // JSON Schema 直传(@langchain/core 原生支持 JSON Schema 作工具 schema)
      schema: t.inputSchema as never,
    },
  ) as StructuredToolInterface
}

/**
 * 连接一个 MCP server → 返回其工具(转 LangChain)+ closer。
 * 失败抛错(由调用方 Promise.allSettled 隔离)。
 */
export async function connectMcp(config: McpServerConfig): Promise<McpConnection> {
  const { Client } = await import('@modelcontextprotocol/sdk/client')
  const transport = await buildTransport(config)
  const client = new Client({ name: 'page-agent-sdk', version: '1.0' }, { capabilities: {} })
  await client.connect(transport as Parameters<Client['connect']>[0])
  const { tools } = await client.listTools()
  const lcTools = tools.map((t) => toLangChainTool(t, client))
  return { tools: lcTools, close: () => client.close() }
}
