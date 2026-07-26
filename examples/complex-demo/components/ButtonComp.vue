<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ label: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; action?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <button class="c-button" :data-variant="variant || 'primary'" :title="action">
      {{ label }}
    </button>
  </CompWrapper>
</template>

<style scoped>
.c-button {
  padding: 8px 20px; border: none; border-radius: 7px; cursor: pointer;
  font-size: 14px; font-weight: 600; transition: opacity 0.2s;
}
.c-button:hover { opacity: 0.9; }
.c-button[data-variant='primary'] { background: #4f46e5; color: #fff; }
.c-button[data-variant='secondary'] { background: #e5e7eb; color: #1f2937; }
.c-button[data-variant='ghost'] { background: transparent; border: 1px solid currentColor; color: inherit; }
.c-button[data-variant='danger'] { background: #e11d48; color: #fff; }
</style>
