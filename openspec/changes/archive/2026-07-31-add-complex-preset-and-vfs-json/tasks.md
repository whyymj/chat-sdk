# Tasks: add-complex-preset-and-vfs-json

> 顺序:期一(complex 预设)→ 期二(vfs JSON 工具)→ 期三(三池分池)→ 期四(offload 元数据)→ 期五(测试 + 文档 + 门禁)。
> 全程向后兼容:不传新配置 = 现状行为。

## 期一 — complex 上下文预设(P2)

> 注:预设机制经 `unify-context-compression` 重构为**比例制**,字段是 `summaryThresholdRatio`/`windowRatio`/`recallTopK`/`enableRecall`(非旧的 `windowRounds`/`summaryThreshold`);映射在 `src/core/sdk/contextPreset.ts`(非 useContextManager.ts)。`preserveLastToolResults` 不在预设,在 `createChatSdk.ts` 按 preset 取。

- [ ] `src/core/sdk/contextPreset.ts`:`ContextPreset` 类型加 `'complex'`;`CONTEXT_PRESETS` 增 complex 项(`summaryThresholdRatio=0.7, windowRatio=0.6, recallTopK=5, enableLLMSummary=true`)
- [ ] `src/core/sdk/createChatSdk.ts`:`preserveLastToolResults` 默认值改为按 preset 取(加 `PRESET_PRESERVE` 映射,complex 扩 `query_data`/`search_data`);`contextOptions.preserveLastToolResults` 仍可覆盖
- [ ] selftest:`CONTEXT_PRESETS.complex` 字段反映;`resolveContextOptions({contextPreset:'complex'})` 含 complex 值;与其他预设不冲突
- [ ] 门禁:`npm run test:types` + `npm test`

## 期二 — vfs JSON 感知工具(P2)

- [ ] `src/core/backends/vfs.ts`:新增 `vfs_json_read({ path, jsonPath? })` 工具(parse + getByPath;非法 JSON VFS_JSON_INVALID)
- [ ] `src/core/backends/vfs.ts`:新增 `vfs_json_patch({ path, patches })` 工具(parse → applyPatchToClone → 校验 → 写回;原子性)
- [ ] `src/core/backends/vfs.ts`:`vfs_write` 增 `jsonString?` 参数(true 时校验 JSON 合法性)
- [ ] selftest:vfs_json_read 整体/子路径;非法 JSON 报错;vfs_json_patch set/remove/merge/append;vfs_write jsonString 校验
- [ ] e2e:inspect().tools 含 vfs_json_read/vfs_json_patch + source=builtin
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`

## 期三 — vfs 三池分池(P2)

> 注:drafts 池依赖前序 change `add-data-paging-and-chunked-write` 的 `draft_write`(当前未实现)。本期建 drafts 池结构 + 独立 LRU 占位,等前序接入;largeResults/userFiles 分池立即生效。

- [ ] `src/core/backends/vfs.ts`:三池结构(largeResults/drafts/userFiles);按 path 前缀路由;独立 LRU
- [ ] `vfs.maxBytes` 默认 8MB(三池之和);`vfs.poolBytes` 可单独配置每池
- [ ] `vfs_read`/`vfs_ls`/`vfs_glob`/`vfs_grep` 跨池透明;`vfs_write`/`vfs_edit` 自动入池
- [ ] selftest:三池独立 LRU;large_results 不挤占 drafts;userFiles 独立;跨池读取
- [ ] 门禁:`npm run test:types` + `npm test`

## 期四 — offload 元数据增强(P2)

- [ ] `src/core/harness/createAgent.ts`:`offloadLargeResult` 返回结构化 `{ offloaded, path, totalChars, preview, suggestedReadPlan? }`
- [ ] `suggestedReadPlan`:totalChars > 10000 时建议分页 vfs_read
- [ ] selftest:offload 返回结构化;大结果含 suggestedReadPlan;小结果无
- [ ] 门禁:`npm run test:types` + `npm test`

## 期五 — 测试同步 + 文档 + 门禁

- [ ] selftest(新模块 sec-33 或扩展):
  - complex 预设配置 + contextOptions 覆盖
  - vfs_json_read 整体/子路径/非法 JSON
  - vfs_json_patch set/remove/merge/append + 原子性
  - vfs_write jsonString 校验
  - 三池独立 LRU + 跨池透明
  - offload 结构化元数据 + suggestedReadPlan
  - runner 注册 + 计数同步
- [ ] e2e:inspect().contextPreset 反映;inspect().tools 含新 vfs 工具
- [ ] `CLAUDE.md`:架构要点更新(complex 预设 / vfs JSON 工具 / 三池分池 / offload 元数据);测试矩阵/计数同步
- [ ] `doc/architecture.md`:体验平面改进说明
- [ ] `doc/usage-guide.md`:新增 §「complex 预设 + vfs JSON 工具」
- [ ] `README.md` / `README.zh-CN.md`:特性列表加「complex 预设 + vfs JSON 感知」;presets 表加 complex
- [ ] `skills/page-agent-sdk-integrate/references/api.md`:加 vfs_json_read/vfs_json_patch 行;contextPreset: complex 说明
- [ ] `CHANGELOG.md`:新增条目
- [ ] 门禁全跑:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports` → `npm run test:types` → `npm run test:size`
- [ ] openspec 归档 + specs 合入
