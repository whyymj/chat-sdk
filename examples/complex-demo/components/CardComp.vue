<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ title: string; text: string; image?: string; link?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="c-card">
      <img v-if="image" class="c-card__img" :src="image" :alt="title" />
      <div class="c-card__body">
        <h3 class="c-card__title">{{ title }}</h3>
        <p class="c-card__text">{{ text }}</p>
        <a v-if="link" class="c-card__link" :href="link">查看详情 ›</a>
      </div>
    </div>
  </CompWrapper>
</template>

<style scoped>
.c-card { display: flex; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; }
.c-card__img { width: 160px; object-fit: cover; flex-shrink: 0; }
.c-card__body { padding: 14px 16px; flex: 1; }
.c-card__title { margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #1f2937; }
.c-card__text { margin: 0 0 10px; font-size: 13px; line-height: 1.6; color: #4b5563; }
.c-card__link { font-size: 13px; color: #2563eb; text-decoration: none; }
</style>
