import type { ComponentDef } from './_types'

/** 面包屑 */
export const breadcrumbDef: ComponentDef = {
  type: 'breadcrumb',
  displayName: '面包屑',
  description: '层级路径导航(首页 > 分类 > 当前)。用于表明当前页面在站点层级中的位置,辅助返回上级。',
  category: '导航',
  defaultProps: {
    items: [
      { label: '首页', link: '#' },
      { label: '分类', link: '#' },
      { label: '当前页' },
    ],
  },
}
