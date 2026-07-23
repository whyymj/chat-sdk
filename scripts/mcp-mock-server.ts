/**
 * MCP mock server —— 用于测试 page-agent 的 MCP client 集成。
 *
 * 运行:npm run mcp:mock  →  http://localhost:3001/mcp
 * 然后浏览器 page-agent 连它:
 *   createPageAgent({ mcp: [{ transport: 'http', url: 'http://localhost:3001/mcp' }] })
 *
 * 暴露 3 个 mock 工具:get_weather / search / calc。
 * 用 StreamableHTTP transport(node 版,handleRequest 接 node req/res)+ CORS(浏览器跨域)+ session 管理。
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const PORT = 3001

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

// session 管理:sessionId → { transport, server }
const sessions = new Map<string, { transport: any; server: any }>()

/** 读取并解析请求 body(JSON-RPC) */
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const httpServer = http.createServer(async (req, res) => {
  // CORS(浏览器 page-agent 跨域连)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.url !== '/mcp' || req.method !== 'POST') {
    res.writeHead(404)
    res.end('MCP mock server listening at POST /mcp\n')
    return
  }

  try {
    const body = await readBody(req)
    const sid = req.headers['mcp-session-id'] as string | undefined
    let session = sid ? sessions.get(sid) : undefined

    // initialize:创建新 session(transport + server)
    if (!session && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
      const server = createMcpServer()
      await server.connect(transport as any)
      session = { transport, server }
    }

    if (!session) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: '无效请求:需先 initialize' }))
      return
    }

    await session.transport.handleRequest(req, res, body)

    // initialize 响应后,transport 生成 sessionId → 登记
    const newSid = session.transport.sessionId as string | undefined
    if (newSid && !sessions.has(newSid)) {
      sessions.set(newSid, session)
      session.transport.onclose = () => sessions.delete(newSid)
      console.log(`[mcp-mock] 新 session ${newSid}(活跃 ${sessions.size})`)
    }
  } catch (err) {
    console.error('[mcp-mock] 处理出错:', err)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(err) }))
    }
  }
})

httpServer.listen(PORT, () => {
  console.log(`\n🧪 MCP mock server 已启动: http://localhost:${PORT}/mcp`)
  console.log(`   工具:get_weather / search / calc`)
  console.log(`   page-agent 连接:createPageAgent({ mcp: [{ transport: 'http', url: 'http://localhost:${PORT}/mcp' }] })\n`)
})
