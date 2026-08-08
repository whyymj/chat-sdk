/**
 * Focus 中间件 —— 上下文聚焦 · 指定组件精修(focus-context)
 *
 * 会话级焦点状态 { path, label? },聚焦后 agent 三层行为收敛:
 *  - 目标提示:augmentPrompt 注入「## 当前精修目标」(path + label + 仅操作该子树)
 *  - 视野收敛:注入 getSchemaAtPath(schema, path) 子树 schema 描述(extractSchemaHint 渲染),
 *    LLM 每轮只看到焦点组件结构,不看其他组件
 *  - 范围收紧(strict):wrapToolCall 对写工具拦截,jsonPath 不以 focus.path 为前缀 → PATH_DENIED(聚焦越界)
 *
 * **压缩豁免(天然)**:focus 经 augmentPrompt 每轮重建到 system prompt(不在 messages),
 * compressInput 压的是 messages → focus 不随 older 轮次丢(同 mission/workingMemory,无需改 summarization)。
 *
 * 触发方式:① sdk.setFocus/clearFocus(集成方/宿主点击拾取)② agent 工具 set_focus/clear_focus(对话驱动)
 * ③ ChatDialog 焦点条(手动输入)。capabilities.focus 默认开。
 *
 * 与 mission 共存:mission 管任务级目标,Focus 管对象级精修目标。聚焦时「当前精修目标」段置前,
 * mission 段保留(不冲突)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'
import type { Focus } from './state'
import type { ZodType } from 'zod'
import { getSchemaAtPath } from '../tools/schemaUtils'
import { extractSchemaHint } from '../presets'

/** 写工具集合(聚焦时其 jsonPath 必须在 focus 子树内;读工具不限制,用户仍需看全量上下文) */
const WRITE_TOOLS = new Set([
  'set_data',
  'edit_data',
  'delete_data',
  'write',
  'vfs_write',
  'vfs_edit',
])

/**
 * 提取一次工具调用涉及的所有 jsonPath scope(点号路径)。
 * 兼容 write 高层工具的嵌套:jsonPath 可能在 `patch.jsonPath` / `patches[].jsonPath`(批量逐条独立判断)。
 * 整体操作(write({value}) / set_data 无 jsonPath)返回空数组 → 不校验(由 schema 白名单兜底,与 permissions 一致)。
 */
function extractScopes(args: unknown): string[] {
  const a = (args ?? {}) as Record<string, any>
  const scopes = new Set<string>()
  if (typeof a.jsonPath === 'string' && a.jsonPath) scopes.add(a.jsonPath)
  if (typeof a.path === 'string' && a.path) scopes.add(a.path)
  if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) scopes.add(a.patch.jsonPath)
  if (Array.isArray(a.patches)) {
    for (const p of a.patches) {
      if (p && typeof p.jsonPath === 'string' && p.jsonPath) scopes.add(p.jsonPath)
    }
  }
  return [...scopes]
}

/** scope 是否在 focusPath 子树内(=== 焦点本身,或以 `focusPath.` 为前缀的子路径) */
function isUnderFocus(scope: string, focusPath: string): boolean {
  return scope === focusPath || scope.startsWith(focusPath + '.')
}

/** Focus 中间件控制器(setFocus/getFocus/clearFocus/reset 闭包,供 createChatSdk 暴露 + agent 工具调用) */
export interface FocusController {
  /**
   * 设置焦点(传 null 清空)。
   * **注意**:此处不校验 path 合法性 —— 校验需 schema getter,放在 createChatSdk 层 / set_focus 工具
   * (它们有 liveData().schema);中间件闭包只负责赋值 + 注入/拦截。
   */
  setFocus: (focus: Focus | null) => void
  getFocus: () => Focus | undefined
  clearFocus: () => void
  /** 重置为初始态(切会话/清空聊天):清焦点 */
  reset: () => void
}

export interface FocusMiddlewareOptions {
  /** 取当前主数据 schema 的 getter(适配 sdk.setData 运行时替换;取子树视野用;path 校验在 createChatSdk 层) */
  getSchema: () => ZodType | null | undefined
  /** 构造时初始焦点(子 agent 继承主 agent 焦点用;主 agent 不传,靠 set_focus 工具/sdk.setFocus 后续设) */
  initialFocus?: Focus
}

export function createFocusMiddleware(opts: FocusMiddlewareOptions): Middleware & FocusController {
  let focus: Focus | undefined = opts.initialFocus

  const mw: Middleware & FocusController = {
    name: 'focus',
    beforeAgent: () => {
      // 焦点进 state(供其他中间件/工具观测当前焦点;同 mission 模式)。augmentPrompt 读闭包 focus。
      return focus ? { focus } : {}
    },
    augmentPrompt: () => {
      if (!focus) return undefined
      const labelSeg = focus.label ? `(${focus.label})` : ''
      const lines = [
        '## 当前精修目标',
        `${focus.path}${labelSeg}`,
        '仅操作该子树,不要改动其他组件;需改其他组件请先 clear_focus 或换焦点。',
      ]
      // 视野收敛:注入焦点子树 schema 描述(LLM 每轮只看到该组件结构,不看其他组件)
      const schema = opts.getSchema()
      if (schema) {
        const sub = getSchemaAtPath(schema, focus.path)
        if (sub) {
          const hint = extractSchemaHint(sub)
          if (hint) lines.push('', '## 焦点子树结构(仅此范围可操作)', hint)
        }
      }
      return lines.join('\n')
    },
    wrapToolCall: async (
      ctx: ToolCallContext,
      next: (ctx: ToolCallContext) => Promise<ToolExecResult>,
    ) => {
      // 范围收紧(strict):聚焦时写工具的 jsonPath 必须在 focus 子树内,越界 PATH_DENIED 回灌 LLM 自纠
      if (focus && WRITE_TOOLS.has(ctx.name)) {
        const scopes = extractScopes(ctx.args)
        for (const scope of scopes) {
          if (!isUnderFocus(scope, focus.path)) {
            const labelSeg = focus.label ? `(${focus.label})` : ''
            return {
              content: `PATH_DENIED · 聚焦越界:当前聚焦「${focus.path}${labelSeg}」,不可操作「${scope}」。请先 clear_focus 或换焦点后重试。`,
              status: 'error' as const,
            }
          }
        }
      }
      return next(ctx)
    },
    setFocus: (f) => {
      focus = f ?? undefined
    },
    getFocus: () => focus,
    clearFocus: () => {
      focus = undefined
    },
    reset: () => {
      focus = undefined
    },
  }
  return mw
}
