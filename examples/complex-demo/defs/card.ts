import type { ComponentDef } from './_types'

/** 卡片 */
export const cardDef: ComponentDef = {
  type: 'card',
  displayName: '卡片',
  description: '信息卡片,含标题、正文、可选配图与链接。用于商品简介、权益说明、功能介绍等块状信息聚合。',
  category: '基础内容',
  defaultProps: {
    title: '卡片标题',
    text: '卡片正文描述,展示块状信息聚合。',
    image: 'https://picsum.photos/seed/card/400/200',
    link: '#',
  },
}
