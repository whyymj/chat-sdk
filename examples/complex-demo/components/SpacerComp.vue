<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ height: number; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="c-spacer" :style="{ height: height + 'px' }"></div>
  </CompWrapper>
</template>

<style scoped>
.c-spacer { width: 100%; }
</style>
