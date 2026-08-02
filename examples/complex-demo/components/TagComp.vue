<script setup lang="ts">
/** 标签:胶囊(纯色/描边,五色) */
defineProps<{ text: string; color?: 'red' | 'blue' | 'green' | 'gray' | 'orange'; variant?: 'solid' | 'outline'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <span class="cmp-tag" :class="[color || 'red', variant || 'solid', className]" :id="id" :style="style" v-show="visible !== false">{{ text }}</span>
</template>
<style scoped>
.cmp-tag {
  display: inline-block; padding: 2px 10px; font-size: 12px; font-weight: 600;
  border-radius: 999px; line-height: 1.6; white-space: nowrap; letter-spacing: .5px;
}
.cmp-tag.solid.red { background: #e11d48; color: #fff; }
.cmp-tag.solid.blue { background: #2563eb; color: #fff; }
.cmp-tag.solid.green { background: #16a34a; color: #fff; }
.cmp-tag.solid.orange { background: #ea580c; color: #fff; }
.cmp-tag.solid.gray { background: #6b7280; color: #fff; }
.cmp-tag.outline.red { color: #e11d48; border: 1px solid #e11d48; background: transparent; }
.cmp-tag.outline.blue { color: #2563eb; border: 1px solid #2563eb; background: transparent; }
.cmp-tag.outline.green { color: #16a34a; border: 1px solid #16a34a; background: transparent; }
.cmp-tag.outline.orange { color: #ea580c; border: 1px solid #ea580c; background: transparent; }
.cmp-tag.outline.gray { color: #6b7280; border: 1px solid #d1d5db; background: transparent; }
</style>
