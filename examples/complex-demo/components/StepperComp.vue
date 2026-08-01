<script setup lang="ts">
/** 步骤条 */
defineProps<{ steps: { title: string; description?: string }[]; current?: number; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <div class="cmp-stepper" :id="id" :style="style" :class="className" v-show="visible !== false">
    <div v-for="(step, i) in steps" :key="i" class="step" :class="{ done: i < (current ?? 0), active: i === (current ?? 0) }">
      <div class="step-num">{{ i + 1 }}</div>
      <div class="step-text"><div class="step-title">{{ step.title }}</div><div v-if="step.description" class="step-desc">{{ step.description }}</div></div>
    </div>
  </div>
</template>
<style scoped>
.cmp-stepper { display: flex; padding: 16px; background: #fff; border-radius: 8px; }
.step { display: flex; gap: 8px; flex: 1; position: relative; }
.step:not(:last-child)::after { content: ''; position: absolute; top: 12px; left: 28px; right: 0; height: 2px; background: #eee; }
.step.done:not(:last-child)::after { background: #e11d48; }
.step-num { width: 24px; height: 24px; border-radius: 50%; background: #eee; color: #999; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; z-index: 1; flex-shrink: 0; }
.step.active .step-num, .step.done .step-num { background: #e11d48; color: #fff; }
.step-title { font-size: 13px; font-weight: 600; }
.step-desc { font-size: 11px; color: #888; }
</style>
