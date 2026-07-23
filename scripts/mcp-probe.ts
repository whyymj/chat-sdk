/**
 * MCP 连通性探测(node 侧,复用 src/core/mcp/client 的 connectMcp)。
 * 用法:确保 mock server 在跑(npm run mcp:mock),然后 npx tsx scripts/mcp-probe.ts
 * 目的:隔离 connectMcp 逻辑本身(server + SDK client + JSON Schema→tool)是否 OK。
 */
import { connectMcp } from '../src/core/mcp/client'

async function main() {
  try {
    const conn = await connectMcp({ transport: 'http', url: 'http://localhost:3001/mcp', name: 'mock' })
    console.log('[probe] ✅ 连接成功,工具数 =', conn.tools.length)
    console.log('[probe] 工具名 =', conn.tools.map((t) => t.name))
    const getWeather = conn.tools.find((t) => t.name === 'get_weather')
    if (getWeather) {
      const r = await getWeather.invoke({ city: '北京' })
      console.log('[probe] get_weather(北京) =', JSON.stringify(r))
    }
    await conn.close()
    console.log('[probe] ✅ 已关闭')
  } catch (e) {
    console.error('[probe] ❌ 失败:', e)
  }
}

main()
