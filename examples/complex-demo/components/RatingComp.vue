<script setup lang="ts">
/** 评分:星星 + 评价人数 */
defineProps<{ score: number; count?: number; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-rating" :id="id" :style="style" :class="className" v-show="visible !== false">
    <span class="rating-stars">
      <span v-for="i in 5" :key="i" class="star" :class="{ full: i <= Math.round(score) }">★</span>
    </span>
    <span class="rating-score">{{ score.toFixed(1) }}</span>
    <span v-if="count !== undefined" class="rating-count">({{ count }}人评价)</span>
  </div>
</template>
<style scoped>
.cmp-rating { display: flex; align-items: center; gap: 8px; }
.rating-stars { display: inline-flex; }
.star { color: #ddd; font-size: 18px; }
.star.full { color: #f59e0b; }
.rating-score { font-weight: 700; color: #f59e0b; }
.rating-count { color: #888; font-size: 12px; }
</style>
