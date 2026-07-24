/**
 * Skills 中间件 —— 渐进式披露
 *
 * 对齐 Deep Agents 的 skills middleware:
 *  - 启动只把 skill 的 name + description 注入 system prompt 索引
 *  - 全文不预加载;LLM 调 load_skill(name) 按需加载到当轮 context
 *  - state 记已加载名(skillsLoaded)避免重复
 *
 * skill 内容来源二选一(doc 优先):
 *  - doc:文档源(http(s):// 远程 md,或 vfs://path / 裸路径 本地 vfs 文档)
 *  - getContent:直接返回字符串的函数(原方式)
 *
 * skill 来自运行时注入(非真实 FS),用 defineSkill 声明。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'

export interface SkillSpec {
  /** skill 名(唯一标识) */
  name: string
  /** 一句话说明(进 system prompt 索引,帮 Agent 判断何时用 —— 兼顾「是什么」和「何时用」) */
  description: string
  /**
   * skill 全文内容来源(doc 与 getContent 二选一,doc 优先):
   *  - doc:声明式文档源(http(s):// 远程 md,或 `vfs://path` / 裸路径)—— SDK 代劳 fetch(CORS/截断)+ vfs 读取,适合**静态文档**
   *  - getContent:函数返回内容 —— 适合**动态生成 / 自定义逻辑**
   */
  doc?: string
  getContent?: () => string | Promise<string>
}

/** 声明一个 skill(运行时注入用) */
export function defineSkill(spec: SkillSpec): SkillSpec {
  return spec
}

/** skill 文档读取结果:成功返回 content,失败返回 error 文案 */
export type DocReadResult = { ok: true; content: string } | { ok: false; error: string }

/** skill 文档长度上限(与 fetch_document 一致,防撑爆上下文) */
const MAX_DOC_CHARS = 20000

/** 远程 URL 命中(CORS 友好的 http/https + 协议相对 //) */
const HTTP_RE = /^https?:\/\//i

/** 判定 doc 来源:远程 http(s) 还是本地 vfs(纯函数,供测试) */
export function resolveDocKind(doc: string): 'http' | 'vfs' {
  return HTTP_RE.test(doc) || doc.startsWith('//') ? 'http' : 'vfs'
}

/** 去 vfs:// 前缀 + 规范化路径(与 vfs.ts normalize 同语义:去前导 /、合并重复斜杠) */
export function normalizeVfsPath(p: string): string {
  return p.replace(/^vfs:\/\//, '').replace(/^\/+/, '').replace(/\/+/g, '/')
}

/**
 * 读取 skill 文档(http 远程 / vfs 本地)。
 * - http:fetch 读取(浏览器 CORS 约束),超长截断
 * - vfs:经 readVfs 回调读取(由 createChatSdk 在 vfs 启用时注入);未注入或未找到 → error
 */
export async function readSkillDoc(
  doc: string,
  readVfs?: (path: string) => string | undefined,
): Promise<DocReadResult> {
  if (resolveDocKind(doc) === 'http') {
    try {
      const res = await fetch(doc)
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}(${doc})` }
      const text = await res.text()
      const body =
        text.length > MAX_DOC_CHARS
          ? text.slice(0, MAX_DOC_CHARS) + `\n…[已截断,原长度 ${text.length}]`
          : text
      return { ok: true, content: body }
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      if (/Failed to fetch|NetworkError|CORS|blocked/i.test(msg)) {
        return { ok: false, error: `CORS 跨域或网络错误(${msg});浏览器仅能 GET 同源或已配 CORS 的资源` }
      }
      return { ok: false, error: msg }
    }
  }
  // vfs 文档
  if (!readVfs) return { ok: false, error: `skill 文档 ${doc} 是 vfs 路径,但 vfs 未启用` }
  const content = readVfs(normalizeVfsPath(doc))
  if (content == null) return { ok: false, error: `未找到 vfs 文档 ${doc}(可用 vfs_ls 查看)` }
  return { ok: true, content }
}

function renderSkillsIndex(skills: SkillSpec[]): string | undefined {
  if (!skills.length) return undefined
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`)
  return [
    '## 可用 Skills(渐进式披露)',
    lines.join('\n'),
    '当某 skill 适用时,先调用 load_skill(name) 加载其完整指令,再按指令执行。不要凭记忆猜测 skill 内容。',
  ].join('\n')
}

export interface SkillsMiddlewareOptions {
  /** 读 vfs 文档的函数(由 createChatSdk 在 vfs 启用时注入);未注入则 vfs 路径 doc 报错提示 */
  readVfs?: (path: string) => string | undefined
}

export function createSkillsMiddleware(
  skills: SkillSpec[],
  opts?: SkillsMiddlewareOptions,
): Middleware {
  const skillMap = new Map(skills.map((s) => [s.name, s]))
  const loaded = new Set<string>()

  const loadSkillTool = tool(
    async ({ name }) => {
      const s = skillMap.get(name)
      if (!s) return `未找到 skill "${name}"。`
      if (loaded.has(name)) return `skill "${name}" 已在本轮加载,无需重复。`
      let content: string
      if (s.doc) {
        const r = await readSkillDoc(s.doc, opts?.readVfs)
        if (!r.ok) return `加载 skill "${name}" 文档失败:${r.error}`
        content = r.content
      } else if (s.getContent) {
        content = await s.getContent()
      } else {
        return `skill "${name}" 未配置内容(doc 或 getContent 任选其一)。`
      }
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
