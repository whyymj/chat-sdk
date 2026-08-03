<script setup lang="ts">
/** 骨架屏:加载占位灰块(文本/卡片/头像/列表,可选闪烁) */
defineProps<{ variant?: 'text' | 'card' | 'avatar' | 'list'; rows?: number; shimmer?: boolean; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-skeleton" :class="[className, { shimmer: shimmer !== false }]" :id="id" :style="style" v-show="visible !== false">
    <template v-if="variant === 'avatar'">
      <div class="skel skel-avatar" />
    </template>
    <template v-else-if="variant === 'card'">
      <div class="skel skel-card" />
    </template>
    <template v-else-if="variant === 'list'">
      <div v-for="i in (rows || 3)" :key="i" class="skel skel-row" />
    </template>
    <template v-else>
      <div
        v-for="i in (rows || 3)"
        :key="i"
        class="skel skel-text"
        :style="{ width: i === (rows || 3) ? '60%' : '100%' }"
      />
    </template>
  </div>
</template>
<style scoped>
.cmp-skeleton { display: flex; flex-direction: column; gap: 8px; }
.skel { background: linear-gradient(90deg, #eee 25%, #f5f5f5 37%, #eee 63%); background-size: 400% 100%; border-radius: 4px; }
.shimmer .skel { animation: skel-shimmer 1.4s ease infinite; }
@keyframes skel-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.skel-text { height: 14px; }
.skel-row { height: 20px; }
.skel-avatar { width: 48px; height: 48px; border-radius: 50%; }
.skel-card { height: 120px; border-radius: 8px; }
</style>
