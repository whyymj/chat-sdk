<script setup lang="ts">
/**
 * 手动配置面板 —— 运营人员直接编辑页面 JSON + 触发保存/发布/重置
 *
 * 与 Agent 对话框互补:Agent 经 write 改 page(JSON 操作),本面板给人手动编辑/校验/发布。
 * Agent 经 actions(save_draft/publish/refresh_preview)触发同等操作 → 闭环:Agent 改 → 人校验 → 发布。
 * 演示「胜任自动化 agent」:Agent 不仅能改数据,还能触发宿主页面动作(保存/发布)。
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  page: { title: string; components: unknown[] }
  /** 保存草稿(序列化 page → localStorage),返回提示文案(同时供 agent actions.run 复用) */
  onSave: () => string
  /** 发布页面(模拟),返回提示文案 */
  onPublish: () => string
  /** 重置到 initialPage */
  onReset: () => void
  /** 当前发布状态(发布后显示时间戳) */
  publishStatus: string
}>()

const jsonText = ref(serialize())
const error = ref('')
const dirty = ref(false)  // 手动编辑后置 true,避免被 agent write 的 watch 覆盖
const flashMsg = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

function serialize(): string {
  return JSON.stringify({ title: props.page.title, components: props.page.components }, null, 2)
}

// agent write 改 page → 同步 jsonText(仅未手动编辑时,避免覆盖人工编辑)
watch(() => [props.page.title, props.page.components.length], () => {
  if (!dirty.value) jsonText.value = serialize()
})

function onInput() { dirty.value = true }

/** 应用 textarea 编辑:JSON.parse → 写回 page(splice 保留 reactive 引用) */
function applyJson() {
  try {
    const parsed = JSON.parse(jsonText.value) as { title: string; components: unknown[] }
    props.page.title = parsed.title
    props.page.components.splice(0, props.page.components.length, ...parsed.components)
    error.value = ''
    dirty.value = false
    flash('已应用 JSON 编辑到页面')
  } catch (e) {
    error.value = 'JSON 解析失败:' + (e as Error).message
  }
}

function save() { flash(props.onSave()) }
function publish() { flash(props.onPublish()) }
function reset() {
  props.onReset()
  dirty.value = false
  jsonText.value = serialize()
  flash('已重置到初始页面')
}

function flash(msg: string) {
  flashMsg.value = msg
  clearTimeout(timer)
  timer = setTimeout(() => { flashMsg.value = '' }, 3000)
}
</script>

<template>
  <div class="config-panel">
    <div class="config-header">
      <strong>⚙️ 手动配置面板</strong>
      <span class="status" :class="{ published: publishStatus }">{{ publishStatus || '未发布' }}</span>
    </div>
    <textarea
      v-model="jsonText"
      class="json-editor"
      spellcheck="false"
      @input="onInput"
      placeholder="页面 JSON:{ title, components[] }"
    />
    <div v-if="error" class="error">⚠️ {{ error }}</div>
    <div class="config-actions">
      <button @click="applyJson" title="把 textarea 的 JSON 写回页面">应用 JSON</button>
      <button @click="save" title="保存草稿(序列化到 localStorage)">保存草稿</button>
      <button class="primary" @click="publish" title="发布当前页面">🚀 发布</button>
      <button @click="reset" title="重置到初始页面">重置</button>
    </div>
    <div v-if="flashMsg" class="flash">{{ flashMsg }}</div>
  </div>
</template>

<style scoped>
.config-panel {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 12px;
  background: #f9fafb;
}
.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.status {
  font-size: 12px;
  color: #6b7280;
}
.status.published {
  color: #059669;
  font-weight: 600;
}
.json-editor {
  width: 100%;
  height: 140px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 6px;
  resize: vertical;
  background: #fff;
}
.error {
  color: #dc2626;
  font-size: 12px;
  margin: 4px 0;
}
.config-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.config-actions button {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.config-actions button:hover {
  background: #f3f4f6;
}
.config-actions button.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.config-actions button.primary:hover {
  background: #1d4ed8;
}
.flash {
  margin-top: 6px;
  font-size: 12px;
  color: #2563eb;
}
</style>
