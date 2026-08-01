import type { ComponentDef } from './_types'

/** 步骤条 */
export const stepperDef: ComponentDef = {
  type: 'stepper',
  displayName: '步骤条',
  description: '横向步骤进度条,标注当前步骤。用于下单流程、开通引导、任务进度等线性流程的可视化。',
  category: '导航',
  defaultProps: {
    current: 1,
    steps: [
      { title: '选商品', description: '挑选心仪商品' },
      { title: '下单', description: '提交订单' },
      { title: '收货', description: '等待送达' },
    ],
  },
}
