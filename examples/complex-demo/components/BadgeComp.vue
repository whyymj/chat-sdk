<script setup lang="ts">
/** 徽标:数字/文字/圆点角标(挂在图标按钮右上角或独立显示) */
defineProps<{ text: string; variant?: 'dot' | 'number' | 'text'; color?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <span
    v-if="variant === 'dot'"
    class="cmp-badge-dot"
    :id="id"
    :style="{ ...(style || {}), background: color || '#e11d48' }"
    :class="className"
    v-show="visible !== false"
  />
  <span
    v-else
    class="cmp-badge"
    :id="id"
    :style="{ ...(style || {}), background: color || '#e11d48' }"
    :class="className"
    v-show="visible !== false"
  >{{ text }}</span>
</template>
<style scoped>
.cmp-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 5px; border-radius: 999px; color: #fff; font-size: 11px; font-weight: 600; line-height: 1; }
.cmp-badge-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
</style>
