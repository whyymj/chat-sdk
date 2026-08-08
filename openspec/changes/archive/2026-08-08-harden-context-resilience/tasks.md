# Tasks: harden-context-resilience

> 5 Phase,每 Phase 独立 commit(selftest/e2e 绿后)。依赖:P3←P1+P2,P5←P2,P4 独立。详细见 plan。

## Phase 1 — 地基 + 错误识别 + subagent + 最小窗口校验 ✅
- [x] `isContextLengthError`(新 `harness/errors.ts`):复用 `ContextOverflowError.isInstance` + `lc_error_code==='CONTEXT_OVERFLOW'` + 兜底正则。不进 `isRetryable`。导出。
- [x] `createAgent.setModelCaps(caps)`:`caps/offloadThreshold/offloadPassThrough` const→let + 返回对象暴露(`createAgent.ts:270-278,768`)。
- [x] 中间件 controller:`createSummarizationMiddleware`/`createContextInspectorMiddleware` 返回 `{ middleware, setContextWindow(cw) }`(复用 focusMw 模式)。
- [x] modelCaps 重算 + 集中回灌在 `createChatSdk.setLlm`(用原 llmOpt,保留 LLMConfig.contextWindow 声明;onLlmChange 实例路径拿不到 → setLlm 权威)+ `core.agent.setModelCaps` + 各 setContextWindow + infoTick++。summarization 装配变量化。启动校验(`:694` 后)+ vite globals 补 `@langchain/core/errors`。
- [x] **M3 subagent**(`subagent.ts:161`):实例/配置两分支提取 model 名 + 读实例 contextWindow → `resolveModelCaps` → 传 contextWindow/maxOutputTokens(兼修 16K silent bug)。
- [x] **最小窗口校验**:`MIN_CONTEXT_WINDOW=200000`(modelCaps.ts 导出);createChatSdk 启动 + setLlm + subagent 解析后,<200K throw。resolveLlm 实例路径读 `llm.contextWindow`(真实实例/stubModel 声明)。
- [x] 导出 `isContextLengthError` + `MIN_CONTEXT_WINDOW`(index.ts + types)。
- [x] selftest(sec-55,22 用例):isContextLengthError 各形态 / MIN_CONTEXT_WINDOW / resolveModelCaps 查表 / setContextWindow controller。
- [x] e2e(boundary 3 用例):<200K 启动 throw + 声明放行 + setLlm throw。
- [x] 全量绿:selftest 1295→1317 / e2e 349→352 / tsc 无 src 错 / build 无 warning。

## Phase 2 — 预防口径 ✅
- [x] H1 `trimContextIfNeeded` 改 token 口径(`estimateTokens`)+ over-window warn(单轮 currentMessages ≤ 60% 窗口)。
- [x] H2 `compress` 组装后算 totalTokens,仍超窗口 → console.warn(`useContextManager.ts`)。
- [x] **优化 B 简化(v3 决策)**:≥200K 硬窗口下用**固定比例**(compress windowRatio / H1 trim 0.6 / P2 trim 0.3 / system 段 0.25),无需 systemTokens 账本 + 双向协调 —— 单向、简单、窗口足够大留有余量。
- [x] L1 `offloadPassThroughChars` 注释口径统一。
- [x] selftest(sec-23):H1 trim token 口径 + keep 自适应(100/400 clamp)。

## Phase 3 — 自动收敛(P2 反应性重试 + P1 简化)✅
- [x] P1 setLlm 简化:setLlm **不 splice 持久 messages**(无副作用/无竞态),仅换模型 + setModelCaps + 各 setContextWindow + 最小窗口校验;历史适配由下次 compressInput 自动完成。
- [x] P2 反应性重试(红队 #2 + 优化 A):`coreModelCall` **双 catch** —— 启动 catch(`:427`,BaseChatModel.stream 同步抛)+ 迭代 catch(`:463`,首个 chunk 抛 + 未 emit 守卫 `aggregated===null && content===''`)识别 isContextLengthError → 激进 `trimContextIfNeeded(0.3 窗口)` → 单次重试(`_ctxRetry` 防死循环)→ 仍超抛。迭代中已 emit 不重试。
- [x] selftest(sec-23):P2 迭代重试成功(CtxOverflowLLM 第 2 轮恢复)+ 单次上限(CtxOverflowTwiceLLM 连续超限抛)。
- [~] **browser mock 延后**(mockLlm 加 400+context_length_exceeded 脚本);selftest 逻辑层已覆盖 P2 全路径,端到端 browser 验证留后续。

## Phase 4 — vfs 引用保护 + OOM 兜底 ✅
- [x] `VfsStore.setProtectedRefs(refs)` + `enforceLimit` 删前跳过被引用(仅 large_results 池,防 vfs_read 404)。
- [x] createChatSdk stream 入口(`:1394`)`vfsStore.setProtectedRefs(extractVfsRefs(msgs))`。
- [x] OOM 硬兜底(红队 #7):池 > `poolMax × 1.5` → 无视 protectedRefs 强制 LRU 删到 watermark + warn(防全池被保护不收敛)。
- [x] selftest(sec-55):protectedRefs 保护 + OOM 1.5x 兜底 + extractVfsRefs 纯函数 + 未设 protectedRefs 默认 LRU。

## Phase 5 — 系统段截断 ✅
- [x] `buildSystemPrompt` 预算截断:system 段超 `0.25 × contextWindow` → **非 pin 段从大到小 drop**(丢最大段优先 = 丢最少段数,dataHint 巨型 schema 常最大先丢),保 base + pin(mission/workingMemory)。预算直接用 `caps.contextWindow × 0.25`(v3 简化,非 systemTokens 账本)。
- [x] **dataHint 降级**:复用已有 `extractSchemaHint` 分层披露(maxKeys=15/maxChars=4000 默认 → `renderSchemaShallow` 概览,集成方经 `schemaHint` 可调)—— 无需额外工作,大 schema 自动转顶层概览。
- [x] **systemPrompt 本身超预算** → stream 入口 fatal 早退(`SYSTEM_PROMPT_OVER_BUDGET`,emit error + done,不进 ReAct);buildSystemPrompt 截不掉 base,由 stream 拦截。
- [x] selftest(sec-23):buildSystemPrompt 截断(drop dataHint 保 mission/memory)+ base 超窗 fatal + 正常 systemPrompt 不误伤。
- [~] **单条 user offload(优化 C)决策跳过**:**≥200K 硬窗口下单条 user 超窗(>800K 字符)几乎不可能**;若用工具级 offload 阈值(7000 字符)会误伤正常长提问。价值极低且易误伤,deferred。

## 全量回归 ✅
- [x] `npm run build`(无 warning)+ `npm test`(**1342** 全过)+ `npm run test:e2e`(**353** 全过)+ tsc 无 src 错。
- [x] 计数同步 CLAUDE.md / README 中英(selftest 1295→1342 / e2e 349→353)。
