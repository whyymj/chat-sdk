/**
 * 乐观锁冲突人工介入管理器 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期二)。
 * dataOps 写入检测到主数据被外部改过 → 挂起 pendingConflict 等用户决定(保留外部/强制覆盖/回退)。
 *
 * getEmit 为延迟求值的事件分发 getter:emit 在 buildCore 内晚于本工厂定义(listeners 之后),
 * set 运行时才调用 getEmit(),此时 emit 已赋值;工厂创建时无需 emit 就绪。
 */
import { ref, type Ref } from 'vue'
import type { SdkEventHandler } from '../types'
import type { ConflictInfo, ConflictResolution } from '../tools/dataOps'
import type { PendingConflict } from './createChatSdk'

export interface ConflictManager {
  /** 冲突挂起状态(响应式 ref;无冲突为 null,UI 据此渲染冲突对话框) */
  pendingConflict: Ref<PendingConflict | null>
  /** dataOps onConflict 回调:挂起冲突 + 外发 conflict 事件,返回等用户决定的 Promise */
  set(info: ConflictInfo): Promise<ConflictResolution>
  /** 用户决定后收口:keep_external/overwrite/restore → resolve 挂起的 Promise,工具继续 */
  resolve(action: ConflictResolution['action']): void
}

export function createConflictManager(getEmit?: () => SdkEventHandler | undefined): ConflictManager {
  const pendingConflict = ref<PendingConflict | null>(null)
  let conflictSeq = 0
  function set(info: ConflictInfo): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      // shareContext 多实例并发冲突时,新冲突覆盖旧 pendingConflict.value,旧 resolve 函数会丢失 → 旧工具永挂。
      // 兜底:覆盖前若仍有未解决冲突,自动按「保留外部」收口旧冲突(防 resolve 丢失)
      const prev = pendingConflict.value
      if (prev) prev.resolve({ action: 'keep_external' })
      const pending = { ...info, id: ++conflictSeq, resolve }
      pendingConflict.value = pending
      // 外发 conflict 事件(headless 集成方可经 onEvent/hook 收,无需 watch ref)
      const emit = getEmit?.()
      emit?.({ type: 'conflict', conflict: pending })
    })
  }
  function resolve(action: ConflictResolution['action']) {
    const p = pendingConflict.value
    if (!p) return
    pendingConflict.value = null
    p.resolve({ action })
  }
  return { pendingConflict, set, resolve }
}
