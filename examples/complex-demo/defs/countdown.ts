import type { ComponentDef } from './_types'

/** 倒计时 */
export const countdownDef: ComponentDef = {
  type: 'countdown',
  displayName: '倒计时',
  description: '距目标结束时间的倒计时(天/时/分/秒)。用于秒杀、限时折扣、活动截止提醒等营造紧迫感的营销场景。',
  category: '商品营销',
  defaultProps: { targetTime: '2026-08-20 23:59:59' },
}
