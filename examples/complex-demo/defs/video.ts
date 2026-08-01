import type { ComponentDef } from './_types'

/** 视频 */
export const videoDef: ComponentDef = {
  type: 'video',
  displayName: '视频',
  description: '视频播放组件,支持封面图、自动播放、控制条。用于商品视频介绍、活动宣传片、教程演示。',
  category: '基础内容',
  defaultProps: {
    src: 'https://example.com/demo.mp4',
    poster: 'https://picsum.photos/seed/poster/1200/400',
    controls: true,
  },
}
