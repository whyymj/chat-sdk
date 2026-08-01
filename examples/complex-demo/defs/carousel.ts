import type { ComponentDef } from './_types'

/** 轮播 */
export const carouselDef: ComponentDef = {
  type: 'carousel',
  displayName: '轮播',
  description: '多图轮播组件,支持自动播放与切换间隔。用于首页焦点图、多活动 Banner 轮播、商品橱窗展示。',
  category: '基础内容',
  defaultProps: {
    autoplay: true,
    interval: 3000,
    slides: [
      { image: 'https://picsum.photos/seed/s1/1200/400', caption: '第一张轮播图' },
      { image: 'https://picsum.photos/seed/s2/1200/400', caption: '第二张轮播图' },
    ],
  },
}
