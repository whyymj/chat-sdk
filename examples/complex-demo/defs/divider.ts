import type { ComponentDef } from './_types'

/** 分割线 */
export const dividerDef: ComponentDef = {
  type: 'divider',
  displayName: '分割线',
  description: '水平分割线,可带中间文字(如「活动说明」)。用于内容区块的视觉分隔、章节过渡。',
  category: '布局',
  defaultProps: { label: '分割' },
}
