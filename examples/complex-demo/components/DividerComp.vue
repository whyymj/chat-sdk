<script setup lang="ts">
import CompWrapper from './CompWrapper.vue'
defineProps<{ label?: string; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>

<template>
  <CompWrapper :id="id" :style="style" :visible="visible" :className="className">
    <div class="c-divider" :data-has-label="!!label">
      <span v-if="label" class="c-divider__label">{{ label }}</span>
    </div>
  </CompWrapper>
</template>

<style scoped>
.c-divider { display: flex; align-items: center; text-align: center; color: #9ca3af; font-size: 13px; }
.c-divider::before, .c-divider::after { content: ''; flex: 1; border-top: 1px solid #e5e7eb; }
.c-divider[data-has-label='false']::before { margin-right: 0; }
.c-divider__label { padding: 0 14px; }
</style>
