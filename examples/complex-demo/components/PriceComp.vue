<script setup lang="ts">
/** 价格:现价 + 原价划线 */
defineProps<{ current: number; original?: number; unit?: string; size?: 'sm' | 'md' | 'lg'; decimals?: number; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <span class="cmp-price" :class="[size || 'md', className]" :id="id" :style="style" v-show="visible !== false">
    <span class="price-current"><small class="price-unit">{{ unit || '¥' }}</small>{{ Number(current).toFixed(decimals ?? 2) }}</span>
    <span v-if="original != null && original > current" class="price-original">{{ unit || '¥' }}{{ Number(original).toFixed(decimals ?? 2) }}</span>
  </span>
</template>
<style scoped>
.cmp-price { display: inline-flex; align-items: baseline; gap: 8px; }
.price-current { color: #e11d48; font-weight: 800; letter-spacing: -0.5px; }
.price-unit { font-weight: 600; margin-right: 1px; }
.price-original { color: #9ca3af; text-decoration: line-through; font-weight: 400; }
.cmp-price.sm .price-current { font-size: 14px; } .cmp-price.sm .price-unit { font-size: 11px; } .cmp-price.sm .price-original { font-size: 12px; }
.cmp-price.md .price-current { font-size: 20px; } .cmp-price.md .price-unit { font-size: 13px; } .cmp-price.md .price-original { font-size: 13px; }
.cmp-price.lg .price-current { font-size: 28px; } .cmp-price.lg .price-unit { font-size: 16px; } .cmp-price.lg .price-original { font-size: 15px; }
</style>
