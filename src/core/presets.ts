/**
 * 预设 —— 常见场景的推荐配置包,集成方 spread 进 createChatSdk,降低上手门槛。
 *
 * 用法:
 *   createChatSdk({ ...presets.pageBuilder, container: '#root', llm, dataSlots })
 *   createChatSdk({ ...presets.minimal, container, llm, dataSlots })  // 极简,省 token
 *
 * 预设只给场景化配置(systemPrompt / capabilities / subagent 等);
 * container / llm / dataSlots 等依赖集成方环境的选项仍由调用方提供。
 */
import type { ChatSdkOptions } from './sdk/createChatSdk'

export const presets: Record<string, Partial<ChatSdkOptions>> = {
  /**
   * 页面构建助手 —— Agent 读写 window 驱动页面(配合 dataSlots 声明可操作属性)。
   */
  pageBuilder: {
    systemPrompt:
      '你是页面构建助手。按用户意图读写 window 上注册的页面属性,改完页面实时更新。',
  },

  /**
   * 调研助手 —— 并行多路调研 + 文档抓取,结构化汇总。
   */
  researcher: {
    systemPrompt:
      '你是调研助手。多路调研用 spawn_agents 并行委派子 agent(各负责一个方向);单份资料用 fetch_document 抓取;最后结构化汇总,给出结论与依据。',
    subagent: { maxParallel: 4 },
  },

  /**
   * 极简助手 —— 只做 数据槽操作,关闭所有高级能力(省 token / 体积 / 上下文噪音)。
   * ⚠️ vfs 关闭 → 大结果外存退化为截断;summarization 关闭 → 长会话不压缩。
   */
  minimal: {
    capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
  },
}

/**
 * systemPrompt 辅助片段 —— 标准化最佳实践,集成方 spread 进自己的 systemPrompt,降低写错门槛。
 *
 * 用法:
 *   import { systemPromptHelpers } from 'page-agent-sdk'
 *   createChatSdk({ systemPrompt: `你是页面助手。\n${systemPromptHelpers.reliableWriteRules}`, ... })
 */
export const systemPromptHelpers = {
  /**
   * 可靠写入规则 —— 教 LLM「改前先读真实值、动态场景先 list、字段以 describe 为准、写错看校验错误重试」。
   * 避免集成方忘了写这些元规则,导致 LLM 基于记忆瞎改、靠 schema 兜底纠错烧轮次。
   * 建议所有涉及 数据槽写操作的场景都把这段拼进 systemPrompt。
   */
  reliableWriteRules: [
    '【可靠写入规则】',
    '1. 改任何属性前,先用 read({ path }) 读其当前真实值,基于真实值改,不要凭记忆;',
    '2. 若不确定可操作哪些属性,先 read() 不传 path 查看当前注册项(动态组件场景下注册表会增删,以工具返回为准,勿凭旧记忆);',
    '3. 不确定某属性字段结构时,read({ path }) 返回含格式说明,字段以返回为准;',
    '4. 写入若被 schema 校验拒绝(返回结构化错误含字段名与期望类型),按错误修正后重试,不要放弃;',
    '5. 优先用 write 的 patch 增量改(只发改动,如 write({ path, value, patch:{ op, jsonPath } })),避免整体重传大 JSON 被截断。',
  ].join('\n'),
} as const

/**
 * 从 zod schema 提取字段说明(io 契约注入 systemPrompt 用);非 object schema 用 description 兜底。
 * 导出供集成方预览 io 契约将注入的提示,亦供单测。
 */
export function extractSchemaHint(schema: any): string {
  if (!schema) return ''
  try {
    const shape = schema.shape ?? (schema._def?.shape ? (typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape) : null)
    if (shape && typeof shape === 'object') {
      const fields = Object.entries(shape).map(([k, v]: [string, any]) => {
        const desc = v?.description || ''
        const typeName = v?._def?.typeName || ''
        return `- ${k}${desc ? `: ${desc}` : typeName ? ` (${typeName})` : ''}`
      })
      return fields.join('\n')
    }
  } catch { /* ignore */ }
  return schema?.description || '(用 read 查看实际形状)'
}


