/**
 * draft-write-commit 真 LLM 实测(非 mock)
 *
 * 验证:几百 K 大 JSON 用 draft_write 分块累积 → draft_commit 原子提交
 *  (真 LLM 能正确分块 + 拼合法 JSON + 工具链端到端)
 *
 * 用法:配 .env(VITE_AI_API_KEY / VITE_AI_BASE_URL / VITE_AI_MODEL)后
 *   npm run test:draft-real
 * 无 key 时 skip(exit 0,不阻塞 CI/其他测试)
 *
 * 这是 complex-demo 的 headless 真实测:complex-demo pageSchema(30 组件 union)
 * + advanced + draftWrite,让真 LLM 用 draft 分块生成 20+ 组件专题页。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createChatSdk } from '../../dist/page-agent-sdk.js'
import { pageSchema } from '../../examples/complex-demo/pageSchema'

// 手动加载 .env(tsx 不自动读 VITE_ 前缀;vite dev 才自动)
try {
  const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*(VITE_\w+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
} catch { /* 无 .env 忽略 */ }

async function main() {
  const apiKey = process.env.VITE_AI_API_KEY
  if (!apiKey) {
    console.log('⚠ skip: 未配 VITE_AI_API_KEY(.env),跳过真 LLM 实测')
    return 0
  }

  const bind = { title: '', components: [] as any[] }
  const calls: string[] = []
  let draftWriteCount = 0

  const sdk = createChatSdk({
    ui: false,
    llm: {
      apiKey,
      baseUrl: process.env.VITE_AI_BASE_URL,
      model: process.env.VITE_AI_MODEL || 'deepseek-v4-flash',
      temperature: Number(process.env.VITE_AI_TEMPERATURE) || 0.3,
    },
    data: { schema: pageSchema, bind, description: '专题页 {title, components[]}(30 种组件 union)' },
    capabilities: { draftWrite: true, vfs: true, domInspect: false },
    toolMode: 'advanced',
    maxToolRounds: 40, // draft 分块多轮(每块一轮),给足轮次到 commit
    systemPrompt: [
      '你是复杂页面构建助手。',
      '**强制规则:禁止用 write({value:...}) 生成大页面**(单次输出受 max_tokens 限制会被截断,生成不完整 → 工具不执行)。生成页面必须且只能用 draft_write 分块累积 + draft_commit 提交。',
      '流程:① draft_write({draftId:"page1", chunk:\'{"title":"电商专题","components":[\', mode:"start"});',
      '② 每块 draft_write({draftId:"page1", chunk:\'<2-3 个组件的 JSON 片段>,\', mode:"append"})(注意每块末尾逗号,JSON 片段要能拼成合法数组);',
      '③ draft_write({draftId:"page1", chunk:\']}\', mode:"append"})(闭合 components 数组 + 根对象);',
      '④ draft_commit({draftId:"page1"})(合并 + 校验 + 提交)。',
      '**严禁 write 生成大页面**;小改可用 write patch,但从零生成页面必须 draft。',
    ].join('\n'),
  })
  await sdk.mount()

  sdk.hook((e: any) => {
    if (e.type === 'tool_call') {
      calls.push(e.name)
      if (e.name === 'draft_write') draftWriteCount++
    }
    if (e.type === 'round_start' || e.type === 'error' || e.type === 'done') {
      console.log(`[event] ${e.type}${e.name ? ' ' + e.name : ''}${e.message ? ' ' + String(e.message).slice(0, 100) : ''}${e.round ? ' round=' + e.round : ''}`)
    }
  })

  console.log('━' .repeat(60))
  console.log('发送任务:用 draft 分块生成 20+ 组件电商专题页(真 LLM,stream 收 tool_call)...')
  console.log('━' .repeat(60))
  // 用 stream(发 tool_call 事件;send/invoke 不发离散 tool_call)而非 send
  const reply = await sdk.stream(
    [{ role: 'user', content: '用 draft_write 工具分块生成一个 30+ 组件的电商专题页(含 navbar / banner / 多个商品卡片 productGrid / 优惠券 coupon / footer 等)。**禁止用 write**(会超 max_tokens 截断),必须 draft_write({draftId:"page1",chunk,mode}) 分块累积:先 mode:"start" 起 {"title":"...","components":[,再 mode:"append" 每块加 2-3 个组件的 JSON 片段,最后 ]} 闭合,draft_commit({draftId:"page1"}) 提交。', timestamp: Date.now() }],
    (e: any) => {
      if (e.type === 'tool_call') {
        calls.push(e.name)
        if (e.name === 'draft_write') draftWriteCount++
        console.log(`[tool_call] ${e.name}`)
      } else if (e.type === 'tool_result' && (e.name === 'draft_commit' || e.name === 'draft_write')) {
        console.log(`[${e.name}_result] ${String(e.result).slice(0, 220)}`)
      } else if (e.type === 'round_start') {
        console.log(`[round_start] round=${e.round}`)
      } else if (e.type === 'error' || e.type === 'done') {
        console.log(`[event] ${e.type}${e.message ? ' ' + String(e.message).slice(0, 100) : ''}`)
      }
    },
  )

  console.log('\n=== 真 LLM 实测结果 ===')
  console.log('工具调用序列:', calls.join(' → '))
  console.log(`draft_write 次数: ${draftWriteCount}`)
  console.log(`draft_commit 提交: ${calls.includes('draft_commit')}`)
  console.log(`生成组件数: ${bind.components.length}`)
  console.log(`页面 title: ${bind.title}`)
  console.log(`页面 JSON 大小: ${JSON.stringify(bind).length} 字符`)
  console.log(`最终回复: ${(reply || '').slice(0, 300)}`)

  const ok = calls.includes('draft_commit') && bind.components.length >= 10
  console.log(ok ? '\n✓ draft-write-commit 真 LLM 实测通过(分块生成 + commit 成功)' : '\n✗ 实测未达预期(LLM 未用 draft 或生成组件不足 10)')

  try { (sdk as any).unmount?.() } catch { /* ignore */ }
  return ok ? 0 : 1
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('实测脚本异常:', e)
  process.exit(1)
})
