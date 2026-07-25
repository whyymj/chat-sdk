// 导出一致性检查:对比 src/core/index.ts 与 types/index.d.ts 的导出名集合,发现 types 漏导出
// 运行:node tests/exports-consistency.mjs
import * as fs from 'fs'

function extractExports(content) {
  const names = new Set()
  // export { a, b } from '...' / export type { a, b } from '...' / export { default as X } from '...'
  for (const m of content.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}\s*(?:from\s+['"][^'"]+['"])?/g)) {
    for (const raw of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      let name = raw.replace(/^type\s+/, '')  // 去掉 `export { type X }` 的 type 前缀
      const parts = name.split(/\s+as\s+/)
      names.add(parts[1] || parts[0])  // 取 alias 名(若有),如 default as ChatDialog → ChatDialog
    }
  }
  for (const m of content.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  for (const m of content.matchAll(/export\s+declare\s+(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  for (const m of content.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  return names
}

const srcContent = fs.readFileSync(new URL('../src/core/index.ts', import.meta.url), 'utf8')
const typesContent = fs.readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8')
const srcExports = extractExports(srcContent)
const typesExports = extractExports(typesContent)

const missingInTypes = [...srcExports].filter(n => !typesExports.has(n))
const extraInTypes = [...typesExports].filter(n => !srcExports.has(n))

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗', msg) } }

console.log('[exports-consistency] src/core/index.ts 导出数:', srcExports.size)
console.log('[exports-consistency] types/index.d.ts 导出数:', typesExports.size)
assert(missingInTypes.length === 0, `types/index.d.ts 无漏导出(缺失:${missingInTypes.join(', ') || '无'})`)
if (missingInTypes.length > 0) console.error('  ✗ types 缺失:', missingInTypes.join(', '))
if (extraInTypes.length > 0) console.log('  ℹ types 多余(可能内部类型):', extraInTypes.join(', '))

console.log(`\n==== exports-consistency: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
