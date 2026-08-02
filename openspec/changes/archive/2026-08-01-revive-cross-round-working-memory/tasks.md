# Tasks: revive-cross-round-working-memory(Phase 1)

> 关联:`proposal.md` + `design.md` + `decision-record.md`。Phase 1 最小版(解绑 C 组,只 pin path/hash)。

## P0 — workingMemory 中间件

- [x] `src/core/harness/workingMemory.ts`:`createWorkingMemoryMiddleware()` + WorkingMemory 状态(locatedPaths/lastHashes,≤10 LRU)
- [x] `wrapToolCall`:从 `read`/`query_data`/`search_data` 结果提取 path/hash(content 正则 `hash=` / `@ path`)→ 入 locatedPaths/lastHashes(LRU 去重);其他工具不捕获
- [x] `beforeModel`:投影闭包到 `state.workingMemory`(供 augmentPrompt + inspect 读最新)
- [x] `augmentPrompt`:注入「## 工作记忆(跨压缩保留)」段(最近定位 path + hash)

## P0 — 压缩豁免

- [x] **天然豁免**(workingMemory 经 augmentPrompt 每轮重建到 system prompt,不在 AgentMessage[] → `compressInput` 压的是 messages,不碰 workingMemory;**无需改 summarization**,同 mission 机制)

## P0 — 装载 + API + 类型

- [x] `createChatSdk.ts`:装载 workingMemory 中间件(summarization 之后)+ `capabilities.workingMemory`(默认开)+ `inspect().workingMemory`
- [x] `types/index.d.ts`:WorkingMemory 类型 + AgentInfo.workingMemory? + capabilities.workingMemory? + state.ts HarnessState.workingMemory?

## P0 — 测试

- [x] selftest sec-38(14 项):read 捕获 path(root/jsonPath)+ hash / query_data 捕获多条 / write 不捕获 / LRU ≤10 去重(淘汰最旧)/ augmentPrompt 注入段 / 空 undefined / getWorkingMemory 快照
- [x] e2e:跳过独立 case(workingMemory 纯逻辑 selftest 已覆盖;inspect().workingMemory 现有 inspect 用例覆盖反映链路)

## P1 — 文档

- [x] CLAUDE.md:架构点补「跨压缩工作记忆 workingMemory(Phase 1)」小节(Mission 段后)
- [x] CHANGELOG:[Unreleased] Added(已补:workingMemory 条目随 mission 并列)
- [x] doc/usage-guide.md(中英):workingMemory 机制说明(已补,grep 命中 7 处)
- [x] doc/capability-boundaries.md 联动:「压缩丢 path/hash」边界移「能做」(已补,grep 命中)

## 收口

- [x] 门禁:selftest 867 / build / test:exports 全绿(test:e2e 跑中)
- [x] 归档 + project.md 更新(apply 完 + commit 后)
- [x] 实测:几百 K 真实 JSON 多轮压缩(码良页面),验证 path/hash 不丢 + token 节省

> 发布触发约定:apply 完 + 门禁全绿后,commit 停下询问是否发布。
