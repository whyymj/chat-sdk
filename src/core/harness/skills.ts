/**
 * Skills 中间件 —— 渐进式披露
 *
 * 对齐 Deep Agents 的 skills middleware:
 *  - 启动只把 skill 的 name + description 注入 system prompt 索引
 *  - 全文不预加载;LLM 调 load_skill(name) 按需加载到当轮 context
 *  - state 记已加载名(skillsLoaded)避免重复
 *
 * skill 来自运行时注入(非真实 FS),用 defineSkill 声明。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'

export interface SkillSpec {
  /** skill 名(唯一标识) */
  name: string
  /** 一句话说明(进 system prompt 索引) */
  description: string
  /** 何时使用(可选,进索引帮助 Agent 判断) */
  whenToUse?: string
  /** 获取 skill 全文指令(load_skill 时调用) */
  getContent: () => string | Promise<string>
}

/** 声明一个 skill(运行时注入用) */
export function defineSkill(spec: SkillSpec): SkillSpec {
  return spec
}

function renderSkillsIndex(skills: SkillSpec[]): string | undefined {
  if (!skills.length) return undefined
  const lines = skills.map((s) => `- ${s.name}: ${s.whenToUse || s.description}`)
  return [
    '## 可用 Skills(渐进式披露)',
    lines.join('\n'),
    '当某 skill 适用时,先调用 load_skill(name) 加载其完整指令,再按指令执行。不要凭记忆猜测 skill 内容。',
  ].join('\n')
}

export function createSkillsMiddleware(skills: SkillSpec[]): Middleware {
  const skillMap = new Map(skills.map((s) => [s.name, s]))
  const loaded = new Set<string>()

  const loadSkillTool = tool(
    async ({ name }) => {
      const s = skillMap.get(name)
      if (!s) return `未找到 skill "${name}"。`
      if (loaded.has(name)) return `skill "${name}" 已在本轮加载,无需重复。`
      const content = await s.getContent()
      loaded.add(name)
      return `skill "${name}" 完整指令:\n\n${content}`
    },
    {
      name: 'load_skill',
      description: '加载某个 skill 的完整指令到当前上下文。先从 system prompt 的 Skills 索引选合适的 skill,再调用此工具。',
      schema: z.object({ name: z.string().describe('skill 名') }),
    },
  )

  return {
    name: 'skills',
    tools: [loadSkillTool],
    beforeAgent: () => ({
      skillsMetadata: skills.map((s) => ({ name: s.name, description: s.description })),
      skillsLoaded: [],
    }),
    augmentPrompt: () => renderSkillsIndex(skills),
    afterModel: () => ({ skillsLoaded: [...loaded] }),
  }
}
