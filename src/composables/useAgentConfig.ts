import type { AgentOptions } from './useAgent'

export function useAgentConfig(): AgentOptions {
  return {
    apiKey: import.meta.env.VITE_AI_API_KEY || '',
    baseUrl: import.meta.env.VITE_AI_BASE_URL || undefined,
    model: import.meta.env.VITE_AI_MODEL || 'gpt-3.5-turbo',
    temperature: Number(import.meta.env.VITE_AI_TEMPERATURE) || 0.7,
    maxTokens: Number(import.meta.env.VITE_AI_MAX_TOKENS) || 2048,
    systemPrompt: import.meta.env.VITE_AI_SYSTEM_PROMPT || undefined,
  }
}
