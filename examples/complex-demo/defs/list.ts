import type { ComponentDef } from './_types'

/** 列表 */
export const listDef: ComponentDef = {
  type: 'list',
  displayName: '列表',
  description: '文本列表(有序/无序)。用于活动步骤、功能要点、商品卖点罗列等条目化文本。',
  category: '基础内容',
  defaultProps: {
    items: ['列表项一', '列表项二', '列表项三'],
    ordered: false,
  },
}
