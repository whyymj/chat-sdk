<script setup lang="ts">
/** 面包屑 */
defineProps<{ items: { label: string; link?: string }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <nav class="cmp-breadcrumb" :id="id" :style="style" :class="className" v-show="visible !== false">
    <template v-for="(item, i) in items" :key="i">
      <a v-if="item.link" :href="item.link" class="bc-link">{{ item.label }}</a>
      <span v-else class="bc-current">{{ item.label }}</span>
      <span v-if="i < items.length - 1" class="bc-sep">/</span>
    </template>
  </nav>
</template>
<style scoped>
.cmp-breadcrumb { padding: 8px 16px; font-size: 13px; color: #888; }
.bc-link { color: #4338ca; text-decoration: none; }
.bc-current { color: #333; font-weight: 500; }
.bc-sep { margin: 0 6px; color: #ccc; }
</style>
