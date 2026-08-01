/**
 * 深嵌套复杂专题页生成器 —— 结构复杂度测试数据(区别于 hugePage 的「扁平多」)
 *
 * hugePage 是 800 个扁平组件(测体量/1M/read 分页);
 * 本生成器产出**结构复杂、嵌套深**的页面(真实电商专题页结构 + 一个可控深度的递归嵌套区),
 * 专测:① 深 jsonPath patch(如 ...children.2.props.children.0.props.children.1.props.title);
 *      ② workingMemory 跨压缩保留深路径定位;③ schema 分层披露在深嵌套下的可读性。
 *
 * 加载:complex-demo URL 加 ?deep=1(App.vue 检测 → generateDeepNestedPage() 替代 initialPage)。
 * 叶子组件复用 defs 的 defaultProps(经 componentSchema 校验合规),容器组装嵌套。
 */
import { COMPONENT_DEF_BY_TYPE } from './defs'
import type { PageData } from './pageSchema'

/** 深拷贝(纯 JSON 数据,零环境依赖) */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** 按 type 造叶子组件实例(用 def defaultProps,可覆盖部分字段) */
function leaf(type: string, id: string, override?: Record<string, unknown>): Record<string, unknown> {
  const def = COMPONENT_DEF_BY_TYPE[type]
  const props = override ? { ...clone(def.defaultProps), ...override } : clone(def.defaultProps)
  return { type, id, props }
}

/**
 * 递归生成 depth 层深的「section > grid > [子...]」嵌套(测极深 jsonPath)。
 * 最深层的叶子是 card/button。每层 section 带 title、grid 2 列。
 */
function deepNest(depth: number, idPrefix: string): Record<string, unknown>[] {
  if (depth <= 0) {
    return [
      leaf('card', `${idPrefix}-c`, { title: `深层卡片(${idPrefix})`, text: '测深路径 patch 的目标。' }),
      leaf('button', `${idPrefix}-b`, { label: '深层按钮' }),
    ]
  }
  return [
    {
      type: 'section',
      id: `${idPrefix}-sec`,
      props: {
        title: `第 ${depth} 层嵌套区块`,
        children: [
          {
            type: 'grid',
            id: `${idPrefix}-grid`,
            props: { columns: 2, gap: 12, children: deepNest(depth - 1, `${idPrefix}-d`) },
          },
        ],
      },
    },
  ]
}

/**
 * 生成深嵌套复杂专题页。
 * @param nestDepth 递归嵌套区的深度(默认 5,最深路径约 10+ 段 jsonPath)
 */
export function generateDeepNestedPage(nestDepth = 5): PageData {
  return {
    title: `深嵌套复杂专题页(结构测试 · ${nestDepth} 层递归嵌套 · 深 jsonPath)`,
    components: [
      // —— 顶部导航 / 公告 / 头图 / 倒计时(叶子) ——
      leaf('navbar', 'nav', { title: '深嵌套测试专区' }),
      leaf('noticeBar', 'nb'),
      leaf('banner', 'bn'),
      leaf('countdown', 'cd'),

      // —— 领券中心:section > grid > coupons(2 层) ——
      {
        type: 'section', id: 'sec-coupon', props: { title: '💰 领券中心', children: [
          { type: 'grid', id: 'grid-coupon', props: { columns: 4, gap: 12, children: [
            leaf('coupon', 'cpn-0', { amount: 50, label: '新人券', threshold: 300 }),
            leaf('coupon', 'cpn-1', { amount: 100, label: '满减券', threshold: 1000 }),
            leaf('coupon', 'cpn-2', { amount: 30, label: '无门槛' }),
            leaf('coupon', 'cpn-3', { amount: 200, label: '大额券', threshold: 2000 }),
          ] } },
        ] },
      },

      // —— tabs:商品瀑布流 + 深嵌套测试区(tabs > 递归 section>grid,最深处测深 patch) ——
      {
        type: 'tabs', id: 'tabs-0', props: { tabs: [
          { label: '商品', children: [leaf('productGrid', 'pg-0')] },
          { label: '深嵌套测试区', children: deepNest(nestDepth, 'deep') },
        ] },
      },

      // —— 精选好物:section > grid > cards(2 层) ——
      {
        type: 'section', id: 'sec-pick', props: { title: '✨ 精选好物', children: [
          { type: 'grid', id: 'grid-pick', props: { columns: 3, gap: 16, children: [
            leaf('card', 'card-0', { title: '精选一', text: '测容器内组件的 patch。' }),
            leaf('card', 'card-1', { title: '精选二', text: '第二张卡片。' }),
            leaf('card', 'card-2', { title: '精选三', text: '第三张卡片。' }),
          ] } },
        ] },
      },

      // —— 统计 / 评分 / 时间线 / 页脚(叶子) ——
      leaf('stat', 'stat-0'),
      leaf('rating', 'rt-0'),
      leaf('timeline', 'tl-0'),
      leaf('footer', 'ft-0'),
    ],
  } as unknown as PageData
}
