<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{
  columns: number
  gap?: number
  products: { id: string; title: string; price: number; image: string; tag?: string }[]
  id?: string
  style?: Record<string, string>
  visible?: boolean
  className?: string
}>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div
      class="c-grid"
      :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: (gap ?? 16) + 'px' }"
    >
      <div v-for="p in products" :key="p.id" class="c-card">
        <div class="c-card__img-wrap">
          <img :src="p.image" :alt="p.title" class="c-card__img" />
          <span v-if="p.tag" class="c-card__tag">{{ p.tag }}</span>
        </div>
        <div class="c-card__body">
          <p class="c-card__title">{{ p.title }}</p>
          <p class="c-card__price">¥{{ p.price.toFixed(2) }}</p>
        </div>
      </div>
    </div>
  </CompWrapper>
</template>

<style scoped>
.c-grid { display: grid; }
.c-card { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; transition: box-shadow 0.2s; }
.c-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
.c-card__img-wrap { position: relative; aspect-ratio: 1; background: #f3f4f6; }
.c-card__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.c-card__tag { position: absolute; top: 6px; left: 6px; background: #e11d48; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.c-card__body { padding: 10px 12px; }
.c-card__title { margin: 0 0 6px; font-size: 14px; color: #1f2937; line-height: 1.4; }
.c-card__price { margin: 0; font-size: 16px; font-weight: 700; color: #e11d48; }
</style>
