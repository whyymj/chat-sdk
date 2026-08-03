import type { ComponentDef } from './_types'

/** 徽标 */
export const badgeDef: ComponentDef = {
  type: 'badge',
  displayName: '徽标',
  description: '数字/文字小红点角标,用于未读数、新品标、提醒数、库存紧张提示。常挂在图标/按钮右上角或独立显示。',
  category: '基础内容',
  defaultProps: { text: 'NEW', variant: 'text', color: '#e11d48' },
}
