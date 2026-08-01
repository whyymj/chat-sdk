<script setup lang="ts">
/**
 * 标签页(容器组件,递归):每个 tab 下可嵌套任意子组件
 * 用 defineAsyncComponent 引 CompRenderer 打破循环(同 container/section/grid)
 */
import { ref, defineAsyncComponent } from 'vue'
const CompRenderer = defineAsyncComponent(() => import('../CompRenderer.vue'))
defineProps<{ tabs: { label: string; children: any[] }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
const active = ref(0)
</script>
<template>
  <div class="cmp-tabs" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div class="tabs-nav">
      <div v-for="(tab, i) in tabs" :key="i" class="tab-label" :class="{ active: active === i }" @click="active = i">{{ tab.label }}</div>
    </div>
    <div class="tabs-content">
      <div v-for="(tab, i) in tabs" v-show="active === i" :key="i" class="tab-panel">
        <CompRenderer v-for="(child, j) in tab.children" :key="j" :comp="child" />
      </div>
    </div>
  </div>
</template>
<style scoped>
.cmp-tabs { background: #fff; border-radius: 8px; overflow: hidden; }
.tabs-nav { display: flex; border-bottom: 1px solid #eee; }
.tab-label { padding: 12px 20px; cursor: pointer; color: #666; font-size: 14px; }
.tab-label.active { color: #e11d48; font-weight: 600; border-bottom: 2px solid #e11d48; }
.tab-panel { padding: 12px; }
</style>
