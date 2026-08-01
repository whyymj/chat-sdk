import type { ComponentDef } from './_types'

/** 间距 */
export const spacerDef: ComponentDef = {
  type: 'spacer',
  displayName: '间距',
  description: '纯空白占位,按像素撑开垂直高度。用于组件间的呼吸感调节、模块分区间隔。',
  category: '布局',
  defaultProps: { height: 24 },
}
