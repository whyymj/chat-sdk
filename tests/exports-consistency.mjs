// 导出一致性检查:对比 src/core/index.ts 与 types/index.d.ts 的导出名集合,发现 types 漏导出
// 运行:node tests/exports-consistency.mjs
//
// 职责分工(防 types 漂移双层防线):
//  - 本文件查「导出名集合」(名字在不在):防 types 漏导出某符号(如新增导出忘加进 d.ts)
//  - 字段级签名漂移(名字都在、字段错 —— 如 AgentCore 缺方法、onAudit 签名错)由
//    tests/types.test-d.ts(test:types)的 Pick<ChatSdk, ...> / Extract<SdkEvent, ...> 字段级断言覆盖
//  两者互补:本文件管「符号存在」,types.test-d.ts 管「字段正确」
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

// subpath exports 配置断言(refactor-module-extraction:./storage / ./query / ./llm 按需引入)
// 注:实际运行时可达性由 e2e(浏览器经同一 dist)覆盖;此处校验 package.json exports 配置正确(语义可达 + CDN 入口独立)
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert(!!pkg.exports['.'] && !!pkg.exports['.'].import, '顶层 . 入口保留(向后兼容)')
assert(!!pkg.exports['./storage']?.import && pkg.exports['./storage'].import.endsWith('page-agent-sdk.js'), 'subpath ./storage 已配置(持久化层:createSessionStore 等)')
assert(!!pkg.exports['./query']?.import && pkg.exports['./query'].import.endsWith('page-agent-sdk.js'), 'subpath ./query 已配置(jpEval/searchJson + jsonUtils/schemaUtils 纯函数)')
assert(!!pkg.exports['./llm']?.import && pkg.exports['./llm'].import.endsWith('page-agent-sdk.js'), 'subpath ./llm 已配置(createProxyLlm 防 apiKey 泄露)')
assert(pkg.exports['./style.css'], 'subpath ./style.css 保留')

console.log(`\n==== exports-consistency: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
