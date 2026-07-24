/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_API_KEY: string
  readonly VITE_AI_BASE_URL: string
  readonly VITE_AI_MODEL: string
  readonly VITE_AI_TEMPERATURE: string
  readonly VITE_AI_MAX_TOKENS: string
  readonly VITE_AI_SYSTEM_PROMPT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
