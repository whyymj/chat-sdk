<script setup lang="ts">
/**
 * 网格布局组件 —— 子组件按列排布
 * 业务字段(来自 props):columns, gap?, children[]
 */
import { computed } from 'vue'
import CompWrapper from './CompWrapper.vue'
import CompRenderer from '../CompRenderer.vue'

const props = defineProps<{
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
  columns: number
  gap?: number
  children?: any[]
}>()

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
  gap: (props.gap ?? 12) + 'px',
}))
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div :style="gridStyle">
      <CompRenderer
        v-for="(c, i) in children"
        :key="(c.id ?? c.type) + '-' + i"
        :comp="c"
      />
    </div>
  </CompWrapper>
</template>
