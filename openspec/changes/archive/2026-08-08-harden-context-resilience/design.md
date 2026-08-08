# Design: harden-context-resilience

> 红队审查修正 + 优化决策。完整实现细节见 plan(lovely-rolling-wilkes.md)。

## 红队 TOP3 修正(方案原错误)

1. **P3 反应性重试边界**:langchain 的 `ContextOverflowError`(HTTP 400)在 stream **首个 chunk** 抛(迭代 catch `createAgent.ts:427-434`),非 `withRetry` 启动处(`:405`)。按原方案「启动阶段 catch」命中率≈0。**修正**:重试点放迭代 catch + 「未 emit」守卫(`content==='' && aggregated===null`,首个 chunk 抛错时成立)→ 重试安全(不重复 emit)。不依赖 withRetry。
2. **M3 subagent contextWindow**:`BaseChatModel` 实例无 contextWindow 字段;现状 subagent 传实例时 createAgent 把 model 名误判为默认 `'gpt-3.5-turbo'`→ 按表算 **16K**(子 agent 用 1M 模型却按 16K 算 offload 阈值,silent bug)。**修正**:从实例提取 model 名(`(inst).model ?? (inst).modelName`,复用 `createChatSdk.ts:1799` 逻辑)+ `resolveModelCaps` 查表 → 传 contextWindow/maxOutputTokens。
3. **P1 setLlm 立即压缩**:不主动 splice 持久 messages(persist 覆盖原始历史 + 竞态 + 语义变更)。**修正**:`setLlm` 保持无副作用,「换 LLM 后历史适配新窗口」由 P0 阈值更新 + 下次 stream 入口 `compressInput`(已有机制)自动完成。

## 5 优化

- **A**:P2 重试用「更激进 trimContextIfNeeded + 强制再压缩一轮(激进 windowRatio)」,非重跑完整 compressInput(older 已摘要压不动),重试真能压短。
- **B**:全局预算**单向数据流**——`buildSystemPrompt` 算 system 段实际 token 写 `state.systemTokens` → compress 的 `historyBudget = contextWindow − systemTokens − outputReserve − schemaReserve`。单向,无双向账本。
- **C**:offload 收敛点统一——user 消息 + 工具结果走同一 `offloadLargeResult`(stream 入口检 user / coreExecTool 检工具结果)。单条 user 超窗不再 fatal。
- **D**:子 agent 提取 model 后也跑 ≥200K 校验(约束一致)。
- **E**:一个主题 change + 5 Phase 严格分 commit,每 Phase 独立可发布/回滚。

## 利好(复用现有,不重造)

- `ContextOverflowError.isInstance`(@langchain/core/errors)→ `isContextLengthError` 复用(OpenAI/Anthropic 都已包装成它)
- `extractVfsRefs` + `gcVfsLargeResults`(vfsGc.ts)— 引用集 + GC
- `estimateTokens`(modelCaps.ts)— token 口径
- `offloadLargeResult`(offload.ts)— user + 工具结果统一
- `renderSchemaShallow` — dataHint 降级概览
- 实例 model 提取逻辑(`createChatSdk.ts:1799`)— 下沉到 subagent
- focusMw controller 模式 — 中间件 setContextWindow

## 200K 约束的影响

- 全局预算协调:200K 下 system 20% + history 60% + output/schema 20% 摆得平,降级为轻量单向协调(优化 B),非重型账本。
- 单条超窗口:几乎不可能(单条 >200K 字符),fatal 边界形同虚设但仍保留(防御)。
- M5(未知小模型过松):消解 —— 校验即拒绝。

## 风险

- P2 必须**迭代 catch + 未 emit 守卫**(红队 #2,否则命中率 0);重试用激进 trim(优化 A)。
- vfs 1.5x 硬兜底防 OOM(红队 #7)。
- P5 **dataHint 必须纳入截断**(红队交叉隐患,巨型 schema)。
- 单条 user offload 改 stream 入口(新逻辑,测 offload 后 LLM 能 vfs_read 回)。
- 测试 mock 改造(mockLlm 支持 400 + context_length_exceeded,红队 #5)。
