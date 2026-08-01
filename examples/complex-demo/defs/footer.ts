import type { ComponentDef } from './_types'

/** 页脚 */
export const footerDef: ComponentDef = {
  type: 'footer',
  displayName: '页脚',
  description: '页面底部页脚,含链接组、版权信息、联系方式。用于法律声明、帮助链接、客服入口等页面收尾。',
  category: '导航',
  defaultProps: {
    links: [
      { label: '关于我们', link: '#' },
      { label: '联系客服', link: '#' },
    ],
    contact: '客服热线:400-xxx-xxxx',
    copyright: '© 2026 示例站点',
  },
}
