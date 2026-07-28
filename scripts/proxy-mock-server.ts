/**
 * LLM 代理 mock server —— 演示 page-agent-sdk 的代理连接模式(createProxyLlm mode:'proxy')。
 *
 * 运行:
 *   npm run proxy:mock          → http://localhost:3002
 *   PROXY_PORT=3005 npm run proxy:mock  → 自定义端口
 *
 * 然后浏览器 page-agent-sdk 连它:
 *   createChatSdk({ llm: createProxyLlm({ mode:'proxy', baseUrl:'http://localhost:3002', userToken, ... }) })
 *
 * 职责(真实代理应做的):
 *   1. 验证用户 token(Authorization: Bearer {userToken})—— 浏览器不持真实 apiKey
 *   2. 注入真实 apiKey(从服务端环境变量取,不下发浏览器)
 *   3. 转发到上游 LLM API(VITE_AI_BASE_URL,OpenAI 兼容)
 *   4. 透传 SSE 流式响应(不缓冲)
 *   5. 透传 tool calling 字段(tools / tool_choice / tool_calls)
 *   6. 处理 CORS(开发跨域;生产建议同源)
 *   7. /api/refresh —— 演示 token 过期刷新(返回新 token)
 *
 * 演示用 token 规则(仅 mock,真实系统接你的鉴权):
 *   - 'demo-token-xxx'        → 有效,正常转发
 *   - 'demo-token-expired'    → 返回 401,触发 SDK refreshToken 重试
 *   - 其他                    → 401 未授权
 *
 * 真实 apiKey 来源:本进程环境变量(从 .env 读 VITE_AI_API_KEY),浏览器永远拿不到。
 */
import http from 'node:http'
import { URL } from 'node:url'

// 从 .env 读真实 LLM 配置(浏览器永远拿不到这些)
const REAL_API_KEY = process.env.VITE_AI_API_KEY || ''
const UPSTREAM_BASE = process.env.VITE_AI_BASE_URL || 'https://api.deepseek.com/v1'
const PORT = process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT, 10) : 3002

if (!REAL_API_KEY) {
  console.warn('[proxy-mock] 未配置 VITE_AI_API_KEY,转发会失败。请在 .env 配置后重启。')
}

/** 验证用户 token(演示规则;真实系统接你的鉴权服务) */
function validateUserToken(token: string): { ok: true } | { ok: false; reason: 'expired' | 'invalid' } {
  if (token === 'demo-token-expired') return { ok: false, reason: 'expired' }
  if (token.startsWith('demo-token-')) return { ok: true }
  return { ok: false, reason: 'invalid' }
}

/** 从 Authorization 头取 Bearer token */
function getBearer(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

/** 读取请求 body(buffer) */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  // CORS(开发跨域;生产建议同源,可去掉)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Tenant')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // /api/refresh —— token 刷新演示端点
  if (req.url === '/api/refresh' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ token: 'demo-token-refreshed-' + Date.now() }))
    return
  }

  // /chat/completions —— 代理转发主端点
  if (req.url === '/chat/completions' && req.method === 'POST') {
    const userToken = getBearer(req)
    if (!userToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'missing Authorization Bearer token' } }))
      return
    }

    const valid = validateUserToken(userToken)
    if (!valid.ok) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: valid.reason === 'expired' ? 'token expired, please refresh' : 'invalid token' } }))
      return
    }

    if (!REAL_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'server missing real apiKey (VITE_AI_API_KEY)' } }))
      return
    }

    // 读浏览器请求 body
    const body = await readBody(req)

    // 构造转发到上游 LLM API 的请求(注入真实 apiKey,去掉用户 token)
    const upstreamUrl = new URL('/chat/completions', UPSTREAM_BASE)
    const upstreamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${REAL_API_KEY}`,
    }
    // 透传 X-Tenant(自定义 headers 演示)
    if (req.headers['x-tenant']) upstreamHeaders['X-Tenant'] = req.headers['x-tenant'] as string

    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body,
      })

      // 透传状态码 + 关键响应头
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      })

      // SSE 流式:直接 pipe(不缓冲);非流式也兼容
      if (upstream.body) {
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(decoder.decode(value))
        }
      }
      res.end()
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `upstream error: ${(e as Error).message}` } }))
    }
    return
  }

  // 其他路径
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'not found, use POST /chat/completions or POST /api/refresh' } }))
})

server.listen(PORT, () => {
  console.log(`[proxy-mock] LLM 代理 server 监听 http://localhost:${PORT}`)
  console.log(`[proxy-mock]   POST /chat/completions  → 转发到 ${UPSTREAM_BASE}/chat/completions`)
  console.log(`[proxy-mock]   POST /api/refresh      → 返回新 token(演示 refreshToken)`)
  console.log(`[proxy-mock] 有效 token:demo-token-xxx / demo-token-expired 触发 401 演示刷新`)
  if (!REAL_API_KEY) console.warn('[proxy-mock] ⚠️ 未配置 VITE_AI_API_KEY,转发会失败')
})
