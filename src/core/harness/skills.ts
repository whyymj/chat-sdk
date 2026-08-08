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
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'
import { createSandboxRunner } from '../tools/sandbox'
import { runHostScript } from '../tools/hostScript'

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
  /**
   * 加载时执行脚本,结果注入 skill 全文(skill-external-scripts)。`code`/`url` 二选一:
   *  - `code`:内联 JS(页面内执行);`url`:远程脚本 URL(fetch 拉取后执行)
   *  - `context:'sandbox'`(默认)走 Worker 沙箱(无 window/网络);`'host'` 需 `capabilities.skillHostScript:true`(宿主全权,仅集成方内联 code)
   *  - `url`+`context:'host'` 禁止(远程不可信不能全权跑);exec 失败不阻塞(标注 + 不缓存,动态 skill 下次 load 重试)
   */
  exec?: SkillExecSpec
  /**
   * 附带可调工具工厂数组;load_skill 后求值注入 agent 工具池(SDK 不强制改名;建议集成方 factory 命名加 `<skill>__<tool>` 前缀防重名,重名走 dedupeTools 后注册覆盖 + warn)。
   * 与 `exec` 正交:exec=一次性上下文初始化(加载时拿快照注入文本);tools=反复查询能力(LLM 显式调)。
   */
  tools?: SkillToolFactory[]
}

/** skill 执行钩子:加载时跑脚本拿实时数据,结果 append/prepend 进全文 */
export interface SkillExecSpec {
  /** 内联 JS(与 url 二选一;host 上下文必须是集成方内联 code,非 LLM 生成非远程) */
  code?: string
  /** 远程脚本 URL(与 code 二选一;fetch 拉取后**沙箱**执行,禁止 host) */
  url?: string
  /** 执行上下文:'sandbox'(默认,Worker 无 window/网络) | 'host'(宿主全权,需 capabilities.skillHostScript) */
  context?: 'sandbox' | 'host'
  /** 结果注入全文位置:'append'(默认,文末) | 'prepend'(文首) */
  inject?: 'append' | 'prepend'
}

/** skill 附带工具工厂:返回单个/数组工具,可异步 */
export type SkillToolFactory = () =>
  | StructuredToolInterface
  | StructuredToolInterface[]
  | Promise<StructuredToolInterface | StructuredToolInterface[]>

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
  /** 是否开启宿主脚本执行(caps.skillHostScript,由 createChatSdk 注入);false/未传时 exec context:'host' 跳过 + warn */
  hostScriptEnabled?: boolean
  /** skill 附带工具注入回调(load_skill 后触发;由 createChatSdk 装配:合并工具池 + rebind + source 标注) */
  onToolsReady?: (skillName: string, tools: StructuredToolInterface[]) => void
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

// ===== skill exec / tools 执行链(skill-external-scripts)=====

/** exec 结果序列化为注入文本(string 直传;对象/数组 JSON 美化;其他 String) */
function stringifyExecResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result == null) return ''
  try { return JSON.stringify(result, null, 2) } catch { return String(result) }
}

/** 远程脚本拉取(借鉴 readSkillDoc 的 CORS 友好处理);失败返回 null */
async function fetchSkillScript(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

/**
 * 执行 skill exec 钩子。返回 {ok,text}(成功,text 为注入文本)或 {ok:false,error}(失败/拒绝)。
 * 校验 + 路由:code/url 二选一;url+host 拒绝(远程不可信);host 需 hostScriptEnabled;sandbox code 直跑 / url 先 fetch。
 */
export async function executeSkillExec(spec: SkillExecSpec, hostScriptEnabled?: boolean): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ctx = spec.context ?? 'sandbox'
  const hasCode = !!spec.code
  const hasUrl = !!spec.url
  if (!hasCode && !hasUrl) return { ok: false, error: 'exec 未提供 code 或 url' }
  if (hasCode && hasUrl) return { ok: false, error: 'exec code 与 url 不能同时提供(二选一)' }
  if (hasUrl && ctx === 'host') return { ok: false, error: '远程脚本(url)禁止在 host 上下文执行(不可信代码不能全权跑)' }
  if (ctx === 'host') {
    if (!hostScriptEnabled) return { ok: false, error: 'skill 含宿主权限脚本(context:"host"),需 capabilities.skillHostScript:true 开启' }
    const r = await runHostScript(spec.code!)
    return r.ok ? { ok: true, text: stringifyExecResult(r.result) } : { ok: false, error: r.error || '宿主脚本执行失败' }
  }
  // sandbox:url 先 fetch
  let script: string
  if (hasUrl) {
    const fetched = await fetchSkillScript(spec.url!)
    if (fetched == null) return { ok: false, error: `远程脚本拉取失败(${spec.url};CORS/网络错误)` }
    script = fetched
  } else {
    script = spec.code!
  }
  const r = await createSandboxRunner(script)(undefined)
  return r.ok ? { ok: true, text: stringifyExecResult(r.result) } : { ok: false, error: r.error || '沙箱脚本执行失败' }
}

/**
 * 构建 skill 全文(文本部分 + exec 注入)。返回 {content, cacheable}。
 *  - exec 成功或无 exec → cacheable:true(跨轮跨会话复用)
 *  - exec 失败 → content 附失败标注,cacheable:false(不缓存,动态 skill 下次 load 重试 exec)
 */
async function buildSkillContent(s: SkillSpec, opts?: SkillsMiddlewareOptions): Promise<{ content: string; cacheable: boolean }> {
  let text: string | null = null
  if (s.doc) {
    const r = await readSkillDoc(s.doc, opts?.readVfs)
    if (r.ok) text = r.content
  } else if (s.getContent) {
    text = await s.getContent()
  }
  let content = text ?? ''
  let cacheable = true
  if (s.exec) {
    const er = await executeSkillExec(s.exec, opts?.hostScriptEnabled)
    if (er.ok && er.text) {
      content = s.exec.inject === 'prepend' ? er.text + '\n\n' + content : (content ? content + '\n\n' : '') + er.text
    } else {
      // !er.ok(失败)或 er.ok 但 text 空(成功无数据):均不缓存,下次 load 重新执行 exec(动态 skill 语义)
      if (!er.ok) content = (content ? content + '\n\n' : '') + `(skill 脚本执行失败:${er.error})`
      cacheable = false
    }
  }
  return { content, cacheable }
}

/** 求值 skill 附带工具工厂(s.tools → 工具数组);单 factory 失败不阻塞其他 */
async function resolveSkillTools(s: SkillSpec): Promise<StructuredToolInterface[]> {
  if (!s.tools?.length) return []
  const out: StructuredToolInterface[] = []
  for (const factory of s.tools) {
    try {
      const produced = await factory()
      const arr = Array.isArray(produced) ? produced : [produced]
      out.push(...arr)
    } catch (e) {
      console.warn(`skill "${s.name}" 工具工厂执行失败:`, e)
    }
  }
  return out
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
      const built = await buildSkillContent(s, opts)
      content = built.content
      if (built.cacheable) contentCache.set(name, content)
      return content
    },
  }

  const loadSkillTool = tool(
    async ({ name }) => {
      const s = skillMap.get(name)
      if (!s) return `未找到 skill "${name}"。`
      if (loaded.has(name)) return `skill "${name}" 已在本轮加载,无需重复。`
      // 优先用缓存(含上次 exec 成功结果;跨轮跨会话复用,避免重复 getContent/读 vfs/exec)
      let content = contentCache.get(name)
      if (content == null) {
        const built = await buildSkillContent(s, opts)
        content = built.content
        if (!content) return `skill "${name}" 未配置内容(doc / getContent / exec 任选其一)。`
        if (built.cacheable) contentCache.set(name, content)  // exec 失败不缓存 → 下次 load 重试 exec
      }
      loaded.add(name)
      // skill 附带工具注入(load_skill 后触发;§5:createChatSdk 装配 onToolsReady → 合并工具池 + rebind)
      if (s.tools?.length && opts?.onToolsReady && skillMap.get(name) === s) {
        try {
          const tools = await resolveSkillTools(s)
          if (tools.length) opts.onToolsReady(s.name, tools)
        } catch (e) {
          console.warn(`skill "${name}" 工具加载失败:`, e)
        }
      }
      return `skill "${name}" 完整指令:\n\n${content}`
    },
    {
      name: 'load_skill',
      description: '加载某个 skill 的完整指令到当前上下文(若 skill 配 exec,加载时自动执行脚本注入实时数据;若配 tools,加载后注入附带工具)。先从 system prompt 的 Skills 索引选合适的 skill,再调用此工具。',
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
