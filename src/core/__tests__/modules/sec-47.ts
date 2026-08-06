import type { TestCtx } from './_ctx'
import { dedupeTools } from '../../sdk/toolRegistry'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * sec-47 —— dedupeTools 工具重名收敛纯函数白盒单测(tool-name-collision)。
 * 把「自定义 tool 与内置 tool 重名」收敛为「后注册覆盖先注册」(Map.set 语义,对齐 page-agent)。
 */
const mkTool = (name: string): any => tool(async () => name, { name, description: name, schema: z.object({}) })

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-47] dedupeTools 工具重名收敛纯函数(tool-name-collision)')

  // 无重名 → 全保留,零 collisions
  const r0 = dedupeTools([
    { label: 'builtin', tools: [mkTool('read')] },
    { label: 'user', tools: [mkTool('write')] },
  ])
  assert(r0.tools.length === 2 && r0.collisions.length === 0, 'dedupeTools → 无重名:全保留 + 零 collisions')

  // user 覆盖 builtin(后注册覆盖先注册)
  const r1 = dedupeTools([
    { label: 'builtin', tools: [mkTool('read')] },
    { label: 'user', tools: [mkTool('read')] },  // 同名
  ])
  assert(r1.tools.length === 1, 'dedupeTools → 重名:收敛为唯一(不把重复定义 bind 给模型)')
  assert(r1.collisions.length === 1 && r1.collisions[0].name === 'read' && r1.collisions[0].winner === 'user' && r1.collisions[0].loser === 'builtin', 'dedupeTools → collisions 记录 winner=user / loser=builtin(供上层 warn)')

  // 装配序链:builtin → user → action → mcp(mcp 最后覆盖)
  const r2 = dedupeTools([
    { label: 'builtin', tools: [mkTool('x')] },
    { label: 'user', tools: [mkTool('x')] },
    { label: 'action', tools: [mkTool('x')] },
    { label: 'mcp', tools: [mkTool('x')] },
  ])
  assert(r2.tools.length === 1, 'dedupeTools → 四组重名:收敛为唯一')
  assert(r2.collisions.length === 3, 'dedupeTools → 四组重名:3 条覆盖记录(后三组各覆盖前)')
  assert(r2.collisions[2].winner === 'mcp', 'dedupeTools → 最后注册 mcp 赢(装配序后者覆盖;外部能力优先级高)')

  // 空输入 / 空组
  const r3 = dedupeTools([])
  assert(r3.tools.length === 0 && r3.collisions.length === 0, 'dedupeTools → 空输入:零工具零 collisions')
  const r4 = dedupeTools([{ label: 'user', tools: [] }])
  assert(r4.tools.length === 0, 'dedupeTools → 空组:零工具')

  // 收敛后保留胜者实现(后注册那份)
  const builtinRead = mkTool('read')
  const userRead = mkTool('read')
  const r5 = dedupeTools([
    { label: 'builtin', tools: [builtinRead] },
    { label: 'user', tools: [userRead] },
  ])
  assert(r5.tools[0] === userRead, 'dedupeTools → 收敛后保留胜者实现(user 的那份,非 builtin 的)')

  // 多个不同重名(各自独立收敛)
  const r6 = dedupeTools([
    { label: 'builtin', tools: [mkTool('a'), mkTool('b')] },
    { label: 'user', tools: [mkTool('a'), mkTool('c')] },  // a 重名,c 新增
  ])
  assert(r6.tools.length === 3, 'dedupeTools → 多重名:a 收敛,b/c 各保留 → 3 工具')
  assert(r6.collisions.length === 1 && r6.collisions[0].name === 'a', 'dedupeTools → 仅 a 重名记录 1 条 collision')
}
