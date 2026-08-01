import type { ComponentDef } from './_types'

/** 下拉选择 */
export const selectDef: ComponentDef = {
  type: 'select',
  displayName: '下拉选择',
  description: '下拉选择框,从可选项中选一个。用于品类筛选、数量选择、偏好设置等枚举值选取。',
  category: '表单交互',
  defaultProps: { label: '兴趣分类', options: ['手机', '电脑', '家电'], value: '手机' },
}
