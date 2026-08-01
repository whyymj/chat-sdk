/**
 * 内置工具集预设 —— 直接导出工具数组,供集成方手动注入(替代默认自动装配)。
 *
 * 用法(「主要业务工具集单独引入、按需注入」):
 *   import { defineDataToolset, fetchTools, domTools } from 'page-agent-sdk'
 *   createChatSdk({
 *     tools: [...defineDataToolset(data), ...fetchTools, ...domTools, myTool],
 *     capabilities: { dataOps: false, fetch: false, domInspect: false }, // 关默认自动装配,改用手动注入
 *   })
 *
 * 数据工具依赖集成方声明的 data(单主对象),故为工厂(defineDataToolset);
 * fetch / dom 工具无运行时参数依赖,提供静态数组(fetchTools / domTools)。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createDataOps, type DataConfig, type DataOpsOptions } from './tools/dataOps'
import { fetchDocTools } from './tools/fetchDoc'
import { domTools } from './tools/domTool'

/** 文档抓取工具(静态数组,可直接展开进 tools) */
export const fetchTools: StructuredToolInterface[] = fetchDocTools

/** DOM 读取工具(静态数组,get_dom;默认经 capabilities.domInspect 关闭,手动注入时可直接展开) */
export const domToolsStatic: StructuredToolInterface[] = domTools

/**
 * 数据操作工具工厂(依赖 data 声明,故为工厂而非静态)。
 * 返回工具数组,可直接展开进 createChatSdk({ tools }) 或预声明子 agent 的 tools。
 */
export function defineDataToolset(config: DataConfig, opts?: DataOpsOptions): StructuredToolInterface[] {
  return createDataOps(config, opts)
}

/** capabilities 子集(仅工具相关开关,避免与 createChatSdk 循环依赖) */
type ToolCapabilityFlags = { dataOps?: boolean; fetch?: boolean; domInspect?: boolean }

/**
 * 按 capabilities 开关筛选内置工具(纯函数,可单测)。
 * - dataOps/fetch 默认开启(=== false 才关)
 * - domInspect 默认**关闭**(=== true 才开):读 DOM 有 token 成本,集成方按需开启
 * 关闭则对应工具不进工具池(省 token/上下文)。
 */
export function selectBuiltinTools(
  caps: ToolCapabilityFlags | undefined,
  dataOps: StructuredToolInterface[],
  fetchDocs: StructuredToolInterface[],
  dom?: StructuredToolInterface[],
): StructuredToolInterface[] {
  const useDataOps = caps?.dataOps !== false
  const useFetch = caps?.fetch !== false
  const useDom = caps?.domInspect === true
  return [
    ...(useDataOps ? dataOps : []),
    ...(useFetch ? fetchDocs : []),
    ...(useDom && dom ? dom : []),
  ]
}
