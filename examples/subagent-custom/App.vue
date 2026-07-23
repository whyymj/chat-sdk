<script setup lang="ts">
/**
 * 自定义子 Agent 示例 —— 多角色并行评审
 *
 * 演示 4 个自定义层级:
 *  ① 配置级:subagent.allowedTools 放开三个评审工具(默认子 agent 仅只读 window+fetch)
 *  ② 调用级:LLM 给每个子 agent 设不同 role(安全/性能/UX 审查员)
 *  ③ 引导级:systemPrompt 指导按角色拆分 + 用对应工具
 *  ④ 可观察:对话框 spawn_agents 步骤下嵌套显示每个子 agent 的工具调用;
 *     「日志」按钮 → 「Agent 信息」tab 看 subagent 配置;日志 tab 看子 agent 运行日志(带 ↳ 子:label 徽标)
 *
 * 运行:npm run dev → 访问 /custom.html
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createPageAgent, defineTool, z, type PageAgent } from '../../src/core'

// 待评审的方案
const PROPOSAL =
  '【方案】用浏览器端 IndexedDB 缓存用户全部购物车数据,每次打开从本地恢复,定时同步到服务端。'

// 三个角度的评审工具(子 agent 经 subagent.allowedTools 获得调用权)
const checkSecurity = defineTool({
  name: 'check_security',
  description: '从安全角度评估方案(数据泄露 / XSS / 权限)。返回安全风险点。',
  schema: z.object({ proposal: z.string() }),
  handler: () =>
    '【安全视角】风险:IndexedDB 同源任意脚本可读,XSS 可窃取购物车数据;明文存敏感信息。建议:加密存储、不存支付凭证、配置 CSP。',
})
const checkPerformance = defineTool({
  name: 'check_performance',
  description: '从性能角度评估方案(存储配额 / 同步 / 卡顿)。返回性能风险点。',
  schema: z.object({ proposal: z.string() }),
  handler: () =>
    '【性能视角】风险:全量缓存可能撑爆配额;定时同步需防抖;大对象序列化阻塞主线程。建议:分页缓存、增量同步、Web Worker 序列化。',
})
const checkUx = defineTool({
  name: 'check_ux',
  description: '从用户体验角度评估方案(一致性 / 离线 / 冲突)。返回 UX 风险点。',
  schema: z.object({ proposal: z.string() }),
  handler: () =>
    '【UX 视角】风险:离线编辑后与服务端冲突需合并策略;多端一致性;恢复延迟感知。建议:冲突提示、乐观更新、骨架屏。',
})

const root = ref<HTMLElement>()
let agent: PageAgent | null = null

onMounted(() => {
  agent = createPageAgent({
    container: root.value!,
    id: 'subagent-custom',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // ③ 引导级:systemPrompt 指导按角色拆分 + 用对应工具
    systemPrompt:
      '你是方案评审协调员。用户给你一个方案时,【必须】用 spawn_agents 并行委派 3 个子 agent,分别从【安全】【性能】【用户体验】三个角度评审:每个子 agent 设相应 role(安全审查员 / 性能审查员 / 用户体验审查员),并调用对应工具(check_security / check_performance / check_ux)调研,给出该角度的评审意见。最后你汇总成结构化评审报告(含总体结论与建议)。子 agent 之间互不通信,由你聚合。',
    tools: [checkSecurity, checkPerformance, checkUx],
    // ① 配置级:放开三个评审工具给子 agent(默认子 agent 仅只读 window+fetch);并行上限 3
    subagent: { allowedTools: ['check_security', 'check_performance', 'check_ux'], maxParallel: 3 },
    debug: true,
    title: '自定义子 Agent · 多角色评审',
    placeholder: '试试:评审这个方案 / 这个方案有什么风险?',
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🧬 自定义子 Agent</h2>
      <p class="hint">
        演示 <strong>多角色自定义子 agent</strong>:主 agent 用 <code>spawn_agents</code> 并行委派 3 个不同
        <code>role</code> 的子 agent(安全 / 性能 / UX),每个用不同工具评审,再汇总。
      </p>
      <p class="hint">
        ▶ 自定义点:<code>subagent.allowedTools</code> 放开评审工具 ① · LLM 按角色设 <code>role</code> + 选工具 ② ·
        <code>systemPrompt</code> 引导拆分 ③
      </p>

      <div class="proposal">
        <div class="label">待评审方案</div>
        <p>{{ PROPOSAL }}</p>
      </div>

      <div class="roles">
        <div class="role"><span class="badge sec">🛡️ 安全审查员</span><code>check_security</code></div>
        <div class="role"><span class="badge perf">⚡ 性能审查员</span><code>check_performance</code></div>
        <div class="role"><span class="badge ux">✨ UX 审查员</span><code>check_ux</code></div>
      </div>

      <p class="try">💡 观察右侧:spawn_agents 下嵌套 3 个子 agent 各自的工具调用进度;「日志」可见子 agent 运行日志。</p>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: #f5f7fa; padding: 28px 32px; }
.pane-right { flex: 0 0 460px; border-left: 1px solid #e5e7eb; background: #fff; }
.pane-right > :deep(.chat-dialog) { width: 100%; height: 100%; }

h2 { font-size: 20px; margin: 0 0 12px; color: #1f2937; }
.hint { font-size: 13px; line-height: 1.7; color: #4b5563; margin: 0 0 12px; }
.hint code { background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-size: 12px; }

.proposal { background: #fffbeb; border-left: 3px solid #d97706; padding: 12px 14px; border-radius: 6px; margin: 16px 0; }
.proposal .label { font-size: 11px; color: #92400e; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
.proposal p { font-size: 13px; color: #1f2937; margin: 0; line-height: 1.6; }

.roles { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; }
.role { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px; font-size: 12px; }
.role code { color: #6b7280; font-size: 11px; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; color: #fff; }
.badge.sec { background: #dc2626; }
.badge.perf { background: #d97706; }
.badge.ux { background: #7c3aed; }

.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 8px; line-height: 1.6; }
</style>
