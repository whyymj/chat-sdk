import type { ComponentDef } from './_types'

/** 图标 */
export const iconDef: ComponentDef = {
  type: 'icon',
  displayName: '图标',
  description: '通用图标(emoji 或符号字符),用于强调/装饰/列表前缀/空状态。轻量不引大图标库,用 emoji 或 unicode 字符即可。',
  category: '基础内容',
  defaultProps: { name: '🎁', size: 24, color: '#e11d48' },
}
