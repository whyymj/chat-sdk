import type { ComponentDef } from './_types'

/** 表单 */
export const formDef: ComponentDef = {
  type: 'form',
  displayName: '表单',
  description: '多字段表单,支持 text/textarea/number/select/checkbox 字段类型与必填标记。用于预约、调研、订阅、反馈等信息采集。',
  category: '表单交互',
  defaultProps: {
    action: '提交',
    fields: [
      { name: 'name', label: '姓名', type: 'text', required: true, placeholder: '请输入姓名' },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可选,想对我们说的' },
    ],
  },
}
