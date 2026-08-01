import type { Middleware } from '../harness/middleware'

/**
 * 内置中间件声明式优先级(数字越小越前;用户自定义中间件无 priority,尾随 builtin 保持声明序)。
 * 替代 createChatSdk 的数组字面量硬编码顺序 —— 顺序偏移可被 composeMiddlewareStack + 断言捕捉。declarative-middleware-ordering
 *
 * 约束:dataHint 最前(数据段紧跟 base)/ sdk-events 最末(最后观察)/ verify 在用户中间件前 / humanConfirm 在 approval 前
 */
export const MIDDLEWARE_PRIORITY: Record<string, number> = {
  dataHint: 10,
  usageHints: 20,
  todos: 30,
  skills: 40,
  vfs: 50,
  summarization: 60,
  memory: 70,
  permissions: 80,
  checkpoint: 90,
  humanConfirm: 100,
  approval: 110,
  verify: 120,
  subagent: 130,
  subagents: 140,
  augmentSystem: 150,
  // 注:sdk-events 不声明 priority —— 它是"必须最末(在用户中间件之后,最后观察)"的内部中间件,
  // 靠 composeMiddlewareStack 的 Infinity(用户中间件同 Infinity)+ 数组原序保证(构造时 sdk-events 排在 options.middleware 之后)。
  // 若给它 priority 数字,用户中间件(Infinity)会排到它后面,破坏"最后观察"语义(曾误设 9999 触发此 bug)。
}

/**
 * 按 priority 稳定排序中间件栈:builtin 按 priority 升序,用户中间件(无 priority → Infinity)尾随保持声明序。
 * 纯函数(可单测)。declarative-middleware-ordering
 */
export function composeMiddlewareStack(mws: Middleware[]): Middleware[] {
  const indexed = mws.map((m, i) => ({ m, i, p: MIDDLEWARE_PRIORITY[m.name] ?? Infinity }))
  // 有 priority 的按 p 升序;无 priority(Infinity)按原声明序尾随;同 p 按原序(稳定)
  return indexed.sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.m)
}
