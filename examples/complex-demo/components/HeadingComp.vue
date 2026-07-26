<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ text: string; level?: number; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <h1 v-if="(level ?? 2) === 1" class="c-heading">{{ text }}</h1>
    <h2 v-else-if="(level ?? 2) === 2" class="c-heading">{{ text }}</h2>
    <h3 v-else-if="(level ?? 2) === 3" class="c-heading">{{ text }}</h3>
    <h4 v-else-if="(level ?? 2) === 4" class="c-heading">{{ text }}</h4>
    <h5 v-else-if="(level ?? 2) === 5" class="c-heading">{{ text }}</h5>
    <h6 v-else class="c-heading">{{ text }}</h6>
  </CompWrapper>
</template>

<style scoped>
.c-heading { margin: 0; font-weight: 700; }
</style>
