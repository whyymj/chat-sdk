/**
 * 1M 大页面生成器(B1)—— 程序化产生 ~800 实例的大 JSON
 *
 * 用于测试 agent 在 1M 场景的胜任性:read 分页(offset/limit)/ write patch 改某实例 /
 * workingMemory 跨压缩保留定位 / schema 分层(顶层 components 一行,systemPrompt 不爆)。
 * 复用现有 30 类型(循环 13 类型变体),实例尽量符合 pageSchema(agent read 看实际值,write 改符合 schema 的字段)。
 *
 * 加载:complex-demo URL 加 ?huge=1(App.vue 检测 → generateHugePage() 替代 initialPage)。
 * PageRenderer 截断渲染(前 100,避免 800 组件卡死浏览器;agent 数据操作不受影响)。
 */
import type { PageData } from './pageSchema'

/** 循环的类型(覆盖常见,props 用核心字段) */
const TYPES = ['heading', 'image', 'button', 'card', 'list', 'productGrid', 'banner', 'coupon', 'stat', 'rating', 'spacer', 'divider', 'richText'] as const

export function generateHugePage(count = 800): PageData {
  const components: unknown[] = []
  for (let i = 0; i < count; i++) {
    components.push(genComponent(i))
  }
  return { title: `大页面(1M 基准 · ${count} 组件)`, components } as PageData
}

function genComponent(i: number): Record<string, unknown> {
  const id = `huge-${i}`
  const type = TYPES[i % TYPES.length]
  switch (type) {
    case 'heading':
      return { type, id, props: { text: `区块标题 ${i}`, level: (i % 3) + 1 } }
    case 'richText':
      return { type, id, props: { html: `<p>富文本内容 ${i}:描述性段落,含<b>加粗</b>与<a href="#">链接</a>,模拟运营编辑的图文说明。</p>` } }
    case 'image':
      return { type, id, props: { src: `https://picsum.photos/seed/${i}/320/240`, alt: `示例图 ${i}`, width: '100%' } }
    case 'button':
      return { type, id, props: { text: `操作按钮 ${i}`, variant: ['primary', 'secondary', 'outline'][i % 3] } }
    case 'card':
      return { type, id, props: { title: `卡片 ${i}`, content: `卡片内容 ${i}:描述性文本,展示卡片在大页面中的渲染与 agent 增量 patch 操作。`, image: `https://picsum.photos/seed/c${i}/200/120` } }
    case 'list':
      return { type, id, props: { items: [`列表项 ${i}.1`, `列表项 ${i}.2`, `列表项 ${i}.3`], ordered: i % 2 === 0 } }
    case 'productGrid':
      return { type, id, props: { columns: 4, gap: 12, products: genProducts(i, 4) } }
    case 'banner':
      return { type, id, props: { title: `活动 Banner ${i}`, subtitle: `副标题 ${i} · 限时优惠`, image: `https://picsum.photos/seed/b${i}/600/200`, ctaText: '立即参与' } }
    case 'coupon':
      return { type, id, props: { amount: 10 + (i % 5) * 5, title: `优惠券 ${i}`, threshold: 100 } }
    case 'stat':
      return { type, id, props: { label: `指标 ${i}`, value: (i + 1) * 137, unit: i % 2 === 0 ? '元' : '人' } }
    case 'rating':
      return { type, id, props: { score: 3 + (i % 3), label: `评分 ${i}` } }
    case 'spacer':
      return { type, id, props: { size: 16 } }
    default:
      return { type: 'divider', id, props: {} }
  }
}

function genProducts(seed: number, n: number) {
  return Array.from({ length: n }, (_, k) => ({
    id: `p-${seed}-${k}`,
    title: `商品 ${seed}-${k}`,
    price: 99 + (seed % 50) + k * 10,
    image: `https://picsum.photos/seed/p${seed}${k}/200/200`,
    tag: k === 0 ? '热销' : undefined,
  }))
}
