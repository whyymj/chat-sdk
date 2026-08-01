import type { ComponentDef } from './_types'

/** 导航栏 */
export const navbarDef: ComponentDef = {
  type: 'navbar',
  displayName: '导航栏',
  description: '页面顶部导航栏,含 logo、站点标题、菜单项。用于全站主导航、品类入口、品牌区展示。',
  category: '导航',
  defaultProps: {
    logo: 'https://picsum.photos/seed/logo/120/40',
    title: '示例站点',
    menu: [
      { label: '首页', link: '#' },
      { label: '商品', link: '#' },
    ],
  },
}
