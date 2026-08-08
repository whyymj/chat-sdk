<script setup lang="ts">
/**
 * 单组件递归渲染器 —— 按 comp.type 分发到业务组件
 *
 * 容器组件(container/section/grid)用 defineAsyncComponent 异步引用,
 * 容器内部再 import 本渲染器渲染 children,打破 A↔B 循环依赖。
 * 叶子组件静态 import;baseProps(id/style/visible/className)单独透传。
 */
import { defineAsyncComponent, computed, type Component } from 'vue'
import HeadingComp from './components/HeadingComp.vue'
import RichTextComp from './components/RichTextComp.vue'
import ProductGridComp from './components/ProductGridComp.vue'
import ImageComp from './components/ImageComp.vue'
import ButtonComp from './components/ButtonComp.vue'
import ListComp from './components/ListComp.vue'
import CardComp from './components/CardComp.vue'
import SpacerComp from './components/SpacerComp.vue'
import DividerComp from './components/DividerComp.vue'
import CarouselComp from './components/CarouselComp.vue'
import NavbarComp from './components/NavbarComp.vue'
import BannerComp from './components/BannerComp.vue'
import CountdownComp from './components/CountdownComp.vue'
import CouponComp from './components/CouponComp.vue'
import AccordionComp from './components/AccordionComp.vue'
import StatComp from './components/StatComp.vue'
import TimelineComp from './components/TimelineComp.vue'
import FooterComp from './components/FooterComp.vue'
import RatingComp from './components/RatingComp.vue'
import FormComp from './components/FormComp.vue'
import InputComp from './components/InputComp.vue'
import SelectComp from './components/SelectComp.vue'
import StepperComp from './components/StepperComp.vue'
import BreadcrumbComp from './components/BreadcrumbComp.vue'
import VideoComp from './components/VideoComp.vue'
import NoticeBarComp from './components/NoticeBarComp.vue'
import IconComp from './components/IconComp.vue'
import TagComp from './components/TagComp.vue'
import PriceComp from './components/PriceComp.vue'
import BadgeComp from './components/BadgeComp.vue'
import ProgressComp from './components/ProgressComp.vue'
import SkeletonComp from './components/SkeletonComp.vue'

const ContainerComp = defineAsyncComponent(() => import('./components/ContainerComp.vue'))
const SectionComp = defineAsyncComponent(() => import('./components/SectionComp.vue'))
const GridComp = defineAsyncComponent(() => import('./components/GridComp.vue'))
const TabsComp = defineAsyncComponent(() => import('./components/TabsComp.vue'))

const COMP_MAP: Record<string, Component> = {
  heading: HeadingComp,
  richText: RichTextComp,
  productGrid: ProductGridComp,
  image: ImageComp,
  button: ButtonComp,
  list: ListComp,
  card: CardComp,
  spacer: SpacerComp,
  divider: DividerComp,
  carousel: CarouselComp,
  container: ContainerComp,
  section: SectionComp,
  grid: GridComp,
  navbar: NavbarComp,
  banner: BannerComp,
  countdown: CountdownComp,
  coupon: CouponComp,
  tabs: TabsComp,
  accordion: AccordionComp,
  stat: StatComp,
  timeline: TimelineComp,
  footer: FooterComp,
  rating: RatingComp,
  form: FormComp,
  input: InputComp,
  select: SelectComp,
  stepper: StepperComp,
  breadcrumb: BreadcrumbComp,
  video: VideoComp,
  noticeBar: NoticeBarComp,
  icon: IconComp,
  tag: TagComp,
  price: PriceComp,
  badge: BadgeComp,
  progress: ProgressComp,
  skeleton: SkeletonComp,
}

const props = defineProps<{ comp: any; path?: string }>()
/** baseProps 通用渲染:布局字段(margin/padding/width/height/maxWidth/cursor)合并到 style;动画/响应式/主题入 class(经 fallthrough 继承到各专用组件根) */
const compStyle = computed<Record<string, string>>(() => {
  const c = props.comp || {}
  const s: Record<string, string> = { ...(c.style || {}) }
  if (c.margin) s.margin = c.margin
  if (c.padding) s.padding = c.padding
  if (c.width) s.width = c.width
  if (c.height) s.height = c.height
  if (c.maxWidth) s.maxWidth = c.maxWidth
  if (c.cursor) s.cursor = c.cursor
  return s
})
const compClass = computed<string[]>(() => {
  const c = props.comp || {}
  const cls: string[] = []
  if (c.className) cls.push(...String(c.className).split(/\s+/).filter(Boolean))
  if (c.animated && c.animation && c.animation !== 'none') cls.push(`anim-${c.animation}`)
  if (c.hoverEffect && c.hoverEffect !== 'none') cls.push(`hover-${c.hoverEffect}`)
  if (c.hideOnMobile) cls.push('hide-on-mobile')
  if (c.hideOnDesktop) cls.push('hide-on-desktop')
  if (c.theme) cls.push(`theme-${c.theme}`)
  return cls
})
</script>

<template>
  <component
    :is="COMP_MAP[comp.type] ?? 'div'"
    v-bind="comp.props"
    :id="comp.id"
    :style="compStyle"
    :class="compClass"
    :visible="comp.visible"
    :aria-label="comp.ariaLabel"
    :data-tooltip="comp.tooltip"
    :data-path="path"
  />
</template>
