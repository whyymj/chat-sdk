/**
 * 宿主动作触发(actions)—— agent 调用集成方注册的页面操作(保存/发布/预览/导出等)
 *
 * 定位:区别于用户散 tools(集成方自己造 StructuredToolInterface),actions 是**轻量函数注册**:
 * 集成方只写 { description, run, params? },SDK 自动包成 tool。LLM 直接看到 save_draft/publish
 * 等命名 tool(无需 trigger_action 中转),降低集成负担。
 *
 * 场景(胜任自动化 agent):agent 改完数据 → 调 save_draft 保存草稿 → 调 publish 发布;
 * 配合 get_dom(看渲染)形成"改数据 → 看 DOM → 触发页面动作"闭环。
 *
 * 异常隔离:run 抛错 → 返回结构化错误字符串回灌 LLM 自纠(不崩 agent)。
 */
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z, type ZodTypeAny } from 'zod'

/** 宿主动作定义:集成方注册的页面操作 */
export interface ActionDef {
  /** 动作描述(给 LLM 看,说明何时调用 + 参数含义) */
  description: string
  /** 执行函数;接收 params schema 解析的参数(无 params 时为空对象),返回值序列化回灌 LLM */
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>
  /** 可选参数 schema(ZodObject);不传 = 无参 tool */
  params?: ZodTypeAny
}

/** actions 配置:动作名 → 定义。动作名即 tool 名(需合法标识符,如 save_draft / publish_page) */
export type ActionMap = Record<string, ActionDef>

/** 动作名合法校验(tool 名须 [a-zA-Z][a-zA-Z0-9_]*) */
const VALID_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/

/**
 * 把集成方注册的 actions 转成 StructuredToolInterface[](每个 action 一个 tool)。
 * 纯函数,可单测。非法名(不符合 tool 命名)跳过 + console.warn(不抛,容错)。
 */
export function actionsToTools(actions: ActionMap): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = []
  for (const [name, def] of Object.entries(actions)) {
    if (!VALID_NAME.test(name)) {
      console.warn(`[page-agent-sdk][actions] 动作名 "${name}" 非法(须匹配 ${VALID_NAME}),已跳过`)
      continue
    }
    const desc = def.description || `宿主动作 ${name}`
    tools.push(
      tool(
        async (args: Record<string, unknown>) => {
          try {
            const result = await def.run(args || {})
            return result === undefined ? `动作 ${name} 执行完成。` : typeof result === 'string' ? result : JSON.stringify(result)
          } catch (e) {
            const msg = (e as Error)?.message || String(e)
            return `动作 ${name} 执行失败:${msg}`
          }
        },
        {
          name,
          description: desc,
          schema: (def.params ?? z.object({})) as ZodTypeAny,
        },
      ),
    )
  }
  return tools
}

/** inspect().actions 用:动作元信息(名 → {description, hasParams}) */
export function actionsToInspectInfo(actions: ActionMap): Record<string, { description: string; hasParams: boolean }> {
  const out: Record<string, { description: string; hasParams: boolean }> = {}
  for (const [name, def] of Object.entries(actions)) {
    if (VALID_NAME.test(name)) out[name] = { description: def.description, hasParams: !!def.params }
  }
  return out
}
