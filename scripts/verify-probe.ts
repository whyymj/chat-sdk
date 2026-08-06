/**
 * 对抗式验证探测(node 侧,端到端验证 runAdversarial)。
 * 用法:npx tsx scripts/verify-probe.ts  (或 npm run verify:probe)
 * 目的:构造一个「故意有错」的回复,开 adversarial,调 beforeReturn,
 *      看对抗子 agent 是否真 spawn + 审查 + 抓出错误(端到端,依赖 LLM)。
 * 需 .env 配 VITE_AI_API_KEY / VITE_AI_BASE_URL / VITE_AI_MODEL。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { createVerifyMiddleware } from '../src/core/harness/verify'
import { createInitialState } from '../src/core/harness/state'

// 手动加载 .env(tsx 不自动加载;不引入 dotenv 保持零依赖)
try {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf-8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*(VITE_\w+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch {
  console.warn('[probe] ⚠️ 未找到 .env,沿用已有 process.env')
}

const apiKey = process.env.VITE_AI_API_KEY
const baseUrl = process.env.VITE_AI_BASE_URL
const model = process.env.VITE_AI_MODEL || 'deepseek-v4-flash'
if (!apiKey) {
  console.error('[probe] ❌ 缺 VITE_AI_API_KEY(请在 .env 配置)')
  process.exit(1)
}

async function main() {
  // 场景:用户问 2+2,agent 故意答 5(错)。对抗子 agent(refute 姿态)应抓出。
  const messages = [
    new HumanMessage('2 加 2 等于多少?'),
    new AIMessage('2 + 2 = 5'),
  ]

  const mw = createVerifyMiddleware({
    check: async () => ({ ok: true }), // check 故意放行,只测 adversarial 分支
    adversarial: { llm: { apiKey, baseUrl, model, temperature: 0 } },
  })

  console.log('[probe] 场景:用户问 2+2,agent 答 "5"(故意错)。开 adversarial,调 beforeReturn...\n')
  const ctx = {
    messages,
    state: createInitialState(),
    response: { message: messages[1]!, toolCalls: [], content: '2 + 2 = 5' },
    log: (type: string, data: unknown) => console.log(`[probe][${type}]`, JSON.stringify(data)),
  } as any

  const feedback = await mw.beforeReturn!(ctx)
  console.log('--- 对抗结果 ---')
  if (feedback === null) {
    console.log('[probe] ⚠️ 对抗子 agent 放行(返回 null)')
    console.log('   可能:LLM 没抓到错 / verdict 措辞未命中 isAdversarialClean 正则 / 子 agent 确实认为无问题')
    console.log('   → 需排查:runAdversarial 跑了吗?verdict 原文是什么?')
  } else {
    console.log('[probe] ✅ 对抗子 agent 抓出问题,feedback:')
    console.log(feedback)
    console.log('\n[probe] → 此 feedback 会回灌主 agent 触发自纠(端到端链路通,对抗模式可用)')
  }
}

main().catch((e) => console.error('[probe] ❌ 失败:', e))
