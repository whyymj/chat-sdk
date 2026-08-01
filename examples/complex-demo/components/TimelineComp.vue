<script setup lang="ts">
/** 时间线 */
defineProps<{ items: { time: string; text: string }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-timeline" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div v-for="(item, i) in items" :key="i" class="tl-item">
      <div class="tl-dot"></div>
      <div class="tl-content"><div class="tl-time">{{ item.time }}</div><div class="tl-text">{{ item.text }}</div></div>
    </div>
  </div>
</template>
<style scoped>
.cmp-timeline { padding: 12px 16px; }
.tl-item { display: flex; gap: 12px; padding-bottom: 16px; position: relative; }
.tl-item::before { content: ''; position: absolute; left: 5px; top: 16px; bottom: 0; width: 2px; background: #eee; }
.tl-dot { width: 12px; height: 12px; border-radius: 50%; background: #e11d48; flex-shrink: 0; margin-top: 4px; z-index: 1; }
.tl-time { color: #999; font-size: 12px; }
.tl-text { color: #333; font-size: 14px; margin-top: 2px; }
</style>
