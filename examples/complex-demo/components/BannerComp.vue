<script setup lang="ts">
/** 横幅(静态图,区别于 carousel 轮播) */
defineProps<{ image: string; link?: string; text?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <a class="cmp-banner" :id="id" :style="style" :class="className" v-show="visible !== false" :href="link || 'javascript:;'">
    <img :src="image" class="banner-img" alt="banner" />
    <span v-if="text" class="banner-text">{{ text }}</span>
  </a>
</template>
<style scoped>
.cmp-banner { display: block; position: relative; overflow: hidden; border-radius: 8px; }
.banner-img { display: block; width: 100%; }
.banner-text { position: absolute; left: 16px; bottom: 12px; color: #fff; font-size: 18px; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.5); }
</style>
