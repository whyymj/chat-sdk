/**
 * 生成 complex-demo 测试用的 JSON 初始数据(静态产物,便于查看 / 分发 / 复用)。
 *
 * 数据源(均在 examples/complex-demo/):
 *  - initial.json  ← initialPage           默认专题页(~70 实例真实电商导购页)
 *  - huge.json     ← generateHugePage()    ?huge=1,800 组件 ~1M 扁平(测大 JSON / read 分页 / write patch)
 *  - deep-nested.json ← generateDeepNestedPage()  ?deep=1,33 组件 12 层深嵌套(测深 jsonPath / workingMemory)
 *
 * 用法:npx tsx scripts/gen-sample-data.ts
 * 输出:examples/complex-demo/sample-data/*.json
 *
 * 改了 pageSchema / defs / hugePage / deepNestedPage 后重跑即可刷新产物。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { initialPage } from '../examples/complex-demo/pageSchema'
import { generateHugePage } from '../examples/complex-demo/hugePage'
import { generateDeepNestedPage } from '../examples/complex-demo/deepNestedPage'

const dir = 'examples/complex-demo/sample-data'
mkdirSync(dir, { recursive: true })

const datasets = [
  { name: 'initial', data: initialPage, desc: '默认专题页' },
  { name: 'huge', data: generateHugePage(), desc: '1M 大页面(?huge=1)' },
  { name: 'deep-nested', data: generateDeepNestedPage(), desc: '深嵌套(?deep=1)' },
]

for (const { name, data, desc } of datasets) {
  const json = JSON.stringify(data, null, 2)
  writeFileSync(`${dir}/${name}.json`, json)
  const comps = (data as { components?: unknown[] }).components?.length ?? 0
  const kb = (json.length / 1024).toFixed(1)
  console.log(`✓ ${name}.json(${desc}):${comps} 组件, ${kb} KB`)
}
console.log(`\n已输出到 ${dir}/`)
