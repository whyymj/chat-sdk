import type { ComponentDef } from './_types'

/** 网格布局(可嵌套) */
export const gridDef: ComponentDef = {
  type: 'grid',
  displayName: '网格布局',
  description: '多列网格容器,子组件按列排布,支持列数(1-6)与间距。用于卡片/优惠券/权益图标的等距网格排列。',
  category: '容器',
  defaultProps: {
    columns: 3,
    gap: 12,
    children: [
      { type: 'button', props: { label: '按钮一' } },
      { type: 'button', props: { label: '按钮二' } },
      { type: 'button', props: { label: '按钮三' } },
    ],
  },
}
