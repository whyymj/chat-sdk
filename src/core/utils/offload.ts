/**
 * 大结果外存 —— 工具结果超阈值时转存 vfs,只留预览 + vfs_read 引用
 *
 * 落实 OpenSpec「Context 管理 + 大结果外存」:原 get_data 的 safeStringify 硬截断
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
  /** vfs 不可用时的放行上限(字符数):结果 ≤ 此值则完整进上下文(不截断),超过才截断兜底。默认同 threshold */
  passThroughChars?: number
}

export const DEFAULT_OFFLOAD_THRESHOLD = 6000

/** 规范化 vfs 路径(与 vfs.ts 一致:去前导 /、合并重复斜杠) */
function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/')
}

/** 内容寻址 hash(djb2 变体):相同内容 → 相同文件名,避免反复外存同一内容占 vfs 空间 */
function contentHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** offload 结果:content 为最终写入 ToolMessage 的文案;其余为结构化元数据(供测试/DebugDrawer/未来扩展) */
export interface OffloadResult {
  /** true=外存到 vfs;false=vfs 不可用已截断;undefined=原样(未超阈值或放行) */
  offloaded?: boolean
  /** 最终写入 ToolMessage 的 content(给 LLM 看) */
  content: string
  /** 外存 vfs 路径(仅 offloaded=true) */
  path?: string
  /** 原始结果总字符数(offloaded 时) */
  totalChars?: number
  /** 预览(外存时,前 1000 字符) */
  preview?: string
  /** 建议读取计划(外存 + totalChars > 10000 时,引导 LLM 分页回读而非盲读) */
  suggestedReadPlan?: string
}

/**
 * 处理工具结果:超阈值则外存 vfs 或按放行上限放行,否则原样。
 * 三态:
 *  - content > 阈值 且 vfs 可用 → 写 vfs(内容寻址:相同内容复用同一文件,只更新 updatedAt),返回「预览 + vfs_read 引用」(完整可回读,不截断)
 *  - content > 阈值 但 vfs 不可用 → 按放行上限:≤ 上限完整放行(信任大上下文,避免丢信息),> 上限才截断兜底
 *  - content ≤ 阈值 → 原样返回
 * 返回 OffloadResult:.content 写 ToolMessage;.offloaded/path/totalChars/preview/suggestedReadPlan 为结构化元数据。
 */
export function offloadLargeResult(content: string, ctx: OffloadCtx): OffloadResult {
  const threshold = ctx.threshold ?? DEFAULT_OFFLOAD_THRESHOLD
  if (content.length <= threshold) return { content }

  // vfs 可用 → 外存(内容寻址去重),返回预览 + vfs_read 引用
  if (ctx.vfsAvailable && ctx.files) {
    // 内容寻址:相同内容 → 相同文件名,复用已有文件(只更新 updatedAt),不反复占 vfs 空间
    const relPath = `large_results/${ctx.toolName}-${contentHash(content)}.txt`
    const path = normalize(relPath)
    ctx.files[path] = { content, updatedAt: Date.now() }
    const preview = content.slice(0, 1000)
    const totalChars = content.length
    // 大结果(>10000 字符)附建议读取计划,引导 LLM 分页回读而非盲读整块
    const suggestedReadPlan = totalChars > 10000
      ? `结果较大(共 ${totalChars} 字符),建议分页读取:vfs_read({ path: "${relPath}", offset: 0, limit: 100 }) 起步,按需 offset += 100 续读,或 vfs_grep({ pattern, path: "${relPath}" }) 局部检索`
      : undefined
    const contentStr = [
      preview,
      `…[结果过大(共 ${totalChars} 字符),已转存到虚拟工作区:${relPath}]`,
      `需要完整或局部数据时:用 vfs_read({ path: "${relPath}", offset, limit }) 分页回读,或 vfs_grep({ pattern, path: "${relPath}" }) 局部检索。`,
      ...(suggestedReadPlan ? [suggestedReadPlan] : []),
    ].join('\n')
    return { offloaded: true, content: contentStr, path: relPath, totalChars, preview, suggestedReadPlan }
  }

  // vfs 不可用 → 按放行上限:小则完整放行(不截断,信任大上下文),大才截断兜底
  const passThrough = ctx.passThroughChars ?? threshold
  if (content.length <= passThrough) return { content }
  const truncated =
    content.slice(0, passThrough) +
    `\n…[结果过大(共 ${content.length} 字符),vfs 未启用无法外存,已截断,仅显示前 ${passThrough} 字符。建议开启 vfs(capabilities.vfs 默认开启)以完整外存可回读]`
  return { offloaded: false, content: truncated, totalChars: content.length }
}
