import type { ComponentDef } from './_types'

/** 时间线 */
export const timelineDef: ComponentDef = {
  type: 'timeline',
  displayName: '时间线',
  description: '按时间点排列的事件列表。用于活动流程节点、订单进度、版本更新记录、物流轨迹等带时间属性的叙事。',
  category: '基础内容',
  defaultProps: {
    items: [
      { time: '2026-08-01', text: '活动开启,限量抢购' },
      { time: '2026-08-15', text: '活动结束' },
    ],
  },
}
