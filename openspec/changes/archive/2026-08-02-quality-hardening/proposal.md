# Change: quality-hardening (P1 测试+小 perf+文档债)

> 📦 **已归档(2026-08-03,全部完成)**。§1(stub 基建 + automation/subagent-writable/todos-tier 运行时测,commit d1b297e)+ §2(formatForLog/proxyLlm/extractSchemaHint 小 perf,commit 21fefd0)+ §3(中英 usage-guide §6.13/§6.14 + capability-boundaries B7 文档债)+ §3b(tests/runtime/ 3 脚本 tool_call 收集修正)全部完成并随 2.21.0/2.22.0 发布。e2e 实跑 283 全过。详细勾选见 tasks.md。

> 补 4 agent 审查(maintain/perf)的 P1 项:运行时集成测盲区(违反 CLAUDE.md 测试同步约定)+ 小 perf(formatForLog/proxyLlm/augmentPrompt)+ 文档债(observability/automation 详细段)。
> ~~状态:proposal(未实施)~~ → **2026-08-03:§1§2§3§3b 全部实施完成,见 tasks.md。**

## Why
- **maintain HIGH(违反硬约定)**:budget / automation §2-4(send 恢复+batch+断点续跑)/ subagent-writable 集成 / todos-tier 行为 —— **当前只测 inspect 反射,没测运行时**。budget 已补(commit 499dad9),剩 automation/subagent-writable/todos-tier 运行时。
- **perf MED**:`formatForLog` 每轮 O(context) stringify,debug=false 也强制记录(createAgent.ts:274,长任务 O(N²));`proxyLlm` direct 生产仅 warn(apiKey 进 bundle);`augmentPrompt` 每轮重算 schema hint(无缓存)。
- **文档债**:observability-tracing 的 usage-guide/capability-boundaries 详细段(2.19 标"发布时补"未做)+ automation 同。CHANGELOG 已覆盖核心,但 usage-guide/capability-boundaries 缺详细用法。

## What Changes

### 1. 运行时集成测(stub BaseChatModel)
- 写 `tests/e2e/_stub-model.mjs`:stub BaseChatModel(_generate → AIMessage,stream fallback),可控响应(文本/工具调用/抛错)
- automation 运行时测(e2e automation.mjs 扩展):
  - budget 超限 → agent 停止(commit 499dad9 已测中间件层,补端到端)
  - send 致命错误 → restore_last_checkpoint + retry(maxAutoRetries,stub 第一次抛错第二次成功)
  - batch 任务隔离(stub 一任务抛错一任务成功 → results.ok 混合,失败任务 truncate)
  - 断点续跑(store 写 checkpoints/usage → switchSession 恢复 → restoreLastCheckpoint 可用 + usage 连续)
- subagent-writable 集成(spawn_agent 透传 writablePaths + 子 agent 越界 PATH_OUT_OF_SCOPE 端到端)
- todos-tier 行为(write_todos 层级 + update_todo 增量,真跑 render)

### 2. 小 perf
- `createAgent.ts:274,458-480` formatForLog:`if (!debug && !onLog) return` short-circuit(debug=false 不 stringify,省 O(N²))
- `llm/proxyLlm.ts:81-88` direct 生产模式:https + 非 localhost → throw(需 `dangerouslyAllowDirectInProduction:true` 才放行;默认 warn 保留兼容)
- `sdk/promptBuilder.ts` + `presets.ts` extractSchemaHint:按 schema 对象引用缓存 hint 字符串,setData/controller.set 失效

### 3. 文档债
- `doc/usage-guide.md`/`.en.md`:tracing 用法(capabilities.tracing + onEvent('trace') + DebugDrawer Trace tab)+ automation 用法(§1-4)
- `doc/capability-boundaries.md`:B7 observability 移「能做」(已实现,非边界)+ 加 automation 能力说明
- observability-tracing change 的文档项做完 → 归档

## Impact
- **测试**:`tests/e2e/_stub-model.mjs`(新)+ automation.mjs/subagents.mjs 扩展。stub model chunk 解析有踩坑风险(先跑通 budget 端到端验证 stub 可用)
- **小 perf**:createAgent/proxyLlm/promptBuilder 局部改,低风险(formatForLog short-circuit 注意 debug 模式仍记录)
- **文档**:doc/(.gitignore,git add -f)
- **向后兼容**:proxyLlm 生产 throw 需评估(可能破坏现有 direct 生产集成方)→ 默认 warn 保留 + 配置升级 throw

## 决策
1. **stub model 先验证**:在 automation.mjs 写一个 budget 端到端测,跑通 stub model(证明 chunk 解析 OK)再扩展其他运行时测。若 stub 不稳,运行时测降级为 manual(标 TODO)
2. **proxyLlm 生产 throw 不破兼容**:默认仍 warn(向后兼容),加 `dangerouslyAllowDirectInProduction:false`(默认)在 production 显式 throw。集成方 opt-in 升级
3. **文档债中英同步**(CLAUDE.md 要求):usage-guide.md + usage-guide.en.md 都补

## Non-goals
- 不做 checkpoint 增量(perf HIGH,独立 change:checkpoint-incremental-snapshot)
- 不做 P2 重构(独立 change:p2-architecture-refactor)
- stub model 不替代 mockLlm(browser e2e 的 mockLlm SSE 不变,stub 用于 node e2e 顶层运行时)
