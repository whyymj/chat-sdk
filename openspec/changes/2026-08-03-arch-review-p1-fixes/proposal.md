# Change: arch-review-p1-fixes (P1 架构债修复)

> 修复 2026-08-03 架构审查(3 agent 交叉)发现的 **P1 级架构债 / 边界问题**(6 项 + P2 优化附注)。P0 数据安全逃逸在独立 change:`2026-08-03-fix-write-safety-bypass`。
> **状态**:proposal(未实施)。P1,按项独立 commit,可分批推进。

## Why

审查确认的真实问题(非理论,均有代码行号证据):

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1-1 | **wrap-up 收口绕过中间件栈** | `createAgent.ts:667` 直接调 `coreModelCall(..., llm)` 而非 `modelHandler`(`:514` composeModelCall) | wrap-up 那次综合调用不经过 `sdk-events.afterModel` → **usage 少计**、不发 `usage` 事件;`budget.wrapModelCall` 不执行 → automation token/time 预算在最后收口**失效**;用户自定义 wrapModelCall(埋点/缓存/拦截)被跳过 |
| P1-2 | **并发 send 共享闭包 `state` 竞态** | `createAgent.ts:488` 每次 stream 重赋 `state = createInitialState()`;工具 ctx `:615` 捕获当时的 `state`;`sdk.send`(`createChatSdk.ts:1080`)无互斥;UI 队列只保护单视图 | shareContext 双视图同时 send(headless 未 await 双发)时 A 在 runBeforeModel 后用已被 B 重赋的 state → 工具 ctx 拿 B 的 state,A 的 offload 写入 B 的 vfs;`debugLogs.value=[]` 互相清日志。**顺序跨 send 安全**(中间件闭包是真相源 + beforeAgent 重注入),真缺陷只在并发 |
| P1-3 | **beforeReturn 钩子被 `maxVerifyAttempts=0` 短路** | `createAgent.ts:594` `if (!garbled && maxVerifyAttempts > 0 && ...)` 唯一调用点,门前置 verify 预算;默认 `maxVerifyAttempts=0`(`:244`) | 用户自定义中间件实现 `beforeReturn` 返回 feedback 触发自纠,但不开 `capabilities.verify` 就**静默永不执行**(公开 Middleware 契约失效);且与 verify 共用 `state.verifyAttempts` 预算,verify 开时用户 beforeReturn 被 verify 失败次数提前耗尽 |
| P1-4 | **subagent/verify 捕获 `allTools` 初始快照** | `createChatSdk.ts:815` 构造时传 `allTools` 数组引用;`setTools`(`:1229`)/MCP 连接(`:1453`)重新赋值;`subagent.ts:144-147` 用 `opts.allTools.filter(...)` 给子 agent 筛工具 | 运行时 setTools 加的自定义工具 / MCP 工具对子 agent **永久不可见**;显式 `allowedTools` 配置被静默忽略 |
| P1-5 | **switchSession/onClear 不重置 mission/workingMemory** | `createChatSdk.ts:1179-1186`(switchSession 只重置 messages/vfs/todos/memory/debugLogs)**缺** missionMw/workingMemoryMw;`onClear:1612-1619` 同缺 | 切新会话后旧 mission goal + workingMemory 的 pin(jsonPath/hash)原样注入新会话 system prompt → 过期 hash 诱发乐观锁误冲突 / 按错误 path 写 |
| P1-6 | **`setMission({})` 清空后被历史重捕** | `mission.ts:55-61` beforeAgent:`if (!mission) mission = captureFromMessages(state.messages)`;`setMission({})` 置 `mission=undefined`(`:73-76`),无法区分「从未 capture」与「被显式清空」 | 集成方收尾调 `setMission({})` 解除锚定,下一次 send 从完整历史**重新捕获**含任务动词的旧 user 消息 → agent 被锚到过期目标,无告警 |

## What Changes

### 1. wrap-up 走中间件 model-call 栈(P1-1)
- `createAgent.ts:667`:对 wrap-up 单独 `composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal, llm))` 再调用,让 `afterModel`(usage 累计/事件)/`budget`(预算闸)/用户 wrapModelCall 正常参与。

### 2. 并发 send 的 state 隔离(P1-2)
- **方案 A(推荐,改动小)**:`send` 层串行化 —— 复用 Promise 链/互斥锁,同一 sdk 实例并发 send 排队执行,杜绝共享闭包 state 竞态。UI 队列已保护单视图,headless 补一层即可。
- **方案 B(重构,改动大)**:per-invocation 局部 state 贯穿中间件链,不重赋闭包变量。需评估中间件契约影响。
- 二选一,见「决策」1。

### 3. beforeReturn 门禁解耦(P1-3)
- createAgent 无条件调用 `runBeforeReturn`,把「超限强制 return」逻辑移入循环预算检查(`maxVerifyAttempts` 改为 verify 中间件自己的预算,或独立计数),不再短路用户中间件的 beforeReturn。

### 4. subagent/verify 工具池 getter 化(P1-4)
- `createChatSdk.ts:815`/`843`:subagentMw/readonlyTools 接收 `allTools` 改为 **getter `() => allTools`**(与 dataOps `liveData()`、verify `root` 的 getter 模式一致),每次 spawn/check 时取最新;或 subagent 从 `ToolCallContext` 拿主 agent 当前工具集。

### 5. switchSession/onClear 重置 mission/workingMemory(P1-5)
- `missionMw`/`workingMemoryMw` 补 `reset()` 方法(清 mission / 清 locatedPaths+lastHashes);`switchSession` 与 `onClear` 内调用,与现有 todos/vfs/memory 重置对齐。

### 6. `setMission({})` 防重捕(P1-6)
- `setMission({})` 时置 `explicitlyCleared` 标记,`beforeAgent` 仅在「从未 capture 且未清空」时才自动 capture;或清空时记录 `clearedSourceMessageIdx` 排除历史。

### 附:P2 优化注记(本 change 不实施,记录方向)
- 单次 patch 写 ≈ 7×O(N):lazy 逆操作快照(存 `{op, jsonPath, oldValue}` 逆向回放,restore 降 O(depth))+ hash 记忆化(以 `markDataDirty` 失效)。
- 循环内渐进压缩缺失:`compressInput` 只在进循环前跑一次,循环内仅 `trimContextIfNeeded` 硬截断。
- `buildSystemPrompt` 每轮重跑 2-3 次(`toLC`/`replaceSystem`/wrap-up),可按轮缓存。
- `data_change` 事件广播整个 bind,应改轻量元信息。
- mission/workingMemory/budget 未进 `MIDDLEWARE_PRIORITY`,声明语义与实际排序漂移。

## Impact

- **测试**:P1-1 补 e2e(wrap-up 后 usage 累计正确 / budget 在收口生效);P1-2 补并发 send 测试或文档化串行保证;P1-3 补自定义中间件 beforeReturn 触发测试(不开 verify);P1-4 补 setTools 后 spawn_agent 能见新工具测试;P1-5 补 switchSession 后 mission/workingMemory 为空断言;P1-6 补 setMission({}) 后 send 不重捕断言。
- **行为变化**:P1-1 修正 usage/budget(补记之前漏计的收口 token);P1-2 并发 send 变串行(行为更可预期);P1-3 修复契约(用户 beforeReturn 开始生效,需注意 verify 预算语义);P1-5 切会话不再污染(行为收紧);P1-6 清空语义生效(行为收紧)。均有向后兼容或安全收紧性质,无破坏性 API 变更。
- **向后兼容**:全部为行为修正,无公开 API 签名变化(新增 reset() 为中间件扩展方法)。

## 决策

1. **P1-2 并发方案 A(串行化)优先**:并发真场景少(shareContext 双视图 / headless 双发),方案 B per-invocation state 牵动中间件契约,改动面大。先串行化兜底,若未来需要真并行再评估 B。
2. **P1-1 必须与 usage 语义对齐**:wrap-up 走 modelHandler 后 usage 会多计之前漏掉的收口 token,这是修正而非回归;确认 budget 预算闸在 wrap-up 生效不破坏「工具已用尽必须综合」的兜底语义(budget 超限时 wrap-up 也应完成综合,只计费)。
3. **P1-3 与 verify 预算解耦**:verify 自纠次数独立管理;用户 beforeReturn 不受 verify 预算限制(但仍受 `maxIterations` 总闸)。
4. **P2 优化不进本 change**:避免范围膨胀,单独评估或下个 backlog。

## Non-goals

- 不做 P0 数据安全(独立 change:`2026-08-03-fix-write-safety-bypass`)。
- 不做 P2 性能优化(见「附」注记,单独评估)。
- 不做 createChatSdk 拆分 / createAgent 契约回归(p2-refactor ① ②,已在 deferred 等痛点驱动)。
