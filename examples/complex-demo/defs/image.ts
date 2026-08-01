import type { ComponentDef } from './_types'

/** 图片 */
export const imageDef: ComponentDef = {
  type: 'image',
  displayName: '图片',
  description: '单张图片展示。用于商品配图、活动头图、Banner 静态图、装饰性插图等。',
  category: '基础内容',
  defaultProps: {
    src: 'https://picsum.photos/seed/demo/320/240',
    alt: '示例图片',
    width: '100%',
  },
}
