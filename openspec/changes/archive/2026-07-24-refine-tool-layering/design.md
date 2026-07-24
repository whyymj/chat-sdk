# Design: refine-tool-layering

## 1. 内置工具按需装配(capabilities.windowOps / fetch)

**现状**(`createPageAgent.ts:236-242`):
```ts
const allTools: StructuredToolInterface[] = [
  ...windowOps,          // createWindowOps(windowProps) → 10 个工具
  ...fetchDocTools,      // fetch_document
  ...(options.toolsets || []).flatMap(...),
  ...(options.tools || []),
]
```
windowOps/fetchDoc 无条件 spread。

**改造**:
```ts
const useWindowOps = caps?.windowOps !== false   // 默认 true
const useFetch     = caps?.fetch !== false       // 默认 true
const allTools = [
  ...(useWindowOps ? windowOps : []),
  ...(useFetch ? fetchDocTools : []),
  ...toolsets, ...tools,
]
```

**子 agent 工具筛选连锁影响**:`subagent.ts` 的只读白名单 `DEFAULT_READONLY_TOOLS = [get_window_prop, get_window_paths, list_window_props, describe_window_prop, fetch_document]` 经 `allTools.filter(name ∈ 白名单)` 筛选。若主 agent 关 `windowOps`,`allTools` 无这些工具 → 子 agent 也筛不到 window 工具。

**决策**:此连锁**符合语义**——「关 windowOps」=「本 agent 不做 window 操作」,主子都不带 window 工具是合理的。若集成方想让子 agent 读 window 而主 agent 不写,属罕见场景,可后续按需扩展(本期不做)。design 明确该行为,文档说明。

## 2. 工具集独立导出

**核心导出**(`index.ts`):
```ts
export { createWindowOps } from './tools/windowOps'
export type { WindowOpsOptions } from './tools/windowOps'
export { fetchDocTools } from './tools/fetchDoc'
```

**toolset 预设**:
- `fetchTools` = `defineToolset('fetch', fetchDocTools)` —— **静态**(fetchDocTools 不依赖运行时参数),可直接 `toolsets: [fetchTools]` 注入。
- `windowTools` —— **不预构造**:`createWindowOps(props)` 依赖集成方的 `windowProps` 声明,无法在 SDK 内预构造有效工具(registry 空 = 工具在但操作报错)。故不提供静态 `windowTools`;文档示例引导集成方手动 `createWindowOps(props)` + `defineToolset('window', ...)` 或直接 `tools:` 注入。

**决策**:核心是导出 `createWindowOps` / `fetchDocTools`(解除透明、支持手动注入);`fetchTools` 静态预设;window 走工厂手动构造。不强行预构造 window toolset(会误导)。

## 3. 默认 maxTokens

`createAgent.ts:84` `maxTokens = 8192` → `16384`。理由:window 操作常需输出整段大 JSON(set/edit)。`.env` `VITE_AI_MAX_TOKENS` 经 `useAgentConfig` 读取仍优先覆盖;`createPageAgent({ llm: { maxTokens } })` 也覆盖。16384 在 DeepSeek 等模型上限内,平衡大输出与成本。

> 注:大 JSON 场景**更根本**的解法是 `edit_window_prop` 增量 patch(不重传整体),maxTokens 提高是兜底。文档(usage-guide)强调此点。

## 4. 能力用法默认提示(克制注入)

**注入位置决策**:用法提示需感知 `caps`(哪些能力开启)。各能力中间件(todos/skills)的 `augmentPrompt` **不感知 caps**(中间件不知道自己是否被 caps 关闭)。故用法提示由 `createPageAgent`(知道 caps)统一注入,而非各中间件自注入。

**方案**:`createPageAgent` 在中间件栈头部加一个轻量 `usageHints` 中间件(纯 `augmentPrompt`,无工具/无状态),按 caps 返回对应用法段:
```ts
function createUsageHintsMiddleware(caps, hasWindowProps): Middleware {
  return {
    name: 'usageHints',
    augmentPrompt: () => {
      const hints: string[] = []
      if (caps?.planning !== false) hints.push('多步任务建议先 write_todos 拆解为步骤并逐步推进。')
      if (caps?.windowOps !== false && hasWindowProps) hints.push('误改属性可用 restore_window_snapshot(path) 回退最近一次。')
      if (caps?.subagent !== false) hints.push('独立子任务可 spawn_agent 委派(只读工具,过程不占主上下文)。')
      return hints.length ? '## 能力使用提示\n' + hints.join('\n') : undefined
    },
  }
}
```
装载位置:中间件栈**最前**(让用法提示在 system prompt 靠前,先于 todos 清单等动态段)。

**子 agent 默认 systemPrompt**(`subagent.ts:102` 兜底串):
```
"你是一个专注的子任务执行者。用可用工具完成给定任务,给出简洁结论。"
```
补为:
```
"你是一个专注的子任务执行者。你只有只读工具(读 window / 抓文档),用它们完成给定任务,给出简洁结论,不要展开多余解释。"
```

**克制原则**:每条提示一行;仅在该能力开启时注入;绝不覆盖集成方 `systemPrompt`(拼在其后)。无任何能力开启时不注入(返回 undefined)。

## 5. 验证

- `npx tsc --noEmit -p tsconfig.json`
- `npm test`:新增 `capabilities:{ windowOps:false }` → `getInfo().tools` 不含 `list_window_props` 等 window 工具的断言;`usageHints` augmentPrompt 注入断言(planning 开有提示 / 全关无提示)。
- `npm run build`(ESM/UMD/IIFE)。
- `npm run dev`:page-demo 传 `capabilities:{windowOps:false}` 确认 DebugDrawer 工具列表无 window 工具;system prompt 含用法提示。
