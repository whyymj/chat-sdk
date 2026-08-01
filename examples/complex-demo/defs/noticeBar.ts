import type { ComponentDef } from './_types'

/** 公告栏 */
export const noticeBarDef: ComponentDef = {
  type: 'noticeBar',
  displayName: '公告栏',
  description: '顶部滚动公告条。用于促销通知、活动提醒、系统公告等单行强调信息(常配滚动动效)。',
  category: '基础内容',
  defaultProps: { text: '🎉 限时优惠:全场低至 5 折,满 300 减 30!', scrollable: true },
}
