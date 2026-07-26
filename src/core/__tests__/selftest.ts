/**
 * 自测脚本 —— 验证 SDK 核心逻辑(不依赖 LLM/浏览器)
 * 运行:npm test(tsx 跑,esbuild bundle → node)
 * 测试代码按模块拆分在 ./modules/*.ts,本文件为 runner:setup + 依次调用各模块 + 汇总
 */
import { run as run_sec_01 } from './modules/sec-01'
import { run as run_sec_02 } from './modules/sec-02'
import { run as run_sec_03 } from './modules/sec-03'
import { run as run_sec_04 } from './modules/sec-04'
import { run as run_sec_05 } from './modules/sec-05'
import { run as run_sec_06 } from './modules/sec-06'
import { run as run_sec_07 } from './modules/sec-07'
import { run as run_sec_08 } from './modules/sec-08'
import { run as run_sec_09 } from './modules/sec-09'
import { run as run_sec_10 } from './modules/sec-10'
import { run as run_sec_11 } from './modules/sec-11'
import { run as run_sec_12 } from './modules/sec-12'
import { run as run_sec_13 } from './modules/sec-13'
import { run as run_sec_14 } from './modules/sec-14'
import { run as run_sec_15 } from './modules/sec-15'
import { run as run_sec_16 } from './modules/sec-16'
import { run as run_sec_17 } from './modules/sec-17'
import { run as run_sec_18 } from './modules/sec-18'
import { run as run_sec_19 } from './modules/sec-19'
import { run as run_sec_20 } from './modules/sec-20'
import { run as run_sec_21 } from './modules/sec-21'
import { run as run_sec_22 } from './modules/sec-22'
import { run as run_sec_23 } from './modules/sec-23'
import { run as run_sec_24 } from './modules/sec-24'
import { run as run_sec_25 } from './modules/sec-25'
import { run as run_sec_26 } from './modules/sec-26'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
declare const process: { exit(code?: number): never }

// mock 全局 window(供 verify/checkpoint 旧 windowProps 模式测试 fallback 读;单对象 data 模型的 dataOps 不依赖 window,bind 由 createDataOps({bind}) 传入)
;(globalThis as any).window = { app: { theme: 'light', count: 0 } }

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string): void {
  if (Boolean(cond)) {
    passed++
    console.log('  ✓', msg)
  } else {
    failed++
    console.error('  ✗ FAIL:', msg)
  }
}
async function invoke(tool: any, args: any): Promise<string> {
  return await tool.invoke(args)
}
const byName = (tools: any[]) => Object.fromEntries(tools.map((t) => [t.name, t])) as Record<string, any>

const ctx = { assert, invoke, byName }

;(async () => {
  await run_sec_01(ctx)
  await run_sec_02(ctx)
  await run_sec_03(ctx)
  await run_sec_04(ctx)
  await run_sec_05(ctx)
  await run_sec_06(ctx)
  await run_sec_07(ctx)
  await run_sec_08(ctx)
  await run_sec_09(ctx)
  await run_sec_10(ctx)
  await run_sec_11(ctx)
  await run_sec_12(ctx)
  await run_sec_13(ctx)
  await run_sec_14(ctx)
  await run_sec_15(ctx)
  await run_sec_16(ctx)
  await run_sec_17(ctx)
  await run_sec_18(ctx)
  await run_sec_19(ctx)
  await run_sec_20(ctx)
  await run_sec_21(ctx)
  await run_sec_22(ctx)
  await run_sec_23(ctx)
  await run_sec_24(ctx)
  await run_sec_25(ctx)
  await run_sec_26(ctx)
  console.log(`\n==== ${passed} passed, ${failed} failed ====`)
  if (failed > 0) process.exit(1)
})()
