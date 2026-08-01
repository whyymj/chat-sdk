<script setup lang="ts">
/** 视频 */
defineProps<{ src: string; poster?: string; autoplay?: boolean; controls?: boolean; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <video class="cmp-video" :id="id" :style="style" :class="className" v-show="visible !== false" :src="src" :poster="poster" :autoplay="autoplay" :controls="controls !== false" preload="metadata" />
</template>
<style scoped>
.cmp-video { display: block; width: 100%; border-radius: 8px; }
</style>
