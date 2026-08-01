import type { ComponentDef } from './_types'

/** 带标题区块(可嵌套) */
export const sectionDef: ComponentDef = {
  type: 'section',
  displayName: '带标题区块',
  description: '带标题的区块容器,标题下嵌套任意子组件。用于「领券中心」「精选好物」等模块化分区,是最常用的内容编排容器。',
  category: '容器',
  defaultProps: {
    title: '区块标题',
    children: [{ type: 'heading', props: { text: '子标题', level: 3 } }],
  },
}
