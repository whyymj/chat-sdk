/**
 * vfs 大结果引用扫描 + 可达性 GC(context-persist-resilience 功能B)
 *
 * 解「孤儿堆积」(trim 删对话轮次不清理 vfs,大结果残留占空间)+ 缓解「引用悬空」
 * (vfs LRU 按时间淘汰、不认对话引用 → 可能删掉还在引用的大结果,AI vfs_read 失败)。
 *
 * offload 是**内容寻址**(`large_results/<tool>-<hash>.txt`,见 offload.ts),引用地址嵌在
 * message 文本里(给 LLM 看的 `vfs_read({ path: "large_results/..." })`)。故可达性 = 被当前
 * messages 的某条文本引用。GC 删「不可达」的大结果(被引用的留)。
 *
 * 纯函数(无副作用,便于单测);调用方(trim/clear/加载)扫引用 → 算不可达 → 应用删除。
 */
import type { AgentMessage } from '../types'
import type { VfsFile } from '../harness/state'

/** large_results vfs 路径前缀(offload 自动外存的池;与 offload.ts 命名一致) */
export const LARGE_RESULTS_PREFIX = 'large_results/'

/** 匹配 large_results/<tool>-<hash>.txt(offload 命名:<toolName>-<contentHash>.txt;地址边界 = 空白/引号/括号/逗号) */
const REF_RE = /large_results\/[^\s"'`),]+\.txt/g

/**
 * 扫描 messages 提取所有 `large_results/...` vfs 引用地址 → 引用集(可达性 GC 用)。
 * 扫 content + steps.result(工具结果文本含 offload 地址)。地址去重(Set)。
 */
export function extractVfsRefs(messages: AgentMessage[]): Set<string> {
  const refs = new Set<string>()
  const collect = (text: string) => {
    if (typeof text !== 'string' || !text) return
    let match: RegExpExecArray | null
    REF_RE.lastIndex = 0 // 全局正则复用,重置(防跨调用 lastIndex 残留)
    while ((match = REF_RE.exec(text)) !== null) refs.add(match[0])
  }
  for (const m of messages) {
    collect(m.content as string)
    if (m.steps) for (const st of m.steps) collect(st.result as string)
  }
  return refs
}

/**
 * 可达性 GC:返回 vfs files 里 `large_results` 池中「不可达」(不在 refs)的大结果 path 列表。
 * 纯函数 —— **不 mutate files**(调用方按返回列表 delete,触发 vfsStore Proxy 落盘);便于单测。
 * 内容寻址天然兼容:一个 vfs 大结果被多轮引用,只要 refs 里有(任一轮引用)就留。
 */
export function gcVfsLargeResults(files: Record<string, VfsFile>, refs: Set<string>): string[] {
  const removed: string[] = []
  for (const key of Object.keys(files)) {
    if (key.startsWith(LARGE_RESULTS_PREFIX) && !refs.has(key)) removed.push(key)
  }
  return removed
}
