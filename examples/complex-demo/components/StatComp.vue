<script setup lang="ts">
/** 统计数据:数字 + 标签(多列) */
defineProps<{ items: { number: string; label: string }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-stat" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div v-for="(item, i) in items" :key="i" class="stat-item">
      <div class="stat-num">{{ item.number }}</div>
      <div class="stat-label">{{ item.label }}</div>
    </div>
  </div>
</template>
<style scoped>
.cmp-stat { display: flex; justify-content: space-around; padding: 16px; background: #fff; border-radius: 8px; }
.stat-item { text-align: center; }
.stat-num { color: #e11d48; font-size: 24px; font-weight: 800; }
.stat-label { color: #888; font-size: 12px; margin-top: 4px; }
</style>
