/**
 * 内置工具集预设 —— 直接导出工具数组,供集成方手动注入(替代默认自动装配)。
 *
 * 用法(「主要业务工具集单独引入、按需注入」):
 *   import { defineWindowToolset, fetchTools } from 'chat-sdk'
 *   createChatSdk({
 *     tools: [...defineWindowToolset(windowProps), ...fetchTools, myTool],
 *     capabilities: { windowOps: false, fetch: false }, // 关默认自动装配,改用手动注入
 *   })
 *
 * window 工具依赖集成方声明的 windowProps,故为工厂(defineWindowToolset);
 * fetch 工具无运行时参数依赖,提供静态数组(fetchTools)。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createWindowOps, type WindowPropSpec, type WindowOpsOptions } from './tools/windowOps'
import { fetchDocTools } from './tools/fetchDoc'

/** 文档抓取工具(静态数组,可直接展开进 tools) */
export const fetchTools: StructuredToolInterface[] = fetchDocTools

/**
 * window 操作工具工厂(依赖 windowProps 声明,故为工厂而非静态)。
 * 返回工具数组,可直接展开进 createChatSdk({ tools }) 或预声明子 agent 的 tools。
 */
export function defineWindowToolset(props: WindowPropSpec[], opts?: WindowOpsOptions): StructuredToolInterface[] {
  return createWindowOps(props, opts)
}

/** capabilities 子集(仅工具相关开关,避免与 createChatSdk 循环依赖) */
type ToolCapabilityFlags = { windowOps?: boolean; fetch?: boolean }

/**
 * 按 capabilities 开关筛选内置工具(纯函数,可单测)。
 * windowOps/fetch 默认开启(=== false 才关);关闭则对应工具不进工具池(省 token/上下文)。
 */
export function selectBuiltinTools(
  caps: ToolCapabilityFlags | undefined,
  windowOps: StructuredToolInterface[],
  fetchDocs: StructuredToolInterface[],
): StructuredToolInterface[] {
  const useWindowOps = caps?.windowOps !== false
  const useFetch = caps?.fetch !== false
  return [...(useWindowOps ? windowOps : []), ...(useFetch ? fetchDocs : [])]
}
