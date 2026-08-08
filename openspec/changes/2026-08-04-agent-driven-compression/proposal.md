# Change: agent-driven-compression(压缩 agent 自主决策压缩策略)

> 用户诉求(2026-08-04,追加于 context-inspector 规划后):「还要增加上下文信息查看工具,让压缩 agent 能自己查看上下文的信息决定压缩策略」。
> **状态**:proposal(未实施)。**独立 change**,依赖前置 `2026-08-04-context-inspector`(复用其 `analyzeContext` 快照纯函数作数据源)。**用户拍板:压缩 agent = summaryLlm(摘要环节)/ 决策形态 = 工具调用 + 结构化 CompressDecision / 独立 change。**

## Why

现状压缩是**被动全压 + 静态策略**:

| 现状 | 问题 |
|---|---|
| 触发后 `indexSummarize(older)` **全量 older 压成一段** | 不看上下文构成——可能「工具结果膨胀」却只压历史,「摘要已占 60%」却再压一轮 |
| `windowRatio`/`recallTopK`/`preserve` 全是**配置静态值** | 不随上下文动态调整,无法对「这一轮的实际构成」定制压缩 |
| `summaryLlmInvoke: (prompt) => Promise<string>` **纯文本无工具** | 摘要 LLM 只能润色框架喂的索引摘要,看不到各轮/分类占比,无决策出口 |
| **触发判断在 `compress()` 内部**,`compressInput` 每次 stream 都跑 | 决策必须前置同款触发预检,否则每条消息都烧 token(详见「决策」4) |

回答质量下降时的第一诊断是「看上下文构成」，但**压缩环节自己看不到**——`context-inspector`(前置 change)解决了「人看」，本 change 解决「**压缩 agent 自己看 + 决定策略**」:让摘要 LLM 在压缩前先 `inspect_context` 查看分类/占比/各轮 token,再输出结构化压缩决策(保留几轮/摘要粒度/召回 Top-K),框架按决策执行。

## What Changes

新增 **agent-driven compression**:压缩触发时,summaryLlm 经 `inspect_context` 工具查看上下文构成 → 输出结构化 `CompressDecision`(zod 校验)→ 框架按决策压缩。无决策(未开/失败/超时)→ 回退现状静态策略,向后兼容。

### 1. `inspect_context` 工具(摘要环节专用,不进主 agent 工具池)
```ts
inspect_context({ path?, role?, limit? }): ContextInspection
// ContextInspection = 分类 token/占比 + 各轮列表(round/tokens/工具步骤数/首句) + 消息类型分布
```
- 数据源:`analyzeContext`(分类)+ `groupRounds`/`estimateRoundTokens`/`roundToolNames`(rounds 级)组合。
- 非主 agent 工具 —— 仅压缩决策时临时 bind 到 summaryLlm(不污染主 agent 工具池/inspect().tools)。

### 2. `CompressDecision` 结构化决策(zod 校验)
```ts
interface CompressDecision {
  keepRounds: number                       // 保留最近几轮完整(0 = 全压最省 token;越大保留越多越费)
  windowRatio?: number                     // token 驱动模式下的窗口预算比例(0-1;与 keepRounds 二选一,按当前模式填)
  summarize: { mode: 'index' | 'llm' }     // 摘要方式(索引 vs LLM 连贯化)
  recallTopK?: number                      // 关键词召回条数(0 = 不召回)
  preserveTools?: string[]                 // 额外保留这些工具的结果摘要(∪ 配置)
  reason?: string                          // 决策理由(可审计,注入摘要时显示)
}
```
- **触发模式感知**(评审修正):SDK 默认走 token 驱动压缩(`resolveContextOptions` 恒注入 contextWindow)。`keepRounds`(轮数)在 token 模式下无对应关系,故 schema 双字段:`keepRounds` 供轮数模式、`windowRatio` 供 token 模式;prompt 告知 LLM 当前触发模式,按对应字段填。两字段都填则 token 模式优先用 windowRatio。
- LLM 输出决策 JSON,`CompressDecisionSchema.safeParse` 校验;非法 → 重试一次 → 再失败回退静态。
- 决策注入摘要消息:summaryMsg 附「(压缩决策:保留最近 N 轮 · 原因:…)」便于审计。

### 3. 压缩执行改造(`useContextManager.compress`)
- `compress(messages, decision?)`:有决策 → token 模式下按 `decision.windowRatio` 换算窗口预算(替代静态 `windowRatio`)、轮数模式下按 `decision.keepRounds` 切分 recent/older;按 `decision.recallTopK` 召回、按 `decision.summarize.mode` 选摘要方式、按 `decision.preserveTools` 扩 preserve 集。
- 无决策 → 现有静态路径(向后兼容,零变化)。
- **边界守卫**(评审修正):`keepRounds >= rounds.length` → older 空 → 返回 notTriggered(两模式都补,轮数模式当前缺此早退)。

### 4. summaryLlm 升级
- `buildSummaryLlmInvoke` 扩展:新增 `decide(input)`,复用 `summaryLlm ?? 主 llm` 实例;`decide` 绑定 `inspect_context` 工具 → 注入「你是压缩决策助手」system → 调工具看上下文 → 输出 CompressDecision JSON。
- **独立 `maxTokens`/超时**(评审修正):`decide` 用更大 `maxTokens` 构造 bound 实例(避免继承 summaryLlm 固定 1024 截断 JSON)、独立更短超时(如 `decisionTimeoutMs` 5-8s,防压缩阶段最长 ~45s 阻塞首响应)。
- 失败(校验/JSON 解析/工具执行错/超时)→ 降级静态(现有 `llmInvoke` 路径不变);`decide` 与 `invoke` 失败互不影响。

### 5. 决策触发预检(评审修正,HIGH)
- `summarization.compressInput` 内,**先复用 `compress` 的触发条件**做 gate(token 模式 `totalTokens > threshold` / 轮数模式 `rounds.length > summaryThresholdRounds`)——通过才调 `decide`。否则 `compressInput` 每次 stream 都跑,开启后**每条消息都烧 1-2 次 LLM 调用**(20 轮 = 20-40 次无效)。
- 触发判断与 `compress()` 内部逻辑共用同一真源(抽出 `shouldTriggerCompression(messages, config)` 纯函数,两处复用)。

### 6. `capabilities.agentCompression`
- 默认**关**(opt-in,决策调 LLM 烧 token;适合 complex/长任务/大 JSON)。开时需 summaryLlm 可用,否则 warn + 降级静态。
- `false` 关 → 决策链不装,压缩完全现状。

## Impact

- **测试**:
  - selftest:`CompressDecisionSchema` 校验(合法/非法各字段)/ `compress(messages, decision)` 按决策执行(keepRounds/recallTopK/preserveTools 生效)/ 无决策回退静态 / 非法决策降级。
  - e2e:`inspect_context` 工具返回结构 / `capabilities.agentCompression` 开关反映 / 决策降级路径。
  - browser:mock LLM 跑决策压缩端到端(复杂长对话触发 → 决策 → 摘要含决策注记)。browser 计数 +1~2。
- **行为变化**:默认关,现状压缩完全不变。开启后决策环节新增 1~2 次 LLM 调用(有成本),换取自适应压缩质量。
- **向后兼容**:全增量;`compress` 新参数可选;`buildSummaryLlmInvoke` 返回结构扩展(新增 decide 字段,invoke 保留)。

## 决策

1. **压缩 agent = summaryLlm(用户拍板)**:决策在压缩环节内嵌,不改主 agent 工具池;主 agent 只读的 inspect_context(诊断)留给未来。
2. **工具调用 + 结构化决策(用户拍板)**:summaryLlm 先 `inspect_context` 看,再输出 CompressDecision JSON;zod 校验防「LLM 瞎编策略」。
3. **独立 change(用户拍板)**:依赖 context-inspector 的 analyzeContext 数据源,前置完成后再实施;职责清晰、可独立发布。
4. **触发预检前置(评审修正,HIGH)**:`compressInput` 每次 stream 都跑、触发判断在 `compress()` 内部 —— decide 前必须先做同款触发 gate(抽 `shouldTriggerCompression` 纯函数共用),否则每条消息烧 1-2 次 LLM 调用。
5. **默认关 + 降级链**:决策烧 token,opt-in;LLM 失败/超时/非法输出逐级回退静态,零破坏现有用户。
6. **inspect_context 不进主 agent 工具池**:仅决策时临时 bind,不污染 inspect().tools / usageHints / toolMode。

## Non-goals

- 不做主对话 agent 的 `inspect_context` 主动诊断工具(未来单独评估)。
- 不做压缩结果的人工编辑/干预(只展示 + 自动决策)。
- 不做实时逐 token 监控(每轮快照 + 压缩时决策即可)。
- 不依赖 `chatdialog-component-split` / `focus-context`。
- 不并入 `context-inspector`(后者只做数据源 + 人看面板)。

## 演进方向(未来,2026-08-08 记)

- **`archive_to_vfs` 无损搬迁**(用户提议):当前 `CompressDecision` 还停留在「决策怎么**有损摘要**」(keepRounds / summarize mode)。进一步演进是给压缩 agent 加 `archive_to_vfs({ rounds?, content?, summary })` 工具,由它**自主判断哪些老内容搬到 vfs(完整保留)**、message 只留简介 + 索引 —— 用**无损搬迁**替代有损摘要,上下文整洁且信息不丢(需要时 `vfs_read` 回读)。
  - **协同**:与本 change 的 `inspect_context` / `CompressDecision` 同链(inspect 看构成 → 决策搬哪些 → `archive_to_vfs` 执行);搬迁进 vfs 的老内容,其回收管理依赖 `context-persist-resilience` 的 vfs 孤儿 GC。
  - **暂不做的理由**:① 压缩 agent 每次烧多轮 LLM(决策 + 搬迁),成本高;② vfs 堆积老对话 → 空间压力(需 GC + LRU);③ LLM 不一定主动 `vfs_read` 回读(索引可能闲置);④ 现状摘要质量在 `recall-and-trim-llm`(方向 2 trim LLM 增强)后已提升,多数场景够用。
  - **重启触发**:「老对话信息丢失」成真实痛点(集成方反馈摘要丢关键信息、LLM 频繁要求重读历史)时,本 change(含此演进)整体重启评估。
