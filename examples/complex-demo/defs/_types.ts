/**
 * 组件定义文件化的统一契约 —— 每个组件一个 def 文件,聚合进 registry(index.ts)。
 *
 * 一份 def 同时服务三个用途:
 *  ① 组件业务说明文档(#68):读 description / displayName / category
 *  ② 实例数据拼装(initialPage/hugePage):读 defaultProps(合法样板)
 *  ③ 注册表(#66 扩到 80 的基座):COMPONENT_DEFS 聚合,新组件加一个 def 文件即可
 *
 * schema 仍集中在 pageSchema.ts(不在此声明);defaultProps 须人工保证符合对应 schema。
 */

/** 组件分类(便于文档分组 / UI 筛选) */
export type ComponentCategory = '基础内容' | '布局' | '容器' | '商品营销' | '导航' | '表单交互'

export interface ComponentDef {
  /** 组件 type(对应 pageSchema componentSchema 的 discriminator 值) */
  type: string
  /** 中文名(文档/UI 展示用) */
  displayName: string
  /** 业务说明:何时用 + 典型场景(#68 文档源) */
  description: string
  /** 分类 */
  category: ComponentCategory
  /** 示例 props(合法,严格符合 pageSchema 对应 schema;用于实例拼装) */
  defaultProps: Record<string, unknown>
}
