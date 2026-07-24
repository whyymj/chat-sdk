/**
 * 内置工具集预设 —— 把内置工具打包成命名 Toolset,供集成方手动注入。
 *
 * 用法(「主要业务工具集单独引入、按需注入」,替代默认自动装配):
 *   import { defineWindowToolset, fetchTools } from 'chat-sdk'
 *   createChatSdk({
 *     toolsets: [defineWindowToolset(windowProps), fetchTools],
 *     capabilities: { windowOps: false, fetch: false }, // 关默认自动装配,改用手动注入
 *   })
 *
 * window 工具依赖集成方声明的 windowProps,故为工厂(defineWindowToolset);
 * fetch 工具无运行时参数依赖,提供静态预设(fetchTools)。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import { defineToolset } from './sdk/defineTool'
import { createWindowOps, type WindowPropSpec, type WindowOpsOptions } from './tools/windowOps'
import { fetchDocTools } from './tools/fetchDoc'

/** 文档抓取工具集(静态,可直接注入 toolsets) */
export const fetchTools = defineToolset('fetch', fetchDocTools)

/**
 * window 操作工具集工厂(依赖 windowProps 声明,故为工厂而非静态预设)。
 * 返回 Toolset,可直接放进 createChatSdk({ toolsets }) 或 subagent.toolsets。
 */
export function defineWindowToolset(props: WindowPropSpec[], opts?: WindowOpsOptions) {
  return defineToolset('window', createWindowOps(props, opts))
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
