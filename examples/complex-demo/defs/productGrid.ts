import type { ComponentDef } from './_types'

/** 商品瀑布流 */
export const productGridDef: ComponentDef = {
  type: 'productGrid',
  displayName: '商品瀑布流',
  description: '商品多列网格,含商品标题/价格/主图/标签。电商专题页核心组件,用于商品列表、热销榜、推荐位展示。',
  category: '商品营销',
  defaultProps: {
    columns: 3,
    gap: 16,
    products: [
      { id: 'p1', title: '示例商品一', price: 99, image: 'https://picsum.photos/seed/p1/300/300', tag: '热销' },
      { id: 'p2', title: '示例商品二', price: 199, image: 'https://picsum.photos/seed/p2/300/300' },
      { id: 'p3', title: '示例商品三', price: 299, image: 'https://picsum.photos/seed/p3/300/300', tag: '新品' },
    ],
  },
}
