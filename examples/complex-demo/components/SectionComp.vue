<script setup lang="ts">
/**
 * 区块组件 —— 带标题,children 任意嵌套
 * 业务字段(来自 props):title, children[]
 */
import CompWrapper from './CompWrapper.vue'
import CompRenderer from '../CompRenderer.vue'

defineProps<{
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
  title: string
  children?: any[]
}>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="section">
      <h3 class="section-title">{{ title }}</h3>
      <div class="section-body">
        <CompRenderer
          v-for="(c, i) in children"
          :key="(c.id ?? c.type) + '-' + i"
          :comp="c"
        />
      </div>
    </div>
  </CompWrapper>
</template>

<style scoped>
.section {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}
.section-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #d1d5db;
  color: #111827;
}
</style>
