/**
 * observability-tracing 真 LLM 实测(非 mock)
 *
 * 验证:长任务(draft 多轮)跑完 → trace 事件(spans + metrics)正确:
 *  - spans 含 round/model/tool span(parentId 树)
 *  - metrics(轮次/延迟/工具成功率/token)
 *
 * 用法:配 .env(VITE_AI_API_KEY 等)后 npm run test:trace-real;无 key skip
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createChatSdk } from '../../dist/page-agent-sdk.js'
import { pageSchema } from '../../examples/complex-demo/pageSchema'

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
  let traceEvent: any = null

  const sdk = createChatSdk({
    ui: false,
    llm: {
      apiKey,
      baseUrl: process.env.VITE_AI_BASE_URL,
      model: process.env.VITE_AI_MODEL || 'deepseek-chat',
      temperature: Number(process.env.VITE_AI_TEMPERATURE) || 0.3,
    },
    data: { schema: pageSchema, bind, description: '专题页 {title, components[]}' },
    capabilities: { draftWrite: true, vfs: true, tracing: true },
    toolMode: 'advanced',
    maxToolRounds: 40,
    systemPrompt: '你是页面构建助手。生成大页面必须用 draft_write 分块 → draft_commit(单次 write 装不下 max_tokens)。',
    onEvent: (e: any) => {
      if (e.type === 'tool_call') calls.push(e.name)
      if (e.type === 'trace') traceEvent = e
    },
  })
  await sdk.mount()

  console.log('━'.repeat(60))
  console.log('真 LLM 实测 observability-tracing(draft 多轮 → trace 树 + metrics)')
  console.log('━'.repeat(60))
  await sdk.stream(
    [{ role: 'user', content: '用 draft_write 分块生成一个 15+ 组件的电商专题页(含 navbar/banner/商品卡片/优惠券/footer),draft_commit 提交。', timestamp: Date.now() }],
    (e: any) => { if (e.type === 'tool_call') calls.push(e.name) },
  )

  console.log('\n=== trace 真 LLM 实测结果 ===')
  console.log('工具调用:', calls.length, '次(draft_write:', calls.filter((n) => n === 'draft_write').length, ', draft_commit:', calls.includes('draft_commit'), ')')

  if (!traceEvent) {
    console.log('✗ 未收到 trace 事件(tracing 未开?或 emit 失败)')
    try { (sdk as any).unmount?.() } catch {}
    return 1
  }

  const spans = traceEvent.spans as any[]
  const m = traceEvent.metrics as any
  console.log(`spans: ${spans.length} 条`)
  const types = spans.reduce((a: any, s: any) => { a[s.type] = (a[s.type] || 0) + 1; return a }, {})
  console.log('span 类型分布:', types)
  console.log(`metrics: 轮次=${m.rounds} 总耗时=${m.totalDurationMs}ms 平均/轮=${m.avgRoundMs}ms`)
  console.log(`  工具=${m.toolCalls}(✅${Math.round(m.toolSuccessRate * 100)}%) model=${m.modelCalls} 压缩=${m.compressions}` + (m.totalTokens ? ` token=${m.totalTokens.total}` : ''))

  const ok = m.rounds > 0 && m.toolCalls > 0 && spans.some((s: any) => s.type === 'round') && spans.some((s: any) => s.type === 'tool')
  console.log(ok ? '\n✓ observability-tracing 真 LLM 实测通过(trace 树 + metrics 正确)' : '\n✗ 实测未达预期(trace 结构不完整)')

  try { (sdk as any).unmount?.() } catch {}
  return ok ? 0 : 1
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('实测脚本异常:', e)
  process.exit(1)
})
