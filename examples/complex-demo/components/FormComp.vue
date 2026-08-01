<script setup lang="ts">
/** 表单:字段列表(展示型,不实际提交) */
defineProps<{ action?: string; fields: { name: string; label: string; type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox'; required?: boolean; placeholder?: string }[]; id?: string; style?: Record<string, string>; visible?: boolean; className?: string }>()
</script>
<template>
  <form class="cmp-form" :id="id" :style="style" :class="className" v-show="visible !== false" @submit.prevent>
    <div v-for="f in fields" :key="f.name" class="form-field">
      <label>{{ f.label }}<span v-if="f.required" class="req">*</span></label>
      <input v-if="f.type === 'text' || f.type === 'number'" :type="f.type" :placeholder="f.placeholder" />
      <textarea v-else-if="f.type === 'textarea'" :placeholder="f.placeholder" rows="3"></textarea>
      <input v-else-if="f.type === 'checkbox'" type="checkbox" />
      <select v-else-if="f.type === 'select'"><option>{{ f.placeholder || '请选择' }}</option></select>
    </div>
    <button type="submit" class="form-submit">{{ action || '提交' }}</button>
  </form>
</template>
<style scoped>
.cmp-form { padding: 16px; background: #fff; border-radius: 8px; }
.form-field { margin-bottom: 12px; }
.form-field label { display: block; font-size: 13px; margin-bottom: 4px; }
.req { color: #e11d48; }
.form-field input, .form-field textarea, .form-field select { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
.form-submit { background: #e11d48; color: #fff; border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; }
</style>
