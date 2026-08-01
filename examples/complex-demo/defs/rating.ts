import type { ComponentDef } from './_types'

/** 评分 */
export const ratingDef: ComponentDef = {
  type: 'rating',
  displayName: '评分',
  description: '五星评分(0-5 分)与评价人数。用于商品/店铺综合评分展示、用户口碑摘要。',
  category: '商品营销',
  defaultProps: { score: 4.5, count: 1280 },
}
