# Tasks: add-cross-round-working-memory

> 顺序:期一(WorkingMemory 中间件 + 提取)→ 期二(preserve 默认扩展)→ 期三(vfs 索引注入)→ 期四(recall 三路 + hash 持久)→ 期五(测试 + 文档 + 门禁)。
> 全程向后兼容:`capabilities.workingMemory: false` = 完全关闭。

## 期一 — WorkingMemory 中间件 + 提取(P0)

- [ ] 新增 `src/core/harness/workingMemory.ts`:`createWorkingMemoryMiddleware()` 中间件
  - `WorkingMemory` 接口:`{ locatedPaths: string[]; lastHash?: string; draftVfsPath?: string; notes: string[]; updatedAt: number }`
  - `afterToolCall`:从 read 提取 path+hash;从 query/search 提取匹配 path;从 draft_write 提取 draftVfsPath;从 draft_commit 清除 draftVfsPath;从 write 回执 affectedPaths 追加 notes
  - `augmentPrompt`:注入 `## 工作记忆` 段(locatedPaths + lastHash + draftVfsPath + notes)
  - `compressInput`:豁免 workingMemory 段(不进 older/summary)
  - locatedPaths ≤ 50 LRU;notes ≤ 20 LRU
- [ ] `src/core/harness/createAgent.ts`:`HarnessState` 增 `workingMemory?: WorkingMemory` 字段
- [ ] `src/core/sdk/createChatSdk.ts`:装载序 mission 之后、todos 之前;`capabilities.workingMemory`(默认 true)
- [ ] 门禁:`npm run test:types` + `npm test`

## 期二 — preserveLastToolResults 默认扩展(P0)

- [ ] `src/core/composables/useContextManager.ts`:`preserveLastToolResults` 默认从 `['describe_data','read']` 扩展为 `['describe_data','read','query_data','search_data']`
- [ ] preserve 内容:query/search 保留匹配项 path 列表(≤ 20 项),不含全量 value
- [ ] 集成方显式配置时完全覆盖(不合并)
- [ ] selftest:preserve 默认含 query/search;显式配置覆盖
- [ ] 门禁:`npm run test:types` + `npm test`

## 期三 — 压缩注入活跃 vfs 索引(P1)

- [ ] `src/core/harness/summarization.ts`:`compressInput` 扫描 `state.vfs` 的 `large_results/` + `drafts/` 文件列表,注入摘要 `【外存文件】path(size)`
- [ ] selftest:压缩摘要含 vfs 文件列表;无 vfs 文件时不注入
- [ ] 门禁:`npm run test:types` + `npm test`

## 期四 — recall 三路 + hash 持久(P1)

- [ ] `src/core/composables/useContextManager.ts`:`recallRounds` 升级三路(mission.goal + lastUserQuery + workingMemory.locatedPaths),dedupeByIndex 去重,topK 不变
- [ ] `src/core/tools/dataOps.ts`:write autoLock 优先取 `state.workingMemory?.lastHash`,fallback `lastReadHash`
- [ ] selftest:三路召回去重;autoLock 取 workingMemory.lastHash;跨轮压缩后 hash 仍可用
- [ ] 门禁:`npm run test:types` + `npm test`

## 期五 — 测试同步 + 文档 + 门禁

- [ ] selftest(新模块 sec-31 或扩展):
  - workingMemory extract:read/query/search/draft_write/draft_commit/write 后 locatedPaths/lastHash/draftVfsPath/notes 反映
  - augmentPrompt 注入工作记忆段
  - compressInput 豁免
  - preserve 默认含 query/search
  - recall 三路去重
  - autoLock 取 workingMemory.lastHash
  - capabilities.workingMemory: false 关闭
  - runner 注册 + 计数同步
- [ ] e2e:inspect().workingMemory 反映;capabilities.workingMemory: false 时 undefined
- [ ] `CLAUDE.md`:架构要点新增「工作记忆」;测试矩阵/计数同步
- [ ] `doc/architecture.md`:记忆平面改进说明
- [ ] `doc/usage-guide.md`:新增 §「跨轮工作记忆」
- [ ] `README.md` / `README.zh-CN.md`:特性列表加「跨轮工作记忆」
- [ ] `CHANGELOG.md`:新增条目
- [ ] 门禁全跑:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports` → `npm run test:types` → `npm run test:size`
- [ ] openspec 归档 + specs 合入
