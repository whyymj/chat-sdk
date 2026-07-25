/**
 * 内置工具集预设 —— 直接导出工具数组,供集成方手动注入(替代默认自动装配)。
 *
 * 用法(「主要业务工具集单独引入、按需注入」):
 *   import { defineDataSlotToolset, fetchTools } from 'page-agent-sdk'
 *   createChatSdk({
 *     tools: [...defineDataSlotToolset(dataSlots), ...fetchTools, myTool],
 *     capabilities: { dataSlotOps: false, fetch: false }, // 关默认自动装配,改用手动注入
 *   })
 *
 * 数据槽工具依赖集成方声明的 dataSlots,故为工厂(defineDataSlotToolset);
 * fetch 工具无运行时参数依赖,提供静态数组(fetchTools)。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createDataSlotOps, type DataSlotSpec, type DataSlotOpsOptions } from './tools/dataSlotOps'
import { fetchDocTools } from './tools/fetchDoc'

/** 文档抓取工具(静态数组,可直接展开进 tools) */
export const fetchTools: StructuredToolInterface[] = fetchDocTools

/**
 * 数据槽操作工具工厂(依赖 dataSlots 声明,故为工厂而非静态)。
 * 返回工具数组,可直接展开进 createChatSdk({ tools }) 或预声明子 agent 的 tools。
 */
export function defineDataSlotToolset(props: DataSlotSpec[], opts?: DataSlotOpsOptions): StructuredToolInterface[] {
  return createDataSlotOps(props, opts)
}

/** capabilities 子集(仅工具相关开关,避免与 createChatSdk 循环依赖) */
type ToolCapabilityFlags = { dataSlotOps?: boolean; fetch?: boolean }

/**
 * 按 capabilities 开关筛选内置工具(纯函数,可单测)。
 * dataSlotOps/fetch 默认开启(=== false 才关);关闭则对应工具不进工具池(省 token/上下文)。
 */
export function selectBuiltinTools(
  caps: ToolCapabilityFlags | undefined,
  dataSlotOps: StructuredToolInterface[],
  fetchDocs: StructuredToolInterface[],
): StructuredToolInterface[] {
  const useDataSlotOps = caps?.dataSlotOps !== false
  const useFetch = caps?.fetch !== false
  return [...(useDataSlotOps ? dataSlotOps : []), ...(useFetch ? fetchDocs : [])]
}
