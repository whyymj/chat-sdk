<script setup lang="ts">
/** 手风琴(折叠项) */
import { ref } from 'vue'
const props = defineProps<{ items: { title: string; content: string }[]; expandFirst?: boolean; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
const openIdx = ref(props.expandFirst !== false ? 0 : -1)
const toggle = (i: number) => (openIdx.value = openIdx.value === i ? -1 : i)
</script>
<template>
  <div class="cmp-accordion" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div v-for="(item, i) in items" :key="i" class="acc-item" :class="{ open: openIdx === i }">
      <div class="acc-title" @click="toggle(i)"><span>{{ item.title }}</span><span class="acc-arrow">{{ openIdx === i ? '−' : '+' }}</span></div>
      <div v-show="openIdx === i" class="acc-content">{{ item.content }}</div>
    </div>
  </div>
</template>
<style scoped>
.cmp-accordion { border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
.acc-item + .acc-item { border-top: 1px solid #eee; }
.acc-title { display: flex; justify-content: space-between; padding: 12px 16px; font-weight: 600; cursor: pointer; background: #fafafa; }
.acc-arrow { color: #999; }
.acc-content { padding: 12px 16px; color: #555; font-size: 14px; line-height: 1.6; }
</style>
