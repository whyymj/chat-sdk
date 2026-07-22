/**
 * Harness 运行态 —— 对齐 Deep Agents 的 agent state
 *
 * 单线程主 agent 用普通字段;Deep Agents 的合并 reducer 仅为并行子 agent 设计,
 * 本期不做子 agent,故用 last-writer 赋值即可。
 */
import type { AgentMessage } from '../types'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** 计划项(write_todos 整表替换) */
export interface Todo {
  content: string
  status: TodoStatus
}

/** 虚拟工作区文件 */
export interface VfsFile {
  content: string
  mimeType?: string
  updatedAt: number
}

/** skill 元数据(渐进式披露的索引层) */
export interface SkillMeta {
  name: string
  description: string
}

/** 上下文压缩事件(cutoff-event 模式:不删消息,记录截断点 + 摘要) */
export interface SummarizationEvent {
  cutoffIndex: number
  summary: string
  evictedTo?: string
}

export interface HarnessState {
  /** 用户层对话历史(跨轮) */
  messages: AgentMessage[]
  /** 计划清单(planning 中间件维护) */
  todos: Todo[]
  /** 内存虚拟工作区(vfs 中间件维护) */
  files: Record<string, VfsFile>
  /** 已注册 skill 的索引(name + description),注入 system prompt */
  skillsMetadata: SkillMeta[]
  /** 已加载全文的 skill 名(避免重复加载) */
  skillsLoaded: string[]
  /** AGENTS.md 风格持久指令 */
  memory: string
  /** 上下文压缩事件(summarization 中间件维护) */
  summarization?: SummarizationEvent
}

export function createInitialState(): HarnessState {
  return {
    messages: [],
    todos: [],
    files: {},
    skillsMetadata: [],
    skillsLoaded: [],
    memory: '',
  }
}
