<script setup lang="ts">
/**
 * 组件包装器 —— 统一处理 BaseProps(id/style/visible/className)
 *
 * 10 种业务组件都经此包装:把 style 对象转成内联样式,visible=false 隐藏,
 * className 附加 class,id 设到根元素。业务组件只关心自己的 props。
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
}>(), {
  // visible 默认 true(显示);Vue 3 Boolean prop 无 default 时默认 false,会误隐藏,故显式设 true
  visible: true,
})

const wrapperStyle = computed(() => {
  // 把 camelCase 键转成 CSS 属性(如 textAlign → text-align);visible=false 时设 display:none
  // 用 :style 统一控制 display,避免 v-show 与 :style 的 inline style 冲突(display:none 不被 :style 清除)
  const s: Record<string, string> = {}
  if (props.style) for (const [k, v] of Object.entries(props.style)) s[k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = v
  if (props.visible === false) s.display = 'none'
  return s
})
</script>

<template>
  <div
    :id="id"
    :class="['comp-wrapper', className]"
    :style="wrapperStyle"
  >
    <slot />
  </div>
</template>

<style scoped>
.comp-wrapper { margin: 12px 0; }
</style>
