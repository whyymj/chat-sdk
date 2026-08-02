import type { ComponentDef } from './_types'

/** 价格 */
export const priceDef: ComponentDef = {
  type: 'price',
  displayName: '价格',
  description: '商品价格(现价 + 可选原价划线),电商必备。支持小数位/货币单位/三档字号。常与商品卡/列表/详情搭配。',
  category: '商品营销',
  defaultProps: { current: 199, original: 299, unit: '¥', size: 'md', decimals: 2 },
}
