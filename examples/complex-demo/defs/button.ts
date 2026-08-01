import type { ComponentDef } from './_types'

/** 按钮 */
export const buttonDef: ComponentDef = {
  type: 'button',
  displayName: '按钮',
  description: '可点击的操作按钮,支持 primary/secondary/ghost/danger 四种样式。用于「立即购买」「领取」「查看更多」等行动入口。',
  category: '基础内容',
  defaultProps: { label: '立即参与', variant: 'primary', action: '点击跳转活动页' },
}
