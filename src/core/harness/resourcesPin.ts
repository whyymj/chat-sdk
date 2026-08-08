/**
 * 受保护资源跨压缩 pin —— 每轮 augmentPrompt 读资源清单注入「受保护资源」段。
 *
 * 数据源是 dataOpsController.getResourcesSnapshot()(资源清单:配置态 resourcesByPath + 资源池句柄),
 * 在中间件闭包(不在 AgentMessage[])→ compressInput 不碰 → 天然跨压缩(同 mission/workingMemory/focus)。
 * 无需持久化:pin 段是资源清单的派生态,resources 本身在 vfs 池已持久化 + resourcesByPath 是配置态(controller.set 重建)。
 *
 * 压缩后 LLM 仍知「哪些字段被保护 + 句柄」→ 不会误改;需真值用 resource_get。
 */
import type { Middleware } from './middleware'

export function createResourcesPinMiddleware(opts: {
  getResourcesSnapshot: () => { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[]
}): Middleware {
  return {
    name: 'resourcesPin',
    augmentPrompt: () => {
      const snap = opts.getResourcesSnapshot()
      if (!snap.length) return undefined
      const lines = ['## 受保护资源(跨压缩保留 · 精确值保护)']
      for (const r of snap) {
        if (r.mode === 'freeze') {
          lines.push(`- ${r.path} (freeze 已冻结,不可改)`)
        } else {
          lines.push(`- ${r.path} (verbatim 原样保留)${r.handle ? ` ⟦res:${r.handle}⟧` : ''}`)
        }
      }
      lines.push('读到 ⟦frozen:path⟧/⟦res:handle⟧ 占位符 = 精确值在冻结区/资源池(不入消息流);需真值用 resource_get({path});freeze 字段不可写(撞 FROZEN_FIELD 即放弃);verbatim 直接写新值会 VERBATIM_MISMATCH,先 resource_update 再写回句柄;撞 RESOURCE_EVICTED/RESOURCE_NOT_FOUND 重新 read 懒注册。')
      return lines.join('\n')
    },
  }
}
