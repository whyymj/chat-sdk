# Design: agent-driven-compression(压缩 agent 自主决策)

> **核心**:inspect_context 工具 + CompressDecision(zod)+ compress 决策参数。触发预检前置 + 默认关 + 逐级降级,零破坏现状。评审修正 4 处(HIGH×2:触发预检 / keepRounds token 语义;MEDIUM×2:decide 超时与 maxTokens / 两段式工具循环细化)。

## 1. 决策数据流

```
summarization.compressInput(每次 stream 都跑)
  ├─ capabilities.agentCompression 关 → 现有静态 compress(messages)            [现状]
  ├─ 开但 shouldTriggerCompression 未达阈值 → compress(messages) 不触发        [gate]
  └─ 开且达阈值 → summaryLlm.decide(input) → inspect_context 工具 → CompressDecision(zod)
              │ 成功 → compress(messages, decision)                              [按决策]
              └ 失败/超时/非法 → compress(messages)                              [降级静态]
```

**关键(HIGH)**:`compressInput` 每次 `stream()` 都跑(`createAgent.ts:494-509`),触发判断在 `compress()` 内部(`useContextManager.ts:121/:140`)。若先 decide 后 compress,开启后**每条消息都烧 1-2 次 LLM 调用**。必须抽 `shouldTriggerCompression(messages, config): boolean` 纯函数(token 模式 `totalTokens > threshold` / 轮数模式 `rounds.length > summaryThresholdRounds`),decide 前 gate + compress 内部共用。

## 2. `inspect_context` 工具

```ts
// 仅决策时临时构造 + bind 到 summaryLlm,不进主 agent 工具池
function createInspectContextTool(getContext: () => ContextInspection): StructuredToolInterface
// 参数 zod: { path?, role?, limit? }   // path=jsonPath(查单路径)/ role=按 role 过滤 / limit=各轮条数
// 返回: { totalTokens, occupancy, contextWindow?, categories[], rounds[{round, tokens, tools, head}] }
```

- **数据源组合**(评审修正):`analyzeContext`(context-inspector 的纯函数)只产分类,**不产 rounds 级**。`rounds` 需再组合 `groupRounds`(`rounds.ts:23`)+ `estimateRoundTokens`(`contextIndex.ts:40`)+ `roundToolNames`(`rounds.ts:62`)。工具规格应显式列这三处组合,避免低估实现量。
- 返回 `rounds` 带每轮 token/工具步骤数/首句,供 LLM 判断「哪些轮可压、哪些保留」。

## 3. `CompressDecision` schema(触发模式感知)

```ts
// src/core/sdk/compressDecision.ts(纯函数,zod 校验可单测)
export const CompressDecisionSchema = z.object({
  keepRounds: z.number().int().min(0).max(50).optional(),   // 轮数模式用;0=全压最省
  windowRatio: z.number().min(0).max(1).optional(),          // token 模式用;窗口预算比例
  summarize: z.object({ mode: z.enum(['index', 'llm']) }),
  recallTopK: z.number().int().min(0).max(10).optional(),    // 0=不召回
  preserveTools: z.array(z.string()).max(10).optional(),
  reason: z.string().max(200).optional(),
}).refine((d) => d.keepRounds !== undefined || d.windowRatio !== undefined, {
  message: 'keepRounds 与 windowRatio 至少填一个(按当前触发模式)',
})
export type CompressDecision = z.infer<typeof CompressDecisionSchema>
```

- **双字段(评审修正,HIGH)**:SDK 默认 token 驱动压缩(`resolveContextOptions` 恒注入 contextWindow),`keepRounds`(轮数)在 token 模式下与 `windowRatio`(token 比例)无对应关系。prompt 告知 LLM 当前触发模式,按对应字段填;token 模式优先 windowRatio,轮数模式用 keepRounds;`refine` 强制至少一个。
- **token 模式执行换算**:有 `windowRatio` → `windowBudget = contextWindow * windowRatio`(替代静态比例),走现有「从最新往回累加、超预算切分」循环(`useContextManager.ts:124-132`)——保留 token 封顶保证。**不直接按 keepRounds 切**(会丢封顶,大 JSON 场景压缩后仍超窗口)。
- 校验失败 → 决策器重试一次(重新调 inspect_context + 输出)→ 再失败返回 null → 降级静态。
- **边界守卫**:`keepRounds >= rounds.length` → older 空 → `compress` 返回 notTriggered(轮数模式当前缺此早退,`useContextManager.ts:139-145`;token 模式 `:137` 已有)。
- 语义下界防「贪省恒全压」:决策模式下强制 `keepRounds >= 1`(或对连续全压做静态兜底)。

## 4. summaryLlm 升级(`buildSummaryLlmInvoke` 扩展)

返回结构:
```ts
interface SummaryLlm {
  invoke: (prompt: string) => Promise<string>   // 现状(摘要)
  decide: (input: {
    getContext: () => ContextInspection        // inspect_context 数据源
    contextWindow?: number                     // 触发原因/窗口/阈值进 prompt
    thresholdRatio?: number
    triggerReason: string
  }) => Promise<CompressDecision | null>        // 新增
}
```

- `decide` 实现(**两段式工具循环,评审修正细化**):
  1. 触发预检后,用 `llm.bindTools([inspectContextTool])` 构造独立 bound 实例(`bindTools` 返回新 RunnableBinding,不突变原 llm,与主 agent `llmWithTools` 无冲突)
  2. system:「你是对话历史压缩决策助手。当前触发模式 = token/轮数。先调用 inspect_context 查看上下文构成,再输出压缩决策 JSON(仅 JSON,无多余文字,keepRounds/windowRatio 按触发模式填一个)」
  3. Human: `triggerReason` + `contextWindow` + `thresholdRatio`
  4. **循环执行**:模型输出 tool_calls 轮 → 执行 `inspect_context`(过滤)返回 ToolMessage(**snake_case `tool_call_id`**,CLAUDE.md 明坑;`call.id` undefined 兜底,参照 `createAgent.ts:638`)→ 回灌 → 模型输出最终 JSON → `CompressDecisionSchema.safeParse`
  5. **失败定义逐条列明**:schema 校验失败 / JSON 解析失败(garbled)/ 工具执行抛错 / 超时 —— 各重试一次 → null
  6. 超时:独立 `decisionTimeoutMs`(默认 5-8s,复用 `summaryTimeoutMs` 15s 会叠加至 ~45s 阻塞首响应)
- **独立 `maxTokens`**(评审修正):decide 用更大 `maxTokens`(如 2048)构造 bound 实例,避免继承 summaryLlm 固定 1024 截断 JSON → safeParse 失败 → 无谓降级。
- **能力检测**:`typeof llm.bindTools !== 'function'` → null;但 **bindTools 存在 ≠ 模型真支持**(OpenAI 兼容端点可能 400),真正失败在 API 调用浮现 → 靠「decide 抛错 → null」兜底,不能只依赖方法存在性检测。

## 5. 压缩执行改造(`useContextManager.compress`)

```ts
async compress(messages, decision?: CompressDecision): Promise<{ messages, stats }>
```

- 有决策:token 模式按 `decision.windowRatio` 换算窗口预算(替代静态比例,走现有累加循环)、轮数模式按 `decision.keepRounds` 切分(补 older 空早退)→ 摘要方式按 `decision.summarize.mode`(`llm` 走 `llmInvoke` 含 undefined 回退、`index` 走索引)→ 召回按 `decision.recallTopK`(0 → `slice(0,0)=[]` 不召回)→ preserve 集 = 配置 ∪ `decision.preserveTools`(`new Set([...(config ?? []), ...(decision.preserveTools ?? [])])`)。
- 无决策:完全现状(静态 windowRatio/summaryThresholdRatio/recallTopK/preserve)。
- summaryMsg 附注 `(压缩决策:保留最近 ${keepRounds 或 windowRatio} · ${reason ?? mode})`,供 UI 审计;reason ≤200 提示 LLM 精简(随摘要驻留上下文)。
- **stats 增字段** `decision?: CompressDecision`;`CompressionStats` 加字段后**自动流到** `inspect().lastCompression` 与前置 change 的 `contextSnapshot.compression`(不用额外接线),但 `types/index.ts:157-165` 的 `lastCompression` 内联类型 + `types/index.d.ts`(手动维护)需同步。

## 6. 能力开关 + 装配

- `capabilities.agentCompression` 默认关(opt-in)注册进 `capabilities.ts`:`{ name: 'agentCompression', defaultOn: false, requires: ['summarization'] }`(summarization 关则强制关,语义正确)。
- `createChatSdk`:开且 `summaryLlmInvoke` 可用 → 传 `decide` 给 summarization 中间件;开但无 LLM → warn + 不装决策(压缩现状)。
- `summarization` 中间件:compressInput 内,**先 `shouldTriggerCompression` gate** → 通过才 `decide` → `compress(messages, decision)`;null → 静态。
- 装载序不变(summarization 位置不变;decide 是内部逻辑增强)。
- **边界说明**:`maxMemoryRounds < summaryThresholdRounds` 时 trimMemoryMessages 先触发、summarization 永不触发 → agentCompression 也永不生效(CLAUDE.md 已注此坑,spec 补一句)。

## 7. 与现有机制关系

| 机制 | 关系 |
|---|---|
| `context-inspector`(前置) | **数据源**:复用 `analyzeContext`;面板显示决策注记(`contextSnapshot.compression.decision`) |
| `enableLLMSummary` | **注意**:SDK 默认(auto 预设 + 配 llm)下 `enableLLMSummary` 已为 true(`contextPreset.ts` `?? true`),默认压缩已走 LLM 摘要 → 决策的 1~2 次调用是**叠加**在已有摘要调用之上;conservative 预设(index-only)下 agentCompression 才是压缩内唯一 LLM 消耗 |
| `summaryLlm` / `summaryTimeoutMs` | `decide` 复用同一实例;**超时用独立 `decisionTimeoutMs`**(默认 5-8s),不复用 15s(两段叠加至 ~45s 阻塞首响应) |
| `contextPreset` | 决策覆盖「触发时的执行参数」(split/recall/mode/preserve);**触发阈值/触发模式仍来自 config,决策改不了「何时触发」**(spec 明确此边界) |
| `preserveLastToolResults` | 决策 `preserveTools` 是**扩展**(∪ 关系),不减 |
| `trimMemoryMessages` | `maxMemoryRounds < summaryThresholdRounds` 时 trim 先触发、summarization 永不触发 → agentCompression 也永不生效 |

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **每条消息都烧 token(最高)** | `shouldTriggerCompression` 触发预检前置(HIGH 必改项);未达阈值不 decide |
| 决策烧 token(每次压缩 +1~2 次 LLM 调用) | opt-in 默认关;complex/长任务才开;`decide` 失败立即降级不阻塞 |
| LLM 输出极端策略 | schema clamp(keepRounds≤50/recallTopK≤10)+ 强制 keepRounds≥1 下界 + 校验失败重试→降级 |
| 模型不支持工具调用 | `bindTools` 方法检测 + **调用失败兜底**(bindTools 存在≠模型真支持,OpenAI 兼容端点可 400,靠抛错→null) |
| 决策 JSON 被截断 | decide 独立更大 `maxTokens`(避免继承 summaryLlm 1024 截断);garbled JSON 重试一次 |
| inspect_context 返回过大 | 参数 path/role/limit 裁剪;rounds 只含 token/tools/首句(非全文) |
| 决策与预设语义冲突 | 决策仅覆盖「触发时的执行参数」,不持久化、不改预设;clear 后回预设 |
| keepRounds 空 older | `keepRounds >= rounds.length` → 返回 notTriggered(轮数模式补早退) |
