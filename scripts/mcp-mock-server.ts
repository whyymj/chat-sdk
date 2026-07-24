/**
 * MCP mock server —— 用于测试 chat-sdk 的 MCP client 集成。
 *
 * 运行:npm run mcp:mock            → http://localhost:3001/mcp
 *       MCP_PORT=3003 npm run mcp:mock  → 自定义端口
 * 然后浏览器 chat-sdk 连它:
 *   createChatSdk({ mcp: [{ transport: 'http', url: 'http://localhost:3001/mcp' }] })
 *
 * 暴露 3 个 mock 工具:get_weather / search / calc。
 * 完整 StreamableHTTP:POST(initialize/JSON-RPC)+ GET(SSE 通知流)+ DELETE(关 session),
 * 对齐官方 @modelcontextprotocol/sdk example(避免 client 开 GET 探测时返回 404)。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3001

/** 创建一个 McpServer(注册 mock 工具)。每 session 一个实例(connect 绑定 transport)。 */
function createMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'mock-mcp', version: '1.0' })

  mcp.tool('get_weather', '查询城市天气(模拟数据)', { city: z.string() }, async ({ city }) => ({
    content: [{ type: 'text' as const, text: `${city}:晴 ☀️,25℃,湿度 60%,微风` }],
  }))

  mcp.tool('search', '搜索关键词(模拟数据)', { q: z.string() }, async ({ q }) => ({
    content: [
      { type: 'text' as const, text: `关于「${q}」的模拟结果:\n1. ${q} 的简介…\n2. ${q} 的用途…\n3. ${q} 的注意事项…` },
    ],
  }))

  mcp.tool('calc', '简单计算器(支持 + - * / 与括号)', { expr: z.string() }, async ({ expr }) => {
    try {
      // 仅数字与运算符(防注入)
      if (!/^[\d+\-*/().\s]+$/.test(expr)) throw new Error('仅支持数字与 + - * / ( )')
      const r = Function(`"use strict"; return (${expr})`)()
      return { content: [{ type: 'text' as const, text: `${expr} = ${r}` }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `计算失败:${(e as Error).message}` }], isError: true }
    }
  })

  return mcp
}

// session → transport(对齐官方 example)
const transports = new Map<string, StreamableHTTPServerTransport>()

/** 读取并解析 POST body(JSON-RPC);GET/DELETE 无 body 不调用 */
function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const httpServer = http.createServer(async (req, res) => {
  // CORS(浏览器 chat-sdk 跨域连)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  if (req.url !== '/mcp') {
    res.writeHead(404)
    res.end('MCP mock server listening at POST/GET/DELETE /mcp\n')
    return
  }
  if (!['POST', 'GET', 'DELETE'].includes(req.method!)) {
    res.writeHead(405)
    res.end()
    return
  }

  try {
    // POST:initialize(建 session)或复用 session 处理 JSON-RPC
    if (req.method === 'POST') {
      const body = await readBody(req)
      const sid = req.headers['mcp-session-id'] as string | undefined
      const existing = sid ? transports.get(sid) : undefined
      if (existing) {
        await existing.handleRequest(req, res, body as object)
        return
      }
      if (!sid && isInitializeRequest(body)) {
        let transport: StreamableHTTPServerTransport
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // session 初始化时登记(比 handleRequest 后读 sid 更可靠,避免竞态)
          onsessioninitialized: (sessionId) => {
            transports.set(sessionId, transport)
            console.log(`[mcp-mock] 新 session ${sessionId}(活跃 ${transports.size})`)
          },
        })
        transport.onclose = () => {
          const id = transport.sessionId
          if (id) transports.delete(id)
        }
        const server = createMcpServer()
        await server.connect(transport)
        await transport.handleRequest(req, res, body as object)
        return
      }
      res.writeHead(400)
      res.end(JSON.stringify({ error: '无效请求:需先 initialize' }))
      return
    }

    // GET(SSE 通知流)/ DELETE(关 session):须带有效 session id
    const sid = req.headers['mcp-session-id'] as string | undefined
    const transport = sid ? transports.get(sid) : undefined
    if (!transport) {
      res.writeHead(400)
      res.end('Invalid or missing session ID')
      return
    }
    await transport.handleRequest(req, res) // GET 开 SSE 流 / DELETE 关 session(触发 onclose)
  } catch (err) {
    console.error('[mcp-mock] 处理出错:', err)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(err) }))
    }
  }
})

// 退出时清理所有 session
process.on('SIGINT', async () => {
  for (const [, t] of transports) {
    try {
      await t.close()
    } catch {
      /* 忽略 */
    }
  }
  process.exit(0)
})

httpServer.listen(PORT, () => {
  console.log(`\n🧪 MCP mock server 已启动: http://localhost:${PORT}/mcp`)
  console.log(`   工具:get_weather / search / calc`)
  console.log(`   完整 StreamableHTTP:POST(initialize/调用)+ GET(SSE 通知流)+ DELETE(关 session)`)
  console.log(`   chat-sdk 连接:createChatSdk({ mcp: [{ transport: 'http', url: 'http://localhost:${PORT}/mcp' }] })\n`)
})
