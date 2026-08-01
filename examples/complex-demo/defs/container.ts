import type { ComponentDef } from './_types'

/** 通用容器(可嵌套) */
export const containerDef: ComponentDef = {
  type: 'container',
  displayName: '通用容器',
  description: '可嵌套任意子组件的通用容器,支持内边距。用于把多个组件编组、统一加边距/背景的场景。',
  category: '容器',
  defaultProps: {
    padding: 12,
    children: [{ type: 'heading', props: { text: '容器内标题', level: 3 } }],
  },
}
