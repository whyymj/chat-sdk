<script setup lang="ts">
/**
 * 页面渲染器 —— 读取并渲染 window.page(reactive)
 *
 * window.page 由 App.vue 在 setup 顶层以 reactive() 创建并挂载,
 * 此处取其引用;Agent 经 set_window_prop 改的是该 reactive 对象的属性
 * (不替换引用),故 template 对 page.* 的依赖会响应式更新。
 */
import { reactive } from 'vue'
import type { PageData } from './pageSchema'

const w = window as any
if (!w.page) {
  w.page = reactive({ title: '', theme: 'light', components: [] })
}
const page = w.page as PageData
</script>

<template>
  <div class="pr" :data-theme="page.theme || 'light'">
    <h1 class="pr-title">{{ page.title }}</h1>
    <div class="pr-body">
      <template v-for="(c, i) in page.components" :key="i">
        <h1 v-if="c.type === 'heading' && (c.level ?? 2) === 1" class="comp comp-h1">{{ c.text }}</h1>
        <h2 v-else-if="c.type === 'heading' && (c.level ?? 2) === 2" class="comp comp-h2">{{ c.text }}</h2>
        <h3 v-else-if="c.type === 'heading' && (c.level ?? 2) === 3" class="comp comp-h3">{{ c.text }}</h3>
        <h4 v-else-if="c.type === 'heading'" class="comp comp-h4">{{ c.text }}</h4>
        <p v-else-if="c.type === 'paragraph'" class="comp comp-paragraph">{{ c.text }}</p>
        <button
          v-else-if="c.type === 'button'"
          class="comp comp-button"
          :data-variant="c.variant || 'primary'"
        >
          {{ c.label }}
        </button>
        <img v-else-if="c.type === 'image'" class="comp comp-image" :src="c.src" :alt="c.alt || ''" />
        <ul v-else-if="c.type === 'list'" class="comp comp-list">
          <li v-for="(it, j) in c.items" :key="j">{{ it }}</li>
        </ul>
        <div v-else-if="c.type === 'card'" class="comp comp-card">
          <h3 class="card-title">{{ c.title }}</h3>
          <p class="card-text">{{ c.text }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pr {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 10px;
  min-height: calc(100vh - 48px);
}
.pr[data-theme='dark'] {
  background: #16181d;
  color: #e5e7eb;
}
.pr[data-theme='light'] {
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.pr-title {
  font-size: 20px;
  opacity: 0.6;
  border-bottom: 1px dashed currentColor;
  padding-bottom: 8px;
  margin-bottom: 16px;
  font-weight: 500;
}
.comp {
  margin: 12px 0;
}
.comp-h1 { font-size: 30px; font-weight: 700; }
.comp-h2 { font-size: 24px; font-weight: 700; }
.comp-h3 { font-size: 20px; font-weight: 600; }
.comp-h4 { font-size: 17px; font-weight: 600; }
.comp-paragraph { line-height: 1.7; opacity: 0.85; }
.comp-button {
  padding: 8px 18px;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
  margin: 4px 8px 4px 0;
}
.comp-button[data-variant='primary'] { background: #4f46e5; color: #fff; }
.comp-button[data-variant='secondary'] { background: #e5e7eb; color: #1a1a1a; }
.comp-button[data-variant='ghost'] { background: transparent; border: 1px solid currentColor; }
.comp-image { max-width: 100%; border-radius: 8px; }
.comp-list { padding-left: 22px; line-height: 1.8; }
.comp-list li { margin: 4px 0; }
.comp-card {
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 10px;
  padding: 16px;
}
.comp-card .card-title { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
.comp-card .card-text { margin: 0; opacity: 0.85; line-height: 1.6; }
</style>
