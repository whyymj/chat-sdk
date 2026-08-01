import type { ComponentDef } from './_types'

/** 手风琴(折叠) */
export const accordionDef: ComponentDef = {
  type: 'accordion',
  displayName: '手风琴',
  description: '可折叠的问答/条目列表,默认可展开第一项。用于常见问题 FAQ、帮助中心、多条目折叠展示。',
  category: '基础内容',
  defaultProps: {
    items: [
      { title: '常见问题一?', content: '对应答案一:展开后显示的详细说明。' },
      { title: '常见问题二?', content: '对应答案二:展开后显示的详细说明。' },
    ],
    expandFirst: true,
  },
}
