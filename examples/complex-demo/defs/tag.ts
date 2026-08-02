import type { ComponentDef } from './_types'

/** 标签 */
export const tagDef: ComponentDef = {
  type: 'tag',
  displayName: '标签',
  description: '胶囊标签(如「新品」「热销」「限量」「包邮」「HOT」),商品或活动标记。纯色/描边两式,五色。常贴在商品卡角标、活动标题旁。',
  category: '基础内容',
  defaultProps: { text: '热销', color: 'red', variant: 'solid' },
}
