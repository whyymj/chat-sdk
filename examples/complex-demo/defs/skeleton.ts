import type { ComponentDef } from './_types'

/** 骨架屏 */
export const skeletonDef: ComponentDef = {
  type: 'skeleton',
  displayName: '骨架屏',
  description: '内容加载占位灰块,用于异步数据未到位时的占位,避免空白闪烁。支持文本/卡片/头像/列表样式,可选闪烁动画。',
  category: '基础内容',
  defaultProps: { variant: 'text', rows: 3, shimmer: true },
}
