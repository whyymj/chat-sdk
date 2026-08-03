/**
 * 码良级任务真 LLM 实测(#57,非 mock)
 *
 * 验证:用 complex-demo(34 组件 union + initialPage 60-80 实例)配真 LLM 跑码良级任务闭环:
 *  ① 生成(追加秒杀区块)② 批量改(全商品 8 折)③ 深嵌套定位改(某 coupon 面额)④ 问答(只读清点)
 * 审计:mission 防跑偏 / planning 多步 / 大 JSON(draft/patch/分页) / schema 注入体积 实效,固化发现到 doc/。
 *
 * 用法:配 .env(VITE_AI_API_KEY / VITE_AI_BASE_URL / VITE_AI_MODEL)后 npm run test:maliang-real
 * 无 key 时 skip(exit 0,不阻塞 CI)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createChatSdk } from '../../dist/page-agent-sdk.js'
import { pageSchema, initialPage } from '../../examples/complex-demo/pageSchema'

// 手动加载 .env(tsx 不自动读 VITE_ 前缀)
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
    console.log('⚠ skip: 未配 VITE_AI_API_KEY(.env),跳过码良级真 LLM 实测')
    return 0
  }

  const bind = JSON.parse(JSON.stringify(initialPage)) as { title: string; components: any[] }
  // 工具链审计:send(invoke)不外发 tool_call 事件(仅 stream 发)→ 从 trace.spans 收 tool span name(=工具名,createAgent.ts:629)
  const toolNames = (s: any) => ((s.inspect().trace?.spans ?? []) as { type: string; name: string }[]).filter((x) => x.type === 'tool').map((x) => x.name)

  const sdk = createChatSdk({
    ui: false,
    llm: {
      apiKey,
      baseUrl: process.env.VITE_AI_BASE_URL,
      model: process.env.VITE_AI_MODEL || 'deepseek-chat',
      temperature: Number(process.env.VITE_AI_TEMPERATURE) || 0.3,
    },
    data: { schema: pageSchema, bind, description: '电商专题页 {title, components[]}(34 种组件 union,含 icon/tag/price/coupon/productGrid/countdown 等基础+营销组件)' },
    capabilities: { planning: true, missionAnchor: true, workingMemory: true, draftWrite: true, vfs: true, tracing: true, fetch: false },
    toolMode: 'advanced',
    maxToolRounds: 25,
    contextPreset: 'complex',
    systemPrompt: [
      '你是「码良」低代码平台的页面搭建助手,通过读写页面 JSON 帮运营搭建/编辑电商专题页。',
      '页面结构 { title, components[] },34 种组件(heading/image/button/banner/carousel/coupon/productGrid/price/tag/icon/countdown/navbar/tabs/section/grid 等)。',
      '规则:改前先 read 定位;改大对象优先 write 的 patch 增量(只发改动部分);从零生成大段用 draft_write 分块 + draft_commit;字段约束以 describe/read 返回为准,写错按校验错误重试。',
    ].join('\n'),
    // 工具链审计走 trace.spans(见 toolNames helper);send 不发 tool_call 事件,onEvent 收集为空故不在此收
  })
  await sdk.mount()

  // mission 显式锚定(审计 capture + 防跑偏)
  sdk.setMission({ goal: '搭建并运营电商 618 专题页', criteria: ['页面结构完整', '商品/价格信息准确', '改动符合用户指令'] })

  const tasks = [
    '① 生成:在页面 components 末尾追加一个「限时秒杀」section,内含 heading(标题"限时秒杀")+ countdown(目标 2026-08-15 23:59:59)+ productGrid(3 个商品,每个含 name + price 现价/原价 + tag「秒杀」)。用 write patch 增量追加到 components 数组。',
    '② 批量改:把页面里所有 productGrid 中每个商品的现价 current 打 8 折,原价 original 保留不变。',
    '③ 深嵌套定位改:找到页面第 1 个 coupon 优惠券,把它的面额 amount 改成 80。改前先 read 定位它的路径。',
    '④ 问答:当前页面一共有几个商品(统计所有 productGrid 的商品数)?列出现价最高的 3 个商品名。只读不改。',
  ]

  const report: any[] = []
  console.log(`\n=== 码良级任务真 LLM 实测(初始 ${bind.components.length} 组件,模型 ${process.env.VITE_AI_MODEL || 'deepseek-chat'})===`)
  for (let i = 0; i < tasks.length; i++) {
    process.stdout.write(`\n--- ${tasks[i].slice(0, 48)} ---\n`)
    let reply = ''
    try {
      reply = await sdk.send(tasks[i])
    } catch (e) {
      reply = `❌ 失败:${(e as Error).message}`
    }
    const info = sdk.inspect()
    const newTools = toolNames(sdk)  // spans 每次 send(invoke→stream:492)重置 → toolNames 即本次任务工具链,无需 slice
    report.push({
      task: tasks[i].slice(0, 40),
      ok: !reply.startsWith('❌'),
      replyHead: reply.slice(0, 140).replace(/\n/g, ' '),
      toolsUsed: newTools,
      usedDraft: newTools.some((n) => n === 'draft_write' || n === 'draft_commit'),
      usedWrite: newTools.some((n) => n === 'write'),
      usedRead: newTools.some((n) => n === 'read'),
      componentsAfter: bind.components.length,
    })
    console.log(`  工具链: ${newTools.join(' → ') || '(无工具)'}`)
    console.log(`  回复: ${reply.slice(0, 180).replace(/\n/g, ' ')}`)
  }

  // 审计报告
  const info = sdk.inspect()
  console.log('\n=== 审计报告(终态)===')
  console.log('mission:', JSON.stringify(info.mission))
  console.log('planPhase:', JSON.stringify(info.planPhase))
  console.log('workingMemory:', JSON.stringify(info.workingMemory))
  console.log('trace.metrics:', JSON.stringify(info.trace?.metrics))
  console.log('systemPrompt 体积(chars):', info.systemPrompt.length)
  console.log('总工具调用:', toolNames(sdk).join(', '))

  // 固化发现到 doc(maliang-real-findings.md)
  const findings = [
    `# 码良级真 LLM 实测发现(${new Date().toISOString().slice(0, 10)})`,
    '',
    `模型: ${process.env.VITE_AI_MODEL || 'deepseek-chat'} | 初始组件: ${initialPage.components.length} | 组件类型: 34(含 icon/tag/price)`,
    `systemPrompt 体积: ${info.systemPrompt.length} chars | 总轮次: ${info.trace?.metrics?.rounds ?? '-'} | 总工具调用: ${toolNames(sdk).length}`,
    `mission capture: ${info.mission ? '✓ ' + info.mission.goal : '✗'} | planning 触发: ${info.planPhase?.inPlanning ? '✓' : '✗(或简单任务未触发)'}`,
    '',
    '## 任务级工具链',
    ...report.map((r) => `- [${r.task}] ok=${r.ok} read=${r.usedRead} write=${r.usedWrite} draft=${r.usedDraft} | ${r.toolsUsed.join('→') || '无工具'}`),
    '',
    '## 短板/发现(人工据上方工具链复核)',
    '- [ ] LLM 是否误用 write 整体重传大对象(应用 patch 增量)?',
    '- [ ] 是否漏 read 直接写(凭记忆写致乐观锁冲突或路径错)?',
    '- [ ] 生成任务是否正确用 draft 分块(而非 write 截断)?',
    '- [ ] schema 注入体积是否过大(34 组件全量约束撑爆上下文)?',
    '- [ ] mission 是否跑偏(改动偏离 goal)?',
    '- [ ] planning 是否在复杂任务(批量改/生成)触发?',
    '',
  ].join('\n')
  try {
    writeFileSync(resolve(process.cwd(), 'doc/maliang-real-findings.md'), findings + '\n> 详细工具调用/回复见运行时 stdout\n')
    console.log('\n✓ 发现已写入 doc/maliang-real-findings.md')
  } catch (e) {
    console.log('\n写 doc 失败(忽略):', (e as Error).message)
  }

  const allOk = report.every((r) => r.ok)
  console.log(`\n=== ${allOk ? '✓ 4 任务全完成' : '✗ 有任务失败'} ===`)
  return allOk ? 0 : 1
}

main().then((code) => { process.exit(code) }).catch((e) => { console.error(e); process.exit(1) })
