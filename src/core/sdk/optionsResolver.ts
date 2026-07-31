/**
 * 配置解析纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期三)。
 * 含 resolveStorage(storage 选项 → SessionStore|null)+ resolveDialogConfig(对话框配置)。
 */
import type { ChatSdkOptions, DialogConfig } from './createChatSdk'
import { createSessionStore, type SessionStore, type StorageBackendType, type StorageConfig } from '../backends/storage'

/** 解析 storage 选项 → SessionStore | null(undefined/false/未传 关闭;字符串/对象 开启) */
export function resolveStorage(storage: StorageBackendType | StorageConfig | false | undefined): SessionStore | null {
  if (storage === undefined || storage === false) return null
  if (typeof storage === 'string') return createSessionStore({ backend: storage })
  if (storage.enabled === false) return null
  return createSessionStore(storage)
}

/**
 * 解析对话框配置:从 options.dialog 读取归组配置(扁平写法已移除)。
 */
export function resolveDialogConfig(opts: ChatSdkOptions): DialogConfig {
  return opts.dialog ?? {}
}
