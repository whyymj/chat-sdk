<script setup lang="ts">
/** 公告栏(滚动) */
defineProps<{ text: string; scrollable?: boolean; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-notice" :id="id" :style="style" :class="className" v-show="visible !== false">
    <span class="notice-tag">公告</span>
    <div class="notice-track" :class="{ scroll: scrollable !== false }"><span class="notice-text">{{ text }}</span></div>
  </div>
</template>
<style scoped>
.cmp-notice { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #fffbeb; border-radius: 4px; overflow: hidden; }
.notice-tag { background: #f59e0b; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }
.notice-track { overflow: hidden; flex: 1; }
.notice-text { color: #92400e; font-size: 13px; white-space: nowrap; }
.notice-track.scroll .notice-text { display: inline-block; animation: notice-scroll 12s linear infinite; padding-left: 100%; }
@keyframes notice-scroll { to { transform: translateX(-100%); } }
</style>
