<script setup lang="ts">
/** 图标:emoji / 符号字符 */
defineProps<{ name: string; size?: number; color?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <span class="cmp-icon" :class="className" :id="id" :style="{ fontSize: (size ?? 24) + 'px', color: color || 'inherit', ...(style || {}) }" v-show="visible !== false">{{ name }}</span>
</template>
<style scoped>
.cmp-icon { display: inline-block; line-height: 1; vertical-align: middle; }
</style>
