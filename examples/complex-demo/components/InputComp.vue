<script setup lang="ts">
/** 输入框(单字段,展示型) */
defineProps<{ label: string; placeholder?: string; inputType?: 'text' | 'number' | 'email' | 'password' | 'tel'; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-input" :id="id" :style="style" :class="className" v-show="visible !== false">
    <label class="input-label">{{ label }}</label>
    <input class="input-box" :type="inputType || 'text'" :placeholder="placeholder" />
  </div>
</template>
<style scoped>
.cmp-input { margin-bottom: 8px; }
.input-label { display: block; font-size: 13px; margin-bottom: 4px; color: #555; }
.input-box { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
</style>
