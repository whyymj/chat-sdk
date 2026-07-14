import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentMessage } from '../types'

export interface AgentOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export function useAgent(options: AgentOptions) {
  const {
    apiKey,
    baseUrl,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 2048,
    systemPrompt,
  } = options

  const llm = new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: model,
    temperature,
    maxTokens,
    configuration: baseUrl ? { baseURL: baseUrl } : undefined,
  })

  function toLC(messages: AgentMessage[]) {
    const lcMessages = []

    if (systemPrompt) {
      lcMessages.push(new SystemMessage(systemPrompt))
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        lcMessages.push(new HumanMessage(msg.content))
      } else if (msg.role === 'assistant') {
        lcMessages.push(new AIMessage(msg.content))
      } else if (msg.role === 'system') {
        lcMessages.push(new SystemMessage(msg.content))
      }
    }

    return lcMessages
  }

  async function chat(messages: AgentMessage[]): Promise<string> {
    const lcMessages = toLC(messages)
    const response = await llm.invoke(lcMessages)
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)
  }

  return { chat, llm }
}
