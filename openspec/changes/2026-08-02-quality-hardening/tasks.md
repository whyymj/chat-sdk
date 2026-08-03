# Tasks: quality-hardening (P1)

> 关联 `proposal.md`。P1 第一批(budget 运行时测 + batch splice + usage 注释)已在 commit 499dad9 完成。剩集成测 + 小 perf + 文档。

## 1. stub BaseChatModel(先验证)
- [x] `tests/e2e/_stub-model.mjs`:stub BaseChatModel(_streamResponseChunks yield ChatGenerationChunk{message:AIMessageChunk} + _generate 聚合 + bindTools 返回 this);可控响应队列(文本/工具调用/抛错/usage)
- [x] 验证 stub 可用:automation.mjs budget 端到端测(stub 注入 usage.total_tokens=1000 → 第二轮 wrapModelCall 拦截 model.calls=1 + emit BUDGET_EXCEEDED),chunk 解析 OK,踩坑风险排除
- [ ] (若 stub 不稳)降级:运行时测标 TODO + manual,不阻塞 —— stub 已跑通,无需降级

## 1. automation 运行时测(stub)
- [x] budget 超限 → agent 停止(commit 499dad9 测中间件层,本次补端到端:stub 注入大 usage → 第二轮拦截 + BUDGET_EXCEEDED)
- [x] send 致命错误恢复:stub throw(status:400 非 retryable)第一次抛错 → restore_last_checkpoint + retry(maxAutoRetries)→ 第二次成功 + emit AUTO_RECOVER_RETRY
- [x] batch 任务隔离:stub [成功,抛错,成功] → results.ok 混合(任务2 ok:false 不中断)+ 失败任务 messages splice truncate + emit BATCH_TASK_FAILED
- [x] 断点续跑:store 写 checkpoints/usage → 新实例同 id 恢复 → listCheckpoints 有值 + usage 连续(total=500)+ restoreLastCheckpoint 可用。**⚠ 运行时测驱动发现并修复 storage bug**:`SnapshotKind` 不含 checkpoints/usage → persistRuntime 写的 checkpoints/usage 从未持久化(automation 断点续跑功能 2.20 发布但持久化未生效);加 kind 后跨实例恢复生效

## 1. subagent-writable 集成测
- [x] spawn_agent 透传 writablePaths:子 agent 写 writablePaths 内(components.0.title)→ 成功 + settings 隔离;越界(settings.theme)→ PATH_OUT_OF_SCOPE 拒绝 → 不写
- [x] 整体 set 禁(无 jsonPath 盲区 → 拒) —— wrapWithPathGuard 整体 set 拒 sec 已覆盖(path guard 模块),端到端透传已上述验证

## 1. todos-tier 行为测
- [x] write_todos 层级输入(parentId/deps)→ inspect().todos 反映层级(子任务 parentId/deps 保留);render 层级逻辑 sec 已覆盖(renderTodos 层级/扁平/hydrate/自指/互指)

## 2. 小 perf
- [x] `createAgent.ts:458` formatForLog short-circuit:`if (!debug && !onLog) return []`(生产不 stringify,每轮 O(context)→O(1);debugLogs 仍 push entry 供 round/model 诊断,仅 messages 字段空)
- [x] `llm/proxyLlm.ts` direct 生产安全闸:新增 `throwOnDirectInProduction`(默认 false=warn 向后兼容;true=throw opt-in 升级防 apiKey 泄露)。按 proposal §Impact「默认 warn 保留 + 配置升级 throw」实现(§决策2 命名 dangerouslyAllow 与默认 warn 语义矛盾,采清晰命名)
- [x] `presets.ts` extractSchemaHint:WeakMap 按 schema 对象引用 + optsKey 缓存(setData 传新 schema → 新引用自动 miss,无需手动失效;controller.set 同理);原逻辑抽 computeSchemaHintImpl 便于缓存层包裹
- [ ] 性能对比(可选 bench):长任务 formatForLog/augmentPrompt 前后 —— 留 TODO;perf 改动对外行为不变,正确性靠现有 selftest(sec-19/31/37)覆盖

## 3. 文档债(中英同步)
- [ ] `doc/usage-guide.md`:tracing 用法 + automation §1-4 用法
- [ ] `doc/usage-guide.en.md`:同(英文)
- [ ] `doc/capability-boundaries.md`:B7 移「能做」+ automation 说明
- [ ] CLAUDE.md 计数同步(selftest/e2e 新增)

## 3b. 审计脚本修正(maliang-real-findings ⚠ 发现)
- [ ] `tests/runtime/` 真 LLM 审计脚本:onEvent tool_call 在 send(invoke)模式不外发(仅 stream 模式发),任务级工具链收集为空 → 改用 `inspect().trace.metrics.toolCalls` 增量收(或 stream 模式收 tool_call),不依赖 onEvent
- [ ] 审计脚本输出对齐 trace.metrics(轮次/工具成功率/压缩频次/model 调用数)

## 收尾
- [ ] observability-tracing change 文档项完成 → 归档
- [ ] 全测绿 + CHANGELOG
