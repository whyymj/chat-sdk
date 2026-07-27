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

/** skill 文档来源二选一(doc 优先):http 远程经 fetch(CORS/截断由 offload 统一处理)、vfs 本地直读 */

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
      // 不截断:大文档由 load_skill 工具结果经 createAgent 的 offload 统一外存 vfs(可 vfs_read 分页回读 / vfs_grep 检索)
      return { ok: true, content: text }
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

export interface SkillsController {
  /** 运行时替换整个 skill 列表(同名 skill 覆盖更新;清 contentCache 与 loaded,下次 load_skill 重新取最新) */
  set(skills: SkillSpec[]): void
  /** 读取当前 skill 列表(反映运行时 setSkills 替换) */
  get(): SkillSpec[]
  /** 清指定 skill 的全文缓存(不传清全部);下次 load_skill 重新 getContent/readSkillDoc。用于动态 skill 内容变化时主动失效 */
  invalidateCache(name?: string): void
  /** 读取 skill 全文(优先 contentCache;未缓存则调 s.getContent/readSkillDoc 取并缓存;供 DebugDrawer 等外部查看 skill 主内容) */
  getContent(name: string): Promise<string | null>
}

export function createSkillsMiddleware(
  initialSkills: SkillSpec[],
  opts?: SkillsMiddlewareOptions,
): Middleware {
  let skills = [...initialSkills]
  let skillMap = new Map(skills.map((s) => [s.name, s]))
  // 本轮已加载记录(同轮内拦截重复 load,避免浪费);beforeAgent 每轮清空 → 跨轮可重新 load(用缓存)
  const loaded = new Set<string>()
  // skill 全文缓存(middleware 实例级,跨轮跨会话复用):skill 全文是静态文档,首次 getContent 后缓存,避免重复 IO + 重复 offload;
  // setSkills/invalidateCache 时清空,支持动态 skill
  const contentCache = new Map<string, string>()

  const controller: SkillsController = {
    set(newSkills) {
      skills = [...newSkills]
      skillMap = new Map(skills.map((s) => [s.name, s]))
      contentCache.clear()  // 新 skill 全文未缓存,下次 load 重新取
      loaded.clear()        // 清本轮已加载记录,允许重新 load
    },
    get() { return skills },
    invalidateCache(name) {
      if (name) contentCache.delete(name)
      else contentCache.clear()
    },
    async getContent(name) {
      const s = skillMap.get(name)
      if (!s) return null
      let content = contentCache.get(name)
      if (content != null) return content
      if (s.doc) {
        const r = await readSkillDoc(s.doc, opts?.readVfs)
        if (!r.ok) return null
        content = r.content
      } else if (s.getContent) {
        content = await s.getContent()
      } else {
        return null
      }
      contentCache.set(name, content)
      return content
    },
  }

  const loadSkillTool = tool(
    async ({ name }) => {
      const s = skillMap.get(name)
      if (!s) return `未找到 skill "${name}"。`
      if (loaded.has(name)) return `skill "${name}" 已在本轮加载,无需重复。`
      // 优先用缓存(skill 全文静态,跨轮跨会话复用,避免重复 getContent/读 vfs/重复 offload)
      let content = contentCache.get(name)
      if (content == null) {
        if (s.doc) {
          const r = await readSkillDoc(s.doc, opts?.readVfs)
          if (!r.ok) return `加载 skill "${name}" 文档失败:${r.error}`
          content = r.content
        } else if (s.getContent) {
          content = await s.getContent()
        } else {
          return `skill "${name}" 未配置内容(doc 或 getContent 任选其一)。`
        }
        contentCache.set(name, content)
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

  const mw: Middleware = {
    name: 'skills',
    tools: [loadSkillTool],
    beforeAgent: () => {
      // 每轮 run 开始清 loaded Set:允许跨轮重新 load_skill(ToolMessage 跨轮不保留,agent 需重新拿全文);
      // contentCache 不清(skill 全文静态,跨轮跨会话复用,避免重复 getContent/offload;setSkills/invalidateCache 时清)
      loaded.clear()
      return {
        skillsMetadata: skills.map((s) => ({ name: s.name, description: s.description })),
        skillsLoaded: [],
      }
    },
    augmentPrompt: () => renderSkillsIndex(skills),
    afterModel: () => ({ skillsLoaded: [...loaded] }),
  }
  // 挂 controller(不可枚举,供 createChatSdk 暴露 sdk.setSkills/invalidateSkillCache)
  Object.defineProperty(mw, 'controller', { value: controller, enumerable: false, configurable: false, writable: false })
  return mw
}
