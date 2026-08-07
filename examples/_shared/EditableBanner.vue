<script setup lang="ts">
/**
 * 可编辑区标识条 —— 在 demo 中标识「Agent 可编辑」的页面/数据区,
 * 与说明区、对话框区视觉区分(顶部色条 + 标签 + 虚线边框 + 浅底)。
 *
 * 用法:<EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区" />
 *      包裹可编辑区:<EditableBanner ...><PageRenderer /></EditableBanner>
 */
defineProps<{
  /** 标识标题(如「AI 可编辑页面」「AI 可编辑数据」) */
  title?: string
  /** 副提示(可选,小字) */
  hint?: string
}>()
</script>

<template>
  <div class="editable-area">
    <div class="editable-banner">
      <span class="editable-dot"></span>
      <span class="editable-title">{{ title ?? 'AI 可编辑区' }}</span>
      <span v-if="hint" class="editable-hint">{{ hint }}</span>
    </div>
    <div class="editable-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.editable-area {
  border: 4px solid var(--ark-accent);
  border-radius: 12px;
  background: rgba(var(--ark-accent-rgb), 0.08);
  position: relative;
  min-height: 60px;
  box-shadow: 0 0 0 1px rgba(var(--ark-accent-rgb), 0.3), 0 6px 20px rgba(var(--ark-accent-rgb), 0.25);
}
.editable-banner {
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  background: linear-gradient(90deg, #4f46e5, #7c3aed);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  border-radius: 8px 8px 0 8px;
  letter-spacing: 0.5px;
  z-index: 1;
  box-shadow: 0 3px 10px rgba(79, 70, 229, 0.4);
}
.editable-dot {
  width: 11px; height: 11px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.4);
  animation: editable-pulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes editable-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}
.editable-title { white-space: nowrap; }
.editable-hint {
  font-weight: 500; opacity: 0.92; font-size: 12px;
  margin-left: auto; white-space: nowrap;
}
.editable-content {
  padding: 40px 18px 18px;
}
@media (prefers-reduced-motion: reduce) {
  .editable-dot { animation: none; }
}
</style>
