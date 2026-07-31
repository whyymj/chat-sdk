/**
 * SDK 事件系统工厂 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期三)。
 * 封装 listeners(sdk.hook 注册集合)+ emit(外发事件)+ hook(运行时订阅)。
 * emit:approval_request 不外发(UI 已处理);onEvent 与各 listener 各自 try/catch 隔离,互不影响。
 * 注:createSdkEventMiddleware(依赖 emit/messages/liveData/usage + matchDataOp)留 createChatSdk,本工厂只管事件分发。
 */
import type { SdkEventHandler } from '../types'

export interface SdkEvents {
  /** sdk.hook 注册的监器集合(shareContext 时多实例共享同一 core,故合并在 AgentCore.listeners) */
  listeners: Set<SdkEventHandler>
  /** 外发事件:approval_request 不外发;onEvent + 各 listener 各自 try/catch 隔离 */
  emit: SdkEventHandler
  /** 运行时订阅(可多个监听器,各自可取消);返回取消函数 */
  hook(handler: SdkEventHandler): () => void
}

export function createSdkEvents(onEvent?: SdkEventHandler): SdkEvents {
  const listeners = new Set<SdkEventHandler>()
  const emit: SdkEventHandler = (event) => {
    // approval_request 不外发(UI 已处理,避免集成方误调 resolve 双重收口)
    if ((event as any).type === 'approval_request') return
    if (onEvent) { try { onEvent(event) } catch { /* 回调抛错不影响 agent 循环 */ } }
    for (const l of listeners) { try { l(event) } catch { /* 单个监听器抛错不影响其他 */ } }
  }
  function hook(handler: SdkEventHandler): () => void {
    listeners.add(handler)
    return () => listeners.delete(handler)
  }
  return { listeners, emit, hook }
}
