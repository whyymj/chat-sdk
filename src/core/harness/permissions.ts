/**
 * Permissions 中间件 —— 声明式 scope 白名单(first-match-wins,默认 allow)
 *
 * 对齐 Deep Agents 的 permissions/enforce.ts。本期默认不启用(全 window 无审批),
 * 保留 createChatSdk({ permissions }) 收紧口子。
 *
 * 仅对 window/vfs 工具生效:按工具的 path 参数作为 scope,匹配 glob 规则。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export type PermissionOp = 'read' | 'write'

export interface PermissionRule {
  operations: PermissionOp[]
  /** glob 模式,匹配工具的 path 参数 */
  scopes: string[]
  mode: 'allow' | 'deny'
}

const WRITE_TOOLS = new Set(['set_window_prop', 'delete_window_prop', 'vfs_write', 'vfs_edit'])
const READ_TOOLS = new Set([
  'get_window_prop',
  'describe_window_prop',
  'list_window_props',
  'vfs_read',
  'vfs_ls',
  'vfs_glob',
  'vfs_grep',
])

/** 简易 glob → RegExp(* 匹配非 /,** 匹配任意) */
function globToRegex(pattern: string): RegExp {
  let r = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        r += '.*'
        i++
      } else {
        r += '[^/]*'
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      r += '\\' + c
    } else {
      r += c
    }
  }
  return new RegExp('^' + r + '$')
}

/** first-match-wins:按规则顺序,首个 op+scope 匹配的规则决定;无匹配默认 allow */
function decideAccess(rules: PermissionRule[], op: PermissionOp, scope: string): 'allow' | 'deny' {
  for (const rule of rules) {
    if (!rule.operations.includes(op)) continue
    if (rule.scopes.some((s) => globToRegex(s).test(scope))) return rule.mode
  }
  return 'allow'
}

export function createPermissionsMiddleware(rules: PermissionRule[]): Middleware {
  return {
    name: 'permissions',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      const op: PermissionOp | null = WRITE_TOOLS.has(ctx.name)
        ? 'write'
        : READ_TOOLS.has(ctx.name)
          ? 'read'
          : null
      const scope = (ctx.args?.path as string) || ''
      if (op && scope) {
        const mode = decideAccess(rules, op, scope)
        if (mode === 'deny') {
          return {
            content: `权限拒绝:${op} 操作 "${scope}" 被 permissions 规则禁止。`,
            status: 'error' as const,
          }
        }
      }
      return next(ctx)
    },
  }
}
