<script setup lang="ts">
/**
 * Skill 管理面板 —— 用户在 ChatDialog 内创建/编辑/删除自定义 skill
 *
 * 创建/编辑的 skill 经 onAddSkill → sdk.addSkill 加入 agent(合并 initialSkills + userSkills,同名覆盖),
 * 持久化由独立 SkillStore 管理(默认 indexedDB,与 storage 选项分离,跨刷新恢复;
 * 可经 skillStorage.id 手动指定同一 id 实现跨页面/跨 agent 复用);删除经 onRemoveSkill → sdk.removeSkill。
 */
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  /** 提交创建/编辑:调 sdk.addSkill(skill)(同名覆盖,即编辑) */
  onAddSkill?: (skill: { name: string; description: string; getContent: () => string }) => void
  /** 删除:调 sdk.removeSkill(name) → boolean */
  onRemoveSkill?: (name: string) => boolean
  /** 列出用户创建的 skill 名(刷新面板时调) */
  getUserSkillNames?: () => string[]
  /** 读取用户创建的 skill 详情(点击编辑时调,返回 {name, description, content};不存在返回 undefined) */
  onGetSkill?: (name: string) => { name: string; description: string; content: string } | undefined
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const name = ref('')
const description = ref('')
const content = ref('')
const error = ref('')
const userSkills = ref<string[]>([])
const createdTick = ref(0)  // 创建/删除后 ++ 触发列表刷新
const editingName = ref<string | null>(null)  // 当前编辑的 skill 名(null=新建模式)

// 面板打开时刷新用户 skill 列表
watch(() => props.visible, (v) => {
  if (v) refresh()
}, { immediate: true })
// 创建/删除后刷新
watch(createdTick, () => refresh())

function refresh() {
  if (props.getUserSkillNames) userSkills.value = props.getUserSkillNames()
}

function submit() {
  error.value = ''
  if (!name.value.trim()) { error.value = 'skill 名不能为空'; return }
  if (!description.value.trim()) { error.value = '描述不能为空'; return }
  if (!content.value.trim()) { error.value = '内容不能为空'; return }
  const n = name.value.trim()
  // 同名检查(非编辑模式下,用户已创建的)
  if (editingName.value === null && userSkills.value.includes(n)) {
    error.value = `已存在同名用户 skill "${n}",将覆盖`
  }
  props.onAddSkill?.({
    name: n,
    description: description.value.trim(),
    getContent: () => content.value,
  })
  // 清空表单 + 刷新列表 + 退出编辑模式
  resetForm()
  createdTick.value++
}

function removeSkill(n: string) {
  if (!props.onRemoveSkill) return
  if (props.onRemoveSkill(n)) {
    // 若删除的正是当前编辑的,清空表单
    if (editingName.value === n) resetForm()
    createdTick.value++
  }
}

/** 点击已创建 skill → 加载到表单编辑 */
function editSkill(n: string) {
  if (!props.onGetSkill) return
  const s = props.onGetSkill(n)
  if (!s) return
  editingName.value = n
  name.value = s.name
  description.value = s.description
  content.value = s.content
  error.value = ''
}

/** 重置表单到新建模式 */
function resetForm() {
  editingName.value = null
  name.value = ''
  description.value = ''
  content.value = ''
  error.value = ''
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cs-skill-fade">
      <div v-if="visible" class="skill-mask" @click.self="emit('close')">
        <div class="skill-panel">
          <div class="skill-header">
            <span class="skill-title">🧩 Skill 管理</span>
            <button class="skill-close" title="关闭" @click="emit('close')">✕</button>
          </div>

          <div class="skill-section">
            <div class="section-title">
              {{ editingName ? `编辑 Skill: ${editingName}` : '创建新 Skill' }}
              <button v-if="editingName" class="btn btn-ghost btn-cancel" title="取消编辑,回到新建" @click="resetForm">取消编辑</button>
            </div>
            <label class="field">
              <span class="field-label">名称</span>
              <input v-model="name" :disabled="!!editingName" placeholder="如:my-writer" class="field-input" />
            </label>
            <label class="field">
              <span class="field-label">描述</span>
              <input v-model="description" placeholder="一句话说明用途与触发时机" class="field-input" />
            </label>
            <label class="field field-textarea">
              <span class="field-label">内容</span>
              <textarea v-model="content" placeholder="skill 全文指令(支持 Markdown)" rows="6" class="field-input"></textarea>
            </label>
            <div v-if="error" class="skill-error">{{ error }}</div>
            <button class="btn btn-primary" @click="submit">{{ editingName ? '保存修改' : '添加 Skill' }}</button>
          </div>

          <div class="skill-section">
            <div class="section-title">已创建 Skill({{ userSkills.length }})</div>
            <div v-if="!userSkills.length" class="empty-hint">暂无用户创建的 skill</div>
            <ul v-else class="skill-list">
              <li v-for="n in userSkills" :key="n" class="skill-item">
                <span class="skill-name" :class="{ active: editingName === n }">{{ n }}</span>
                <span class="skill-actions">
                  <button class="btn btn-ghost btn-edit" title="加载到表单编辑" @click="editSkill(n)">编辑</button>
                  <button class="btn btn-ghost btn-del" title="删除该用户 skill" @click="removeSkill(n)">删除</button>
                </span>
              </li>
            </ul>
          </div>

          <div class="skill-hint">
            💡 创建/编辑的 skill 会自动加入 agent(下轮 system prompt 索引可见),agent 经 <code>load_skill(name)</code> 按需加载全文;
            持久化由独立 SkillStore 管理(默认 indexedDB,与 storage 选项分离),跨刷新自动恢复;可经 <code>skillStorage.id</code> 跨页面复用。
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.skill-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 10002;
}
.skill-panel {
  width: 480px; max-width: 92vw; max-height: 86vh; overflow: auto;
  background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.2);
  padding: 18px 20px; font-size: 13px; color: #1f2937;
}
.skill-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.skill-title { font-size: 16px; font-weight: 600; }
.skill-close { border: none; background: transparent; font-size: 16px; cursor: pointer; color: #6b7280; padding: 4px 8px; border-radius: 6px; }
.skill-close:hover { background: #f3f4f6; }
.skill-section { margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 8px; }
.section-title { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.field-label { font-size: 12px; color: #6b7280; }
.field-input { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: inherit; }
.field-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
.field-input:disabled { background: #f3f4f6; color: #9ca3af; cursor: not-allowed; }
textarea.field-input { resize: vertical; font-family: ui-monospace, monospace; }
.skill-error { color: #dc2626; font-size: 12px; margin-bottom: 8px; }
.btn { padding: 6px 14px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
.btn-primary { background: #4338ca; color: #fff; }
.btn-primary:hover { background: #3730a3; }
.btn-ghost { background: transparent; color: #6b7280; border: 1px solid #e5e7eb; }
.btn-ghost:hover { background: #f3f4f6; }
.btn-cancel { font-size: 11px; padding: 2px 8px; margin-left: 8px; }
.btn-edit { font-size: 12px; padding: 3px 10px; color: #4338ca; border-color: #c7d2fe; }
.btn-edit:hover { background: #eef2ff; }
.btn-del { font-size: 12px; padding: 3px 10px; color: #dc2626; border-color: #fecaca; }
.btn-del:hover { background: #fef2f2; }
.empty-hint { font-size: 12px; color: #9ca3af; }
.skill-list { list-style: none; padding: 0; margin: 0; }
.skill-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; }
.skill-item:last-child { border-bottom: none; }
.skill-name { font-family: ui-monospace, monospace; font-size: 12px; color: #4338ca; }
.skill-name.active { font-weight: 600; color: #3730a3; }
.skill-actions { display: flex; gap: 6px; }
.skill-hint { font-size: 12px; color: #6b7280; line-height: 1.6; padding: 10px 12px; background: #eef2ff; border-radius: 6px; }
.skill-hint code { background: #e0e7ff; color: #4338ca; padding: 1px 5px; border-radius: 3px; font-size: 11px; }

.cs-skill-fade-enter-active, .cs-skill-fade-leave-active { transition: opacity 0.2s; }
.cs-skill-fade-enter-from, .cs-skill-fade-leave-to { opacity: 0; }
</style>
