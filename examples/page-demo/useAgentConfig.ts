/**
 * Agent 配置 composable(page-demo 专用)
 *
 * 从 .env 环境变量读取 Agent 配置,供 examples/page-demo/App.vue 使用。
 * 独立于 SDK 核心(不依赖通用核心的类型)。
 */
export interface DemoAgentConfig {
  apiKey: string
  baseUrl?: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt?: string
}

export function useAgentConfig(): DemoAgentConfig {
  return {
    apiKey: import.meta.env.VITE_AI_API_KEY || '',
    baseUrl: import.meta.env.VITE_AI_BASE_URL || undefined,
    model: import.meta.env.VITE_AI_MODEL || 'gpt-3.5-turbo',
    temperature: Number(import.meta.env.VITE_AI_TEMPERATURE) || 0.7,
    maxTokens: Number(import.meta.env.VITE_AI_MAX_TOKENS) || 8192,
    systemPrompt: import.meta.env.VITE_AI_SYSTEM_PROMPT || undefined,
  }
}
