<script setup lang="ts">
/** 下拉选择 */
defineProps<{ label: string; options: string[]; value?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-select" :id="id" :style="style" :class="className" v-show="visible !== false">
    <label class="select-label">{{ label }}</label>
    <select class="select-box">
      <option v-for="opt in options" :key="opt" :selected="opt === value">{{ opt }}</option>
    </select>
  </div>
</template>
<style scoped>
.cmp-select { margin-bottom: 8px; }
.select-label { display: block; font-size: 13px; margin-bottom: 4px; color: #555; }
.select-box { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
</style>
