/**
 * 预设 —— 常见场景的推荐配置包,集成方 spread 进 createChatSdk,降低上手门槛。
 *
 * 用法:
 *   createChatSdk({ ...presets.pageBuilder, container: '#root', llm, windowProps })
 *   createChatSdk({ ...presets.minimal, container, llm, windowProps })  // 极简,省 token
 *
 * 预设只给场景化配置(systemPrompt / capabilities / subagent 等);
 * container / llm / windowProps 等依赖集成方环境的选项仍由调用方提供。
 */
import type { ChatSdkOptions } from './sdk/createChatSdk'

export const presets: Record<string, Partial<ChatSdkOptions>> = {
  /**
   * 页面构建助手 —— Agent 读写 window 驱动页面(配合 windowProps 声明可操作属性)。
   */
  pageBuilder: {
    systemPrompt:
      '你是页面构建助手。流程:get_window_prop 读取当前页面结构 → set_window_prop / edit_window_prop 修改属性 → 页面实时更新。多步任务先用 write_todos 拆解,逐步推进。',
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
   * 极简助手 —— 只做 window 操作,关闭所有高级能力(省 token / 体积 / 上下文噪音)。
   * ⚠️ vfs 关闭 → 大结果外存退化为截断;summarization 关闭 → 长会话不压缩。
   */
  minimal: {
    capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
  },
}
