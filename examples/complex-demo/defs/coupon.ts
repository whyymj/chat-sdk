import type { ComponentDef } from './_types'

/** 优惠券 */
export const couponDef: ComponentDef = {
  type: 'coupon',
  displayName: '优惠券',
  description: '单张优惠券,含面额/门槛/券名/状态(可领/已领/已用/过期)。用于领券中心、新人福利、满减券展示。',
  category: '商品营销',
  defaultProps: { amount: 50, threshold: 300, label: '新人券', status: 'available' },
}
