import { createProxyLlm } from '../../llm/proxyLlm'
import type { TestCtx } from './_ctx'

// proxyLlm direct 生产安全闸(throwOnDirectInProduction)—— 防 apiKey 泄露
// quality-hardening §2 新增(commit 21fefd0,opt-in 配置项),原 sec-27 只测构造期未触发此分支,
// 补 selftest 覆盖(违反测试同步约定修复 —— 3 agent 审计高优先遗漏 #1)。
// mock globalThis.location 模拟生产/开发/SSR 三态。
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[proxyLlm direct 生产安全闸 throwOnDirectInProduction]')

  const origLocation = (globalThis as any).location
  const origWarn = console.warn
  const setLoc = (protocol: string, hostname: string) => {
    (globalThis as any).location = { protocol, hostname }
  }
  const restore = () => {
    if (origLocation === undefined) delete (globalThis as any).location
    else (globalThis as any).location = origLocation
    console.warn = origWarn
  }

  // 1. 生产(https + 非本地域)+ throwOnDirectInProduction:true → throw 阻断
  setLoc('https:', 'prod.example.com')
  let threw1 = false
  try {
    createProxyLlm({ mode: 'direct', apiKey: 'sk-x', throwOnDirectInProduction: true })
  } catch { threw1 = true }
  assert(threw1, 'throwOnDirectInProduction:true + 生产(https + 非本地域)→ throw 阻断(防 apiKey 进 bundle 泄露)')

  // 2. 生产 + 默认(false/不传)→ warn 提醒不阻断(向后兼容)
  const warns: string[] = []
  console.warn = (m: string) => { warns.push(String(m)) }
  let threw2 = false
  try {
    createProxyLlm({ mode: 'direct', apiKey: 'sk-x' })
  } catch { threw2 = true }
  assert(
    !threw2 && warns.length === 1 && /direct 模式/.test(warns[0]) && /泄露 apiKey/.test(warns[0]),
    '默认(throwOnDirectInProduction:false/不传)+ 生产 → console.warn 提醒不阻断(向后兼容,opt-in 升级强安全)',
  )

  // 3. 非生产(localhost)→ 不触发安全闸(即使 throwOnDirectInProduction:true)
  setLoc('https:', 'localhost')
  warns.length = 0
  let threw3 = false
  try {
    createProxyLlm({ mode: 'direct', apiKey: 'sk-x', throwOnDirectInProduction: true })
  } catch { threw3 = true }
  assert(!threw3 && warns.length === 0, 'localhost → 非生产,throwOnDirectInProduction 也不触发(开发环境正常直连)')

  // 4. http(非 https)→ 非生产
  setLoc('http:', 'prod.example.com')
  warns.length = 0
  let threw4 = false
  try {
    createProxyLlm({ mode: 'direct', apiKey: 'sk-x', throwOnDirectInProduction: true })
  } catch { threw4 = true }
  assert(!threw4 && warns.length === 0, 'http 协议 → 非生产(仅 https 视为生产),不触发安全闸')

  // 5. location 不可用(SSR/node 无 location)→ catch 静默,正常构造(降级不 throw)
  delete (globalThis as any).location
  let threw5 = false
  try {
    createProxyLlm({ mode: 'direct', apiKey: 'sk-x', throwOnDirectInProduction: true })
  } catch { threw5 = true }
  assert(!threw5, 'location 不可用(SSR/node)→ try/catch 静默,降级正常构造(不 throw)')

  restore()
}
