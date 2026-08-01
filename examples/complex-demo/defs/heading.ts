import type { ComponentDef } from './_types'

/** 标题 */
export const headingDef: ComponentDef = {
  type: 'heading',
  displayName: '标题',
  description: '页面或区块标题,支持 1-6 级层级。用于分区标题、商品分类标题、活动主题等需要文字强调的位置。',
  category: '基础内容',
  defaultProps: { text: '区块标题', level: 2 },
}
