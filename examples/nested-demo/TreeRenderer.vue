<script setup lang="ts">
/**
 * 递归页面渲染器 —— 自引用组件,渲染 window.Editor.PageInfo 的任意深度子树。
 *
 * window.Editor.PageInfo 为普通对象(非 reactive);App.vue 在 onEvent('data_change')
 * 或人工编辑时 tick++,以 :key="tick" 强制本组件重建,重建时读最新 nodes prop 渲染。
 *
 * 自引用:组件名 TreeRenderer 在 template 内递归 <TreeRenderer :nodes="block.children" :level="level+1" />。
 */
import type { Block } from './treeData'

const props = defineProps<{ nodes: Block[]; level?: number; selectedId?: string }>()
const emit = defineEmits<{ (e: 'select', block: Block): void }>()

function onSelect(block: Block) {
  emit('select', block)
}

// 把 style 对象压成可读的「key:val」串,展示自定义样式属性
function styleText(style: Block['style']): string {
  if (!style) return ''
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(' · ')
}

// 把 style 对象转成 Vue 内联样式对象,应用到区块名/文案,让样式改动「肉眼可见」。
// 只取视觉相关键;过滤 padding/margin/display 等会破坏树布局的键。
const VISUAL_KEYS = new Set(['color', 'background', 'backgroundColor', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'borderRadius', 'border', 'opacity'])
function previewStyle(style: Block['style']): Record<string, string | number> | undefined {
  if (!style) return undefined
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(style)) {
    if (VISUAL_KEYS.has(k) && v != null) out[k] = v as string | number
  }
  return Object.keys(out).length ? out : undefined
}
</script>

<template>
  <ul class="tree">
    <li v-for="(block, i) in nodes" :key="block.id ?? i" class="tree-node">
      <div
        class="tree-row"
        :class="{ selected: props.selectedId === block.id }"
        :style="{ paddingLeft: (level ?? 0) * 18 + 'px' }"
        @click="onSelect(block)"
      >
        <span class="tree-icon">{{ block.type === 'section' ? '🗂️' : block.type === 'text' ? '📝' : block.type === 'button' ? '🔘' : block.type === 'image' ? '🖼️' : '🏷️' }}</span>
        <span class="tree-name" :class="{ section: block.type === 'section' }" :style="previewStyle(block.style)">{{ block.name }}</span>
        <span v-if="block.text" class="tree-text" :style="previewStyle(block.style)">「{{ block.text }}」</span>
        <span class="tree-type">{{ block.type }}</span>
        <span class="tree-id">#{{ block.id }}</span>
      </div>
      <div v-if="block.style" class="tree-style" :style="{ marginLeft: (level ?? 0) * 18 + 'px' }">
        🎨 {{ styleText(block.style) }}
      </div>
      <!-- 递归渲染 children:透传 selectedId 与 select 事件 -->
      <TreeRenderer
        v-if="block.children?.length"
        :nodes="block.children"
        :level="(level ?? 0) + 1"
        :selected-id="props.selectedId"
        @select="emit('select', $event)"
      />
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
.tree-row { cursor: pointer; }
.tree-row.selected { background: rgba(99, 102, 241, 0.16); outline: 2px solid rgba(99, 102, 241, 0.55); }
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
