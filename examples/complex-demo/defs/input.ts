import type { ComponentDef } from './_types'

/** 输入框 */
export const inputDef: ComponentDef = {
  type: 'input',
  displayName: '输入框',
  description: '单行输入框,支持 text/number/email/password/tel 类型。用于搜索、订阅邮箱、手机号、留言等单项信息输入。',
  category: '表单交互',
  defaultProps: { label: '邮箱', placeholder: '请输入邮箱接收优惠', inputType: 'email' },
}
