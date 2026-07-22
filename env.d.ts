/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_API_KEY: string
  readonly VITE_AI_BASE_URL: string
  readonly VITE_AI_MODEL: string
  readonly VITE_AI_TEMPERATURE: string
  readonly VITE_AI_MAX_TOKENS: string
  readonly VITE_AI_SYSTEM_PROMPT: string
  readonly VITE_DEBUG: string
  readonly VITE_CONTEXT_WINDOW_ROUNDS: string
  readonly VITE_CONTEXT_SUMMARY_THRESHOLD: string
  readonly VITE_CONTEXT_TOOL_RESULT_MAX: string
  readonly VITE_CONTEXT_ENABLE_RECALL: string
  readonly VITE_CONTEXT_RECALL_TOPK: string
  readonly VITE_CONTEXT_LLM_SUMMARY: string
  readonly VITE_CONTEXT_LLM_MODEL: string
  readonly VITE_CONTEXT_LLM_API_KEY: string
  readonly VITE_CONTEXT_LLM_BASE_URL: string
  readonly VITE_CONTEXT_LLM_TEMPERATURE: string
  readonly VITE_CONTEXT_LLM_MAX_TOKENS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
