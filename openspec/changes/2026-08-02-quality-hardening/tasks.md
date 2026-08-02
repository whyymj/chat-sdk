# Tasks: quality-hardening (P1)

> 关联 `proposal.md`。P1 第一批(budget 运行时测 + batch splice + usage 注释)已在 commit 499dad9 完成。剩集成测 + 小 perf + 文档。

## 1. stub BaseChatModel(先验证)
- [ ] `tests/e2e/_stub-model.mjs`:stub BaseChatModel(_generate → AIMessage,bindTools 返回 this,stream 走 _generate fallback);可控响应队列(文本/工具调用/抛错)
- [ ] 验证 stub 可用:automation.mjs 写 budget 端到端测(stub 响应 → 触发 budget 超限 → agent 停止),跑通证明 chunk 解析 OK
- [ ] (若 stub 不稳)降级:运行时测标 TODO + manual,不阻塞

## 1. automation 运行时测(stub)
- [ ] send 致命错误恢复:stub 第一次抛错第二次成功 → 验证 restore_last_checkpoint + retry(maxAutoRetries)+ 最终成功
- [ ] batch 任务隔离:stub [成功,抛错,成功] → results.ok=[true,false,true],失败任务 messages truncate(无残留 user)
- [ ] 断点续跑:store 写 checkpoints/usage → switchSession 恢复 → listCheckpoints 有值 + usage 连续 + restoreLastCheckpoint 可用

## 1. subagent-writable 集成测
- [ ] spawn_agent 透传 writablePaths:子 agent 写 writablePaths 内 → 成功;越界 → PATH_OUT_OF_SCOPE
- [ ] 整体 set 禁(无 jsonPath 盲区 → 拒)

## 1. todos-tier 行为测
- [ ] write_todos 层级输入(parentId/deps)+ update_todo 增量改层级 → inspect().todos + render 行为

## 2. 小 perf
- [ ] `createAgent.ts:274,458-480` formatForLog short-circuit:`if (!debug && !onLog) return`(debug=false 不 stringify)
- [ ] `llm/proxyLlm.ts:81-88`:生产 direct 模式 throw(需 dangerouslyAllowDirectInProduction:true;默认 warn 保留兼容)
- [ ] `sdk/promptBuilder.ts` extractSchemaHint:按 schema 引用缓存 hint,setData/controller.set 失效
- [ ] 性能对比(可选 bench):长任务 formatForLog/augmentPrompt 前后

## 3. 文档债(中英同步)
- [ ] `doc/usage-guide.md`:tracing 用法 + automation §1-4 用法
- [ ] `doc/usage-guide.en.md`:同(英文)
- [ ] `doc/capability-boundaries.md`:B7 移「能做」+ automation 说明
- [ ] CLAUDE.md 计数同步(selftest/e2e 新增)

## 收尾
- [ ] observability-tracing change 文档项完成 → 归档
- [ ] 全测绿 + CHANGELOG
