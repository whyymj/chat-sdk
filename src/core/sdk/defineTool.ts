/**
 * defineTool —— 声明式自定义工具 helper
 *
 * 包装 LangChain tool(),让使用者用更简洁的对象形式声明工具。
 * 返回值可直接传入 createPageAgent({ tools }) 或 createAgent({ tools })。
 */
import { tool } from '@langchain/core/tools'
import { z, type ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { Toolset } from '../types'

export interface DefineToolOptions<S extends ZodType> {
  name: string
  description: string
  /** 参数 schema(z.object) */
  schema: S
  /** 工具执行体;返回 string 原样回传,其他值 JSON.stringify */
  handler: (args: z.infer<S>) => unknown | Promise<unknown>
}

export function defineTool<S extends ZodType>(opts: DefineToolOptions<S>): StructuredToolInterface {
  return tool(
    async (args) => {
      const res = await opts.handler(args as z.infer<S>)
      return typeof res === 'string' ? res : JSON.stringify(res)
    },
    {
      name: opts.name,
      description: opts.description,
      schema: opts.schema,
    },
  )
}

/**
 * 定义工具集 —— 把相关工具打包成命名单元,便于整体导入(替代逐个点名)。
 * 例:const search = defineToolset('search', [searchWeb, summarize])
 *   createPageAgent({ toolsets: [search] })  或  subagent: { toolsets: [search] }
 */
export function defineToolset(name: string, tools: StructuredToolInterface[]): Toolset {
  if (!name || !name.trim()) throw new Error('defineToolset: name 必填')
  return { name, tools }
}
