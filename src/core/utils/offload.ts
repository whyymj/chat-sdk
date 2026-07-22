/**
 * 大结果外存 —— 工具结果超阈值时转存 vfs,只留预览 + vfs_read 引用
 *
 * 落实 OpenSpec「Context 管理 + 大结果外存」:原 get_window_prop 的 safeStringify 硬截断
 * 会丢失深层数据,改为外存到 vfs 可按需回读(完整 vfs_read / 局部 vfs_grep)。
 * 由 createAgent 的 coreExecCall 在工具结果唯一收口处调用,所有工具统一受益。
 *
 * 三态:
 *  - content > 阈值 且 vfs 可用(files 存在 + vfsAvailable)→ 写 vfs,返回「预览 + vfs_read 引用」
 *  - content > 阈值 但 vfs 不可用 → 硬截断兜底(避免巨量裸进 LLM context)
 *  - content ≤ 阈值 → 原样返回
 *
 * 注:运行时浏览器代码,可用 Date.now/Math.random(与 vfs.ts 一致;workflow 脚本禁用与此无关)。
 */
import type { VfsFile } from '../harness/state'

export interface OffloadCtx {
  /** vfs store 引用(来自 ctx.state.files,vfs 中间件注入的共享引用) */
  files?: Record<string, VfsFile>
  /** allTools 中是否含 vfs_read(决定外存后能否回读) */
  vfsAvailable?: boolean
  /** 触发外存的工具名(用于 vfs 文件命名) */
  toolName: string
  /** 字符阈值,默认 6000(≈1500 token) */
  threshold?: number
}

export const DEFAULT_OFFLOAD_THRESHOLD = 6000

/** 规范化 vfs 路径(与 vfs.ts 一致:去前导 /、合并重复斜杠) */
function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/')
}

/**
 * 处理工具结果:超阈值则外存 vfs 或硬截断,否则原样。
 * 返回最终写入 ToolMessage 的 content 字符串。
 */
export function offloadLargeResult(content: string, ctx: OffloadCtx): string {
  const threshold = ctx.threshold ?? DEFAULT_OFFLOAD_THRESHOLD
  if (content.length <= threshold) return content

  // vfs 可用 → 外存,返回预览 + vfs_read 引用
  if (ctx.vfsAvailable && ctx.files) {
    const id = Math.random().toString(36).slice(2, 10)
    const relPath = `large_results/${ctx.toolName}-${id}.txt`
    const path = normalize(relPath)
    ctx.files[path] = { content, updatedAt: Date.now() }
    const head = content.slice(0, 1000)
    return [
      head,
      `…[结果过大(共 ${content.length} 字符),已转存到虚拟工作区:${relPath}]`,
      `需要完整或局部数据时:用 vfs_read({ path: "${relPath}", offset, limit }) 分页回读,或 vfs_grep({ pattern, path: "${relPath}" }) 局部检索。`,
    ].join('\n')
  }

  // vfs 不可用 → 硬截断兜底
  return content.slice(0, threshold) + `\n…[结果过大(共 ${content.length} 字符),已截断,仅显示前 ${threshold} 字符]`
}
