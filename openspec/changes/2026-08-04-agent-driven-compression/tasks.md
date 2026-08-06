# Tasks: agent-driven-compression(压缩 agent 自主决策压缩策略)

> 关联 `proposal.md`。**独立 change**,依赖前置 `2026-08-04-context-inspector`(复用其 `analyzeContext`)。用户拍板:压缩 agent=summaryLlm / 工具调用+结构化决策 / 独立 change。

## 1. `shouldTriggerCompression` 触发预检纯函数(评审修正 HIGH)
- [ ] 抽 `shouldTriggerCompression(messages, config): boolean` 纯函数(token 模式 `totalTokens > threshold` / 轮数模式 `rounds.length > summaryThresholdRounds`)
- [ ] `compress()` 内部触发判断改为调用它(单一真源);`compressInput` 的 decide 前置 gate 复用
- [ ] selftest:token/轮数两模式阈值判定 + 边界(恰好等于/小于)

## 2. `CompressDecision` schema(纯函数)
- [ ] 新建 `src/core/sdk/compressDecision.ts`:`CompressDecisionSchema`(zod)+ 类型导出
- [ ] 字段:keepRounds(int 0-50,可选)/ **windowRatio(0-1,可选,token 模式)**/ summarize.mode('index'|'llm')/ recallTopK(0-10,可选)/ preserveTools(≤10,可选)/ reason(≤200,可选);`refine` 强制 keepRounds 或 windowRatio 至少一个
- [ ] 导出 `CompressDecision` 类型 + schema(供 e2e 校验用)
- [ ] selftest:schema 合法通过/非法拒绝(keepRounds 负数/超 50/mode 非法/类型错/两字段都空)

## 3. `inspect_context` 工具(摘要环节专用)
- [ ] 新建 `src/core/sdk/inspectContextTool.ts`:`createInspectContextTool(getContext)` 返回 StructuredToolInterface
- [ ] 参数 zod:`{ path?, role?, limit? }`(path 查单路径/role 过滤/limit 各轮条数)
- [ ] 返回 `{ totalTokens, occupancy, contextWindow?, categories[], rounds[{round, tokens, tools, head}] }`
- [ ] **数据源组合**:`analyzeContext`(分类)+ `groupRounds` + `estimateRoundTokens` + `roundToolNames`(rounds 级);显式列三处组合
- [ ] selftest:参数裁剪/rounds 结构/occupancy 退化

## 4. summaryLlm 升级(`buildSummaryLlmInvoke` 扩展)
- [ ] 返回结构加 `decide(input: { getContext, contextWindow?, thresholdRatio?, triggerReason }) => Promise<CompressDecision | null>`
- [ ] `decide`:**两段式工具循环**——bind `inspect_context` → system 决策助手 prompt(含当前触发模式)→ 模型输出 tool_calls 轮 → 执行工具(ToolMessage snake_case `tool_call_id` + call.id 兜底)→ 回灌 → 最终 JSON → `safeParse`
- [ ] 失败定义逐条:校验失败/JSON 解析失败/工具执行抛错/超时,各重试一次 → null;`bindTools` 方法检测 + 调用失败兜底
- [ ] **独立 `decisionTimeoutMs`(默认 5-8s)与更大 `maxTokens`**(避免继承 summaryLlm 1024 截断 JSON)
- [ ] selftest:decide 成功输出 / 校验失败重试 / 超时 null / 不支持工具 null(用 stub llm)

## 5. 压缩执行改造(`useContextManager.compress`)
- [ ] `compress(messages, decision?)`:token 模式按 `windowRatio` 换算预算(走现有累加循环)、轮数模式按 `keepRounds` 切分(补 older 空早退)
- [ ] 按 `recallTopK` 召回(0=不召回)、按 `summarize.mode` 选摘要(`llm` 含 undefined 回退)、preserve 集 = 配置 ∪ `preserveTools`
- [ ] 无决策 → 完全现状(静态路径,零变化)
- [ ] summaryMsg 附注 `(压缩决策:keepRounds/windowRatio · reason/mode)`;stats 增 `decision?` 字段 + `CompressionStats` 类型
- [ ] selftest:决策驱动切分/召回/preserve/摘要模式生效 / 无决策回退静态 / stats 含 decision

## 6. 能力开关 + 装配
- [ ] `capabilities.agentCompression`(默认关,`requires: ['summarization']`)注册进 `capabilities.ts`
- [ ] `createChatSdk`:开且 summaryLlm 可用 → `decide` 传 summarization 中间件;开但无 LLM → warn + 不装决策
- [ ] `summarization.compressInput`:**先 `shouldTriggerCompression` gate** → 通过才 `decide` → `compress(messages, decision)`;null → 静态
- [ ] selftest:开/关开关行为 + 无 LLM 时 warn 降级 + e2e:`capabilities.agentCompression` 反映

## 7. context-inspector 联动(依赖前置)
- [ ] `context-inspector` 面板显示「上次压缩由 agent 决策」(读 `contextSnapshot.compression.decision`)
- [ ] `analyzeContext` 导出复用(本 change 的 inspect_context 数据源)
- [ ] `types/index.ts` 的 `lastCompression` 内联类型 + `types/index.d.ts`(手动维护)同步 `decision?` 字段
- [ ] **注:前置 change 完成后才实施本条**

## 8. 文档
- [ ] `doc/usage-guide.md` 补「压缩决策」小节:`capabilities.agentCompression` + summaryLlm 配置 + 降级行为 + 触发模式说明
- [ ] README 中英补能力 + 用法片段
- [ ] CLAUDE.md 架构要点补 agent-driven-compression(决策数据流 + 降级链 + 与 enableLLMSummary/contextPreset 关系 + 触发预检)

## 9. 示例 + 全量回归
- [ ] complex-demo 或新 demo:开 agentCompression,长对话触发决策压缩,验证摘要含决策注记
- [ ] **browser mock 扩展**:`tests/browser/_helpers.ts` 的 `mockLlm()` 支持「tool_calls 轮 → ToolMessage → 最终 JSON」两段式脚本序列(决策压缩 e2e 的前置基建)
- [ ] browser:决策压缩端到端(触发 → 决策 → 摘要含注记)。browser 计数 +1~2
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:agent-driven-compression 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
