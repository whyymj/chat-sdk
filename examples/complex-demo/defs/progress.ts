import type { ComponentDef } from './_types'

/** 进度条 */
export const progressDef: ComponentDef = {
  type: 'progress',
  displayName: '进度条',
  description: '百分比横向进度条,用于任务进度、加载进度、目标完成度、库存剩余、众筹进度。bar + 可选文字。',
  category: '基础内容',
  defaultProps: { percent: 60, color: '#667eea', height: 8, label: '60%' },
}
