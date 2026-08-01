/**
 * 1M 大页面生成器(B1)—— 程序化产生 ~800 实例的大 JSON
 *
 * 读 defs registry 的 defaultProps 循环生成(覆盖全 30 类型,字段必然合规)。
 * 用于测试 agent 在 1M 场景的胜任性:read 分页(offset/limit)/ write patch 改某实例 /
 * workingMemory 跨压缩保留定位 / schema 分层(顶层 components 一行,systemPrompt 不爆)。
 *
 * 加载:complex-demo URL 加 ?huge=1(App.vue 检测 → generateHugePage() 替代 initialPage)。
 * PageRenderer 截断渲染(前 100,避免 800 组件卡死浏览器;agent 数据操作不受影响)。
 *
 * 注:2.18 前本文件手写 switch + 字段名与 schema 不一致(button text / card content / spacer size),
 * 致实例不合规。现统一从 registry defaultProps 生成(字段与 pageSchema 对齐),根治该 bug。
 */
import type { PageData } from './pageSchema'
import { COMPONENT_DEFS } from './defs'

export function generateHugePage(count = 800): PageData {
  const components: unknown[] = []
  for (let i = 0; i < count; i++) {
    components.push(genComponent(i))
  }
  return {
    title: `大页面(1M 基准 · ${count} 组件 · 全 ${COMPONENT_DEFS.length} 类型循环)`,
    components,
  } as PageData
}

function genComponent(i: number): Record<string, unknown> {
  const def = COMPONENT_DEFS[i % COMPONENT_DEFS.length]
  // JSON 深拷贝 defaultProps,避免实例间共享引用(纯 JSON 数据,JSON 拷贝零环境依赖,比 structuredClone 兼容性好)
  const props = JSON.parse(JSON.stringify(def.defaultProps))
  return { type: def.type, id: `huge-${i}`, props }
}
