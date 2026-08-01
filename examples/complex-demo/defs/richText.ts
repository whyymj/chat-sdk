import type { ComponentDef } from './_types'

/** 富文本 */
export const richTextDef: ComponentDef = {
  type: 'richText',
  displayName: '富文本',
  description: '支持 HTML 的富文本内容,可含 <b>/<i>/<a>/<p>/<ul>/<li> 等标签。用于活动规则、商品详情说明、图文混排段落。',
  category: '基础内容',
  defaultProps: { html: '<p>这是一段<strong>富文本</strong>描述,支持<a href="#">链接</a>与列表。</p>' },
}
