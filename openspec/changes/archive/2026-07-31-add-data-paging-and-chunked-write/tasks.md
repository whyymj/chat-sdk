# Tasks: add-data-paging-and-chunked-write

> 顺序:期一(read 分页)→ 期二(query/search cursor)→ 期三(draft write/commit)→ 期四(eval 子树)→ 期五(write 回执)→ 期六(测试 + 文档 + 门禁)。
> 全程向后兼容:不传新参数 = 现状行为。

## 期一 — read 数组分页(P0)

- [ ] `src/core/tools/dataOps.ts`:`read` 工具参数增 `offset?: number` + `limit?: number`;仅当 jsonPath 解析为数组时生效
- [ ] 返回结构分支:数组时 `{ items, total, offset, limit, hasMore, hash }`;非数组时现状 `{ value, hash }`
- [ ] 默认 limit=50,最大 200;offset 超界返回空 items + 原始 total
- [ ] 与 fields/depth 正交(先切片再投影)
- [ ] selftest:read 数组分页;offset 超界;非数组忽略;fields+分页组合
- [ ] 门禁:`npm run test:types` + `npm test`

## 期二 — query/search cursor(P0)

- [ ] `src/core/tools/dataOps.ts`:`query_data`/`search_data` 参数增 `cursor?: string`
- [ ] cursor 编码:base64(JSON `{ sig, offset, limit }`);sig = hash(查询参数)
- [ ] 返回增 `nextCursor?` + `total`;无更多结果时 nextCursor 不返回
- [ ] 查询参数变更 → CURSOR_INVALID
- [ ] selftest:cursor 续查;参数变更失效;无更多结果 nextCursor 缺省
- [ ] 门禁:`npm run test:types` + `npm test`

## 期三 — vfs draft → bind commit(P0)

- [ ] `src/core/backends/vfs.ts`:drafts/ 命名空间分池(独立 LRU,默认 2MB);30min 超时清理;unmount 清理
- [ ] `src/core/tools/dataOps.ts`:新增 `draft_write({ draftId, chunk, append? })` 工具(append 追加 / overwrite 覆盖)
- [ ] `src/core/tools/dataOps.ts`:新增 `draft_commit({ draftId, jsonPath?, merge? })` 工具(整体替换 / 子路径 set / 子路径 merge);schema 校验在 clone 上;失败不污染 bind;成功清理草稿 + 返回 `{ ok, hash, affectedPaths }`
- [ ] selftest:draft_write append/overwrite;draft_commit 整体/子路径 set/merge;校验失败保留草稿;成功清理
- [ ] e2e:inspect().tools 含 draft_write/draft_commit + source=builtin
- [ ] 门禁:`npm run test:types` + `npm test` + `npm run build && npm run test:e2e`

## 期四 — eval_script 子树模式(P1)

- [ ] `src/core/tools/dataOps.ts`:`eval_script` 参数增 `jsonPath?: string`;仅 clone/执行子树
- [ ] mode='query' 只读子树;mode='transform' 返回值 set 到子路径 + schema 校验子树
- [ ] 超时自适应:<100KB 3s;100KB~1MB 8s;>1MB 15s + warn
- [ ] selftest:eval 子树 query/transform;超时自适应;jsonPath 不存在报错
- [ ] 门禁:`npm run test:types` + `npm test`

## 期五 — write 回执增强(P1)

- [ ] `src/core/tools/dataOps.ts`:`write`/`draft_commit` 成功返回 `{ ok, hash, affectedPaths }`(不再 safeStringify 全量)
- [ ] affectedPaths 从 patch jsonPath 提取顶层段去重;≤20 项;超量报数量
- [ ] `src/core/harness/usageHints.ts`:补「write 返回 affectedPaths + hash,按需 read 确认」
- [ ] selftest:write 回执含 affectedPaths;多 patch 去重;超量报数量
- [ ] 门禁:`npm run test:types` + `npm test`

## 期六 — 文档 + 门禁 + 归档

- [ ] `CLAUDE.md`:工具语义更新(read 分页 / cursor / draft / eval 子树 / write 回执);测试矩阵/计数同步
- [ ] `doc/usage-guide.md`:新增 §「大 JSON 分页读 + 分块写」(read offset/limit + cursor + draft_write/commit + eval 子树)
- [ ] `doc/architecture.md`:数据平面改进说明
- [ ] `README.md` / `README.zh-CN.md`:特性列表加「大 JSON 分页 + 分块写」
- [ ] `skills/page-agent-sdk-integrate/references/api.md`:加 draft_write/draft_commit 行;read offset/limit 说明
- [ ] `CHANGELOG.md`:新增条目(标注 write 回执破坏性变更)
- [ ] 门禁全跑:`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports` → `npm run test:types` → `npm run test:size`
- [ ] openspec 归档 + specs 合入
