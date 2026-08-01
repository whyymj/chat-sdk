<script setup lang="ts">
/** 倒计时:显示距 targetTime 剩余天/时/分/秒(每秒更新) */
import { onMounted, onUnmounted, ref, computed } from 'vue'
const props = defineProps<{ targetTime: string; labels?: { days?: string; hours?: string; minutes?: string; seconds?: string }; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
const now = ref(Date.now())
let timer: any
onMounted(() => { timer = setInterval(() => (now.value = Date.now()), 1000) })
onUnmounted(() => clearInterval(timer))
const remain = computed(() => {
  const diff = Math.max(0, new Date(props.targetTime).getTime() - now.value)
  const s = Math.floor(diff / 1000)
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), sec: s % 60 }
})
</script>
<template>
  <div class="cmp-countdown" :id="id" :style="style" :class="className" v-show="visible !== false">
    <span class="cd-item">{{ remain.d }}<small>{{ labels?.days || '天' }}</small></span>
    <span class="cd-sep">:</span>
    <span class="cd-item">{{ String(remain.h).padStart(2, '0') }}<small>{{ labels?.hours || '时' }}</small></span>
    <span class="cd-sep">:</span>
    <span class="cd-item">{{ String(remain.m).padStart(2, '0') }}<small>{{ labels?.minutes || '分' }}</small></span>
    <span class="cd-sep">:</span>
    <span class="cd-item">{{ String(remain.sec).padStart(2, '0') }}<small>{{ labels?.seconds || '秒' }}</small></span>
  </div>
</template>
<style scoped>
.cmp-countdown { display: flex; align-items: baseline; gap: 4px; justify-content: center; padding: 12px; }
.cd-item { background: #e11d48; color: #fff; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 18px; }
.cd-item small { font-size: 11px; font-weight: 400; margin-left: 2px; }
.cd-sep { color: #e11d48; font-weight: 700; }
</style>
