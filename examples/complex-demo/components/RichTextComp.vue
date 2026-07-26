<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ html: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="c-richtext" v-html="html"></div>
  </CompWrapper>
</template>

<style scoped>
.c-richtext { line-height: 1.8; font-size: 14px; }
.c-richtext :deep(a) { color: #2563eb; text-decoration: underline; }
.c-richtext :deep(b) { font-weight: 700; }
.c-richtext :deep(ul) { padding-left: 22px; }
</style>
