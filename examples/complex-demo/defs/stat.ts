import type { ComponentDef } from './_types'

/** 统计数据 */
export const statDef: ComponentDef = {
  type: 'stat',
  displayName: '统计数据',
  description: '关键指标统计展示(数字 + 说明)。用于「10万+ 参与用户」「5000万 成交额」等营造活动规模感的数字陈列。',
  category: '商品营销',
  defaultProps: {
    items: [
      { number: '10万+', label: '参与用户' },
      { number: '4.9分', label: '用户评分' },
    ],
  },
}
