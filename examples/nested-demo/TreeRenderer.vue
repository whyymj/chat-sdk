<script setup lang="ts">
/**
 * 递归页面渲染器 —— 自引用组件,渲染 window.Editor.PageInfo 的任意深度子树。
 *
 * window.Editor.PageInfo 由 App.vue 以 reactive() 挂载;Agent 经 edit_window_prop 改的是
 * 该 reactive 对象的子属性(不替换引用),故递归模板对 block.* 的依赖会响应式更新。
 *
 * 自引用:组件名 TreeRenderer 在 template 内递归 <TreeRenderer :nodes="block.children" :level="level+1" />。
 */
import type { Block } from './treeData'

defineProps<{ nodes: Block[]; level?: number }>()

// 把 style 对象压成可读的「key:val」串,展示自定义样式属性
function styleText(style: Block['style']): string {
  if (!style) return ''
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ')
}
</script>

<template>
  <ul class="tree">
    <li v-for="(block, i) in nodes" :key="block.id ?? i" class="tree-node">
      <div class="tree-row" :style="{ paddingLeft: (level ?? 0) * 18 + 'px' }">
        <span class="tree-icon">{{ block.type === 'section' ? '🗂️' : block.type === 'text' ? '📝' : block.type === 'button' ? '🔘' : block.type === 'image' ? '🖼️' : '🏷️' }}</span>
        <span class="tree-name" :class="{ section: block.type === 'section' }">{{ block.name }}</span>
        <span v-if="block.text" class="tree-text">「{{ block.text }}」</span>
        <span class="tree-type">{{ block.type }}</span>
        <span class="tree-id">#{{ block.id }}</span>
      </div>
      <div v-if="block.style" class="tree-style" :style="{ marginLeft: (level ?? 0) * 18 + 'px' }">
        🎨 {{ styleText(block.style) }}
      </div>
      <!-- 递归渲染 children -->
      <TreeRenderer v-if="block.children?.length" :nodes="block.children" :level="(level ?? 0) + 1" />
    </li>
  </ul>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding: 0; }
.tree-node { margin: 0; }
.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.4;
  transition: background 0.12s;
}
.tree-row:hover { background: rgba(99, 102, 241, 0.08); }
.tree-icon { font-size: 15px; }
.tree-name { color: #1f2937; }
.tree-name.section { font-weight: 600; color: #4338ca; }
.tree-text { color: #6b7280; font-size: 12px; }
.tree-type {
  margin-left: auto;
  color: #7c3aed;
  font-size: 11px;
  background: #f3e8ff;
  padding: 1px 6px;
  border-radius: 4px;
}
.tree-id {
  color: #9ca3af;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.tree-style {
  font-size: 12px;
  color: #059669;
  background: rgba(5, 150, 105, 0.06);
  padding: 3px 8px 3px 32px;
  border-radius: 6px;
  margin: 1px 8px 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  word-break: break-all;
}
</style>
