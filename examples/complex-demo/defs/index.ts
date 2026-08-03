/**
 * 组件定义 registry —— 聚合全部组件 def。
 *
 * 用途:
 *  - COMPONENT_DEFS:有序数组(全量组件,按 category 分组排)
 *  - COMPONENT_DEF_BY_TYPE:type → def 映射(hugePage 实例拼装 / 按 type 取样板)
 *  - COMPONENT_DEFS_BY_CATEGORY:category → def[] 分组(#68 文档按类生成)
 *  - CATEGORIES:分类有序列表
 *
 * 新增组件(#66 扩到 80):加一个 def 文件 + 在此 import + push 进 COMPONENT_DEFS 即可,
 * BY_TYPE / BY_CATEGORY 自动派生,无需改其他地方。
 */
import type { ComponentCategory, ComponentDef } from './_types'

// 基础内容(11)
import { headingDef } from './heading'
import { richTextDef } from './richText'
import { imageDef } from './image'
import { buttonDef } from './button'
import { listDef } from './list'
import { cardDef } from './card'
import { carouselDef } from './carousel'
import { accordionDef } from './accordion'
import { timelineDef } from './timeline'
import { videoDef } from './video'
import { noticeBarDef } from './noticeBar'
// 布局(2)
import { spacerDef } from './spacer'
import { dividerDef } from './divider'
// 容器(4)
import { containerDef } from './container'
import { sectionDef } from './section'
import { gridDef } from './grid'
import { tabsDef } from './tabs'
// 商品营销(6)
import { productGridDef } from './productGrid'
import { bannerDef } from './banner'
import { countdownDef } from './countdown'
import { couponDef } from './coupon'
import { statDef } from './stat'
import { ratingDef } from './rating'
// 导航(4)
import { navbarDef } from './navbar'
import { footerDef } from './footer'
import { stepperDef } from './stepper'
import { breadcrumbDef } from './breadcrumb'
// 表单交互(3)
import { formDef } from './form'
import { inputDef } from './input'
import { selectDef } from './select'
import { iconDef } from './icon'
import { tagDef } from './tag'
import { priceDef } from './price'
import { badgeDef } from './badge'
import { progressDef } from './progress'
import { skeletonDef } from './skeleton'

export { type ComponentCategory, type ComponentDef } from './_types'

/** 全量组件定义(按 category 分组有序) */
export const COMPONENT_DEFS: ComponentDef[] = [
  // 基础内容
  headingDef, richTextDef, imageDef, buttonDef, listDef, cardDef, carouselDef, accordionDef, timelineDef, videoDef, noticeBarDef, iconDef, tagDef, badgeDef, progressDef, skeletonDef,
  // 布局
  spacerDef, dividerDef,
  // 容器
  containerDef, sectionDef, gridDef, tabsDef,
  // 商品营销
  productGridDef, bannerDef, countdownDef, couponDef, statDef, ratingDef, priceDef,
  // 导航
  navbarDef, footerDef, stepperDef, breadcrumbDef,
  // 表单交互
  formDef, inputDef, selectDef,
]

/** type → def 映射 */
export const COMPONENT_DEF_BY_TYPE: Record<string, ComponentDef> = Object.fromEntries(
  COMPONENT_DEFS.map((d) => [d.type, d]),
)

/** 分类有序列表 */
export const CATEGORIES: ComponentCategory[] = ['基础内容', '布局', '容器', '商品营销', '导航', '表单交互']

/** category → def[] 分组 */
export const COMPONENT_DEFS_BY_CATEGORY: Record<ComponentCategory, ComponentDef[]> = Object.fromEntries(
  CATEGORIES.map((c) => [c, COMPONENT_DEFS.filter((d) => d.category === c)]),
) as Record<ComponentCategory, ComponentDef[]>
