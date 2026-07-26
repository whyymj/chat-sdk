<script setup lang="ts">
/**
 * 通用容器组件 —— 可设内边距,children 任意嵌套
 * 业务字段(来自 props):padding?, children[]
 */
import CompWrapper from './CompWrapper.vue'
import CompRenderer from '../CompRenderer.vue'

defineProps<{
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
  padding?: number
  children?: any[]
}>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div :style="{ padding: (padding ?? 0) + 'px' }">
      <CompRenderer
        v-for="(c, i) in children"
        :key="(c.id ?? c.type) + '-' + i"
        :comp="c"
      />
    </div>
  </CompWrapper>
</template>
