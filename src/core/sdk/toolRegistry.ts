import type { StructuredToolInterface } from '@langchain/core/tools'

/**
 * 工具注册收敛(tool-name-collision):把「自定义 tool 与内置 tool 重名」从**未定义行为**
 * (装配层重复定义 + 执行层 builtin 赢 + 标注层后注册来源,三者不一致)收敛为**显式覆盖语义**
 * —— 按装配序「后注册覆盖先注册」(对齐 alibaba/page-agent 的 Map.set 语义)。
 *
 * 纯函数,无副作用,可白盒单测;createChatSdk 装配 / rebuildExtraTools / setTools 等统一调用。
 */

export interface ToolGroup {
  /** 来源标签(builtin / user / action / humanConfirm / checkpoint / mcp) */
  label: string
  tools: StructuredToolInterface[]
}

export interface ToolCollision {
  /** 重名工具名 */
  name: string
  /** 胜者来源(后注册) */
  winner: string
  /** 被覆盖来源(先注册) */
  loser: string
}

/**
 * 按装配序遍历 groups,`Map.set(name, tool)` 后注册覆盖先注册,返回唯一工具集 + 覆盖告警列表。
 * 装配序约定:`builtin` → `user` → `action` → `humanConfirm/checkpoint` → `mcp`(后者覆盖前者)。
 *
 * @returns tools 收敛后的唯一工具集(胜者实现);collisions 每次覆盖记一条(含 winner/loser 来源)
 */
export function dedupeTools(groups: ToolGroup[]): {
  tools: StructuredToolInterface[]
  collisions: ToolCollision[]
} {
  const map = new Map<string, { tool: StructuredToolInterface; label: string }>()
  const collisions: ToolCollision[] = []
  for (const g of groups) {
    for (const t of g.tools) {
      const existing = map.get(t.name)
      if (existing) {
        collisions.push({ name: t.name, winner: g.label, loser: existing.label })
      }
      map.set(t.name, { tool: t, label: g.label })
    }
  }
  const tools = [...map.values()].map((v) => v.tool)
  return { tools, collisions }
}
