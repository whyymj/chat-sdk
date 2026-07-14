import type { App, Plugin } from 'vue'
import ChatDialog from './components/ChatDialog.vue'
import { useChat } from './composables/useChat'
import { useAgent } from './composables/useAgent'
import { useAgentConfig } from './composables/useAgentConfig'
import type { AgentMessage, AgentConfig, AgentState } from './types'
import type { AgentOptions } from './composables/useAgent'

export { ChatDialog, useChat, useAgent, useAgentConfig }
export type { AgentMessage, AgentConfig, AgentState, AgentOptions }

export const ZhuantiAgentPlugin: Plugin = {
  install(app: App) {
    app.component('ChatDialog', ChatDialog)
  },
}
