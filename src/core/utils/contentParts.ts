/**
 * 流式 chunk / 响应消息的内容提取 —— provider 兼容(OpenAI/DeepSeek vs Anthropic)
 *
 * 抽自 createAgent 流式循环,纯函数可单测(streaming 三处兼容是 Anthropic 开箱硬风险,单测保回归):
 * - `extractTextDelta`:文本 delta(OpenAI string content / Anthropic parts 数组 `{type:'text',text}`)
 * - `extractReasoningDelta`:推理 delta(DeepSeek `additional_kwargs.reasoning_content` / Anthropic parts `{type:'thinking',thinking}`)
 * - `extractUsage`:token 用量(OpenAI `additional_kwargs.usage` / Anthropic `response_metadata.usage`)
 */
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages'

/** 从流式 chunk 提取文本 delta(兼容 OpenAI/DeepSeek string content 与 Anthropic parts 数组) */
export function extractTextDelta(chunk: AIMessageChunk): string {
  const c = (chunk as any).content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => {
        if (typeof p === 'string') return p
        if (p?.type === 'text' && typeof p.text === 'string') return p.text
        return '' // thinking/tool_use/image 等非文本 part 跳过(reasoning 单独提取)
      })
      .join('')
  }
  return ''
}

/**
 * 从流式 chunk 提取推理 delta(reasoning / thinking)。
 * - DeepSeek/OpenAI:`additional_kwargs.reasoning_content`(或 `reasoning`)
 * - Anthropic:content parts 内 `{type:'thinking',thinking}` 或流式 `{type:'thinking_delta',delta}`
 */
export function extractReasoningDelta(chunk: AIMessageChunk): string {
  const ak: any = (chunk as any).additional_kwargs || {}
  let r = ak.reasoning_content || ak.reasoning || ''
  if (!r && Array.isArray((chunk as any).content)) {
    r = ((chunk as any).content as any[])
      .map((p: any) => {
        if (p?.type === 'thinking') return p.thinking ?? ''
        if (p?.type === 'thinking_delta') return p.delta ?? p.thinking ?? ''
        return ''
      })
      .join('')
  }
  return r
}

/**
 * 从响应消息提取 token usage。
 * - OpenAI/DeepSeek:`additional_kwargs.usage`
 * - Anthropic:`response_metadata.usage`(部分版本 `response_metadata.token_usage`)
 */
export function extractUsage(message: BaseMessage): any {
  const m = message as any
  return m?.additional_kwargs?.usage ?? m?.response_metadata?.usage ?? m?.response_metadata?.token_usage ?? undefined
}
