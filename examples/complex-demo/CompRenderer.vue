<script setup lang="ts">
/**
 * 单组件递归渲染器 —— 按 comp.type 分发到业务组件
 *
 * 容器组件(container/section/grid)用 defineAsyncComponent 异步引用,
 * 容器内部再 import 本渲染器渲染 children,打破 A↔B 循环依赖。
 * 叶子组件静态 import;baseProps(id/style/visible/className)单独透传。
 */
import { defineAsyncComponent, type Component } from 'vue'
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

const ContainerComp = defineAsyncComponent(() => import('./components/ContainerComp.vue'))
const SectionComp = defineAsyncComponent(() => import('./components/SectionComp.vue'))
const GridComp = defineAsyncComponent(() => import('./components/GridComp.vue'))

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
}

defineProps<{ comp: any }>()
</script>

<template>
  <component
    :is="COMP_MAP[comp.type] ?? 'div'"
    v-bind="comp.props"
    :id="comp.id"
    :style="comp.style"
    :visible="comp.visible"
    :className="comp.className"
  />
</template>
