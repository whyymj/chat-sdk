// 体积监控:核对 dist 各产物大小不超阈值,防 IIFE/ESM 体积无意膨胀
// 运行:先 npm run build,再 node tests/size-check.mjs
import * as fs from 'fs'

const KB = 1024
const MB = 1024 * KB

// 阈值(单位:字节);当前基线 + 10% 余量
const limits = [
  { file: 'dist/page-agent-sdk.iife.js', max: 1.6 * MB, label: 'IIFE 全量(CDN <script> 直引)' },
  { file: 'dist/page-agent-sdk.js', max: 1.1 * MB, label: 'ESM(npm import)' },
  { file: 'dist/page-agent-sdk.umd.cjs', max: 1.1 * MB, label: 'UMD(require)' },
  { file: 'dist/page-agent-sdk.css', max: 60 * KB, label: 'CSS' },
]

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗', msg) } }

console.log('[size-check] dist 产物体积监控')
for (const { file, max, label } of limits) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!fs.existsSync(url)) {
    assert(false, `${file} 不存在(先 npm run build)`)
    continue
  }
  const size = fs.statSync(url).size
  const sizeKB = (size / KB).toFixed(1)
  const maxKB = (max / KB).toFixed(1)
  const maxMB = (max / MB).toFixed(2)
  assert(size <= max, `${label} ${file}: ${sizeKB}KB ≤ ${maxMB}MB(${maxKB}KB)`)
  if (size > max) console.error(`    超限: ${sizeKB}KB > ${maxKB}KB`)
}

console.log(`\n==== size-check: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
