<script setup lang="ts">
/** 进度条:百分比 bar + 可选文字 */
defineProps<{ percent: number; color?: string; trackColor?: string; height?: number; label?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-progress" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div class="progress-track" :style="{ height: (height || 8) + 'px', background: trackColor || '#eee' }">
      <div class="progress-fill" :style="{ width: Math.min(100, Math.max(0, percent)) + '%', background: color || '#667eea' }" />
    </div>
    <span v-if="label !== undefined" class="progress-label">{{ label }}</span>
  </div>
</template>
<style scoped>
.cmp-progress { display: flex; align-items: center; gap: 8px; }
.progress-track { flex: 1; border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; transition: width 0.3s; }
.progress-label { color: #666; font-size: 12px; min-width: 36px; text-align: right; }
</style>
