import type { ComponentDef } from './_types'

/** 横幅(静态图) */
export const bannerDef: ComponentDef = {
  type: 'banner',
  displayName: '横幅',
  description: '静态横幅图(区别于 carousel 轮播),可叠加文字与跳转链接。用于活动主视觉、单张促销海报、品类入口图。',
  category: '商品营销',
  defaultProps: {
    image: 'https://picsum.photos/seed/banner/1200/200',
    link: '#',
    text: '年中盛典 低至 5 折',
  },
}
