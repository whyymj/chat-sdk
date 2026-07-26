<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ src: string; alt?: string; width?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <img class="c-image" :src="src" :alt="alt || ''" :style="{ width: width || '100%' }" />
  </CompWrapper>
</template>

<style scoped>
.c-image { max-width: 100%; border-radius: 8px; display: block; }
</style>
