import type { ComponentDef } from './_types'

/** 标签页(可嵌套) */
export const tabsDef: ComponentDef = {
  type: 'tabs',
  displayName: '标签页',
  description: '多标签切换容器,每个标签下嵌套各自的子组件。用于「手机/电脑/配件」分类切换、商品多维度展示等同区域内容切换。',
  category: '容器',
  defaultProps: {
    tabs: [
      { label: '标签一', children: [{ type: 'heading', props: { text: '标签一内容', level: 3 } }] },
      { label: '标签二', children: [{ type: 'heading', props: { text: '标签二内容', level: 3 } }] },
    ],
  },
}
