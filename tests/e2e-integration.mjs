// 集成层 e2e runner —— 按模块拆分,各模块独立跑,汇总计数
// 各模块文件在 tests/e2e/<module>.mjs,均 export async function run() 返回 {pass, fail}
// 运行:先 npm run build,再 npm run test:e2e
import { run as runSystemprompt } from './e2e/systemprompt.mjs'
import { run as runDynamicRegister } from './e2e/dynamic-register.mjs'
import { run as runInspect } from './e2e/inspect.mjs'
import { run as runSubagents } from './e2e/subagents.mjs'
import { run as runEvents } from './e2e/events.mjs'
import { run as runStorage } from './e2e/storage.mjs'
import { run as runExports } from './e2e/exports.mjs'
import { run as runWindowProps } from './e2e/window-props.mjs'
import { run as runPresets } from './e2e/presets.mjs'
import { run as runBoundary } from './e2e/boundary.mjs'
import { run as runCustomInjection } from './e2e/custom-injection.mjs'
import { run as runConflict } from './e2e/conflict.mjs'

const modules = [
  ['systemprompt', runSystemprompt],
  ['dynamic-register', runDynamicRegister],
  ['inspect', runInspect],
  ['subagents', runSubagents],
  ['events', runEvents],
  ['storage', runStorage],
  ['exports', runExports],
  ['window-props', runWindowProps],
  ['presets', runPresets],
  ['boundary', runBoundary],
  ['custom-injection', runCustomInjection],
  ['conflict', runConflict],
]

let totalPass = 0, totalFail = 0
for (const [, run] of modules) {
  const r = await run()
  totalPass += r.pass
  totalFail += r.fail
}

console.log(`\n==== e2e: ${totalPass} passed, ${totalFail} failed ====`)
if (totalFail > 0) process.exit(1)
