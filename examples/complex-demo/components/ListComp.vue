<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ items: string[]; ordered?: boolean; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <ol v-if="ordered" class="c-list">
      <li v-for="(it, i) in items" :key="i">{{ it }}</li>
    </ol>
    <ul v-else class="c-list">
      <li v-for="(it, i) in items" :key="i">{{ it }}</li>
    </ul>
  </CompWrapper>
</template>

<style scoped>
.c-list { padding-left: 22px; line-height: 1.8; font-size: 14px; color: #374151; }
</style>
