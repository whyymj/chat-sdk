<script setup lang="ts">
/**
 * 页面渲染器 —— 顶层遍历 page.components,每个组件交给 CompRenderer 递归渲染
 *
 * window.page 由 App.vue 顶层 reactive 创建并挂载,此处取引用;
 * Agent 经 write 就地改 page 属性(含容器 children 嵌套),响应式触发。
 */
import { reactive } from 'vue'
import type { PageData } from './pageSchema'
import CompRenderer from './CompRenderer.vue'

const w = window as any
if (!w.page) {
  w.page = reactive({ title: '', components: [] })
}
const page = w.page as PageData
</script>

<template>
  <div class="pr">
    <h1 class="pr-title">{{ page.title }}</h1>
    <div class="pr-body">
      <CompRenderer
        v-for="(c, i) in page.components"
        :key="(c.id ?? c.type) + '-' + i"
        :comp="c"
      />
    </div>
  </div>
</template>

<style scoped>
.pr {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 820px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 10px;
  min-height: calc(100vh - 48px);
  background: #fff;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.pr-title {
  font-size: 22px;
  font-weight: 700;
  border-bottom: 1px dashed #d1d5db;
  padding-bottom: 10px;
  margin-bottom: 16px;
}
</style>
