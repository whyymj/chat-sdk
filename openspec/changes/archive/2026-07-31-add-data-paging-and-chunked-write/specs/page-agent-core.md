# Spec Delta: page-agent-core

> 本文件为 `add-data-paging-and-chunked-write` 变更对 `openspec/specs/page-agent-core.md` 的增量。归档时合入主规范。

## Requirement: read 工具支持数组分页

`read` 工具支持 `offset`/`limit` 参数,仅当 `jsonPath` 解析到的值为数组时生效。返回 `{ items, total, offset, limit, hasMore, hash }`;非数组时返回现状 `{ value, hash }`。默认 `limit=50`,最大 `limit=200`;`offset` 超界返回空 items + 原始 total。分页与 `fields`/`depth` 正交(先切片再投影)。不传 offset/limit 时行为同现状(返回全量)。

## Requirement: 检索工具支持 cursor 续查

`query_data`/`search_data` 支持 `cursor` 参数(opaque token,内含 offset + 查询签名)。返回增 `nextCursor?` + `total`;有更多结果时返回 `nextCursor`,无则缺省。查询参数变更(如改 jsonPath/search term)导致 cursor 签名不匹配时返回 `CURSOR_INVALID` 错误。cursor 模式下 limit 默认沿用首次查询的 limit,不传时默认 50,最大 200。

## Requirement: 草稿分块写入与提交

系统提供 `draft_write({ draftId, chunk, append? })` 工具在 vfs 内渐进构建 JSON 草稿(append 追加 / overwrite 覆盖),与 `draft_commit({ draftId, jsonPath?, merge? })` 工具一次性 schema 校验 + merge 进 bind。`draft_commit` 校验在 clone 上执行,失败不污染 bind(草稿保留可修正),成功后自动清理草稿并返回 `{ ok, hash, affectedPaths }`。草稿存 vfs `drafts/` 命名空间,与 `large_results/` 分池独立 LRU(防 offload 大结果挤掉进行中草稿),30min 超时清理,unmount 时清理所有草稿。

## Requirement: eval_script 支持子树模式

`eval_script` 支持 `jsonPath` 参数,仅 clone/执行子树(降低大 JSON 成本)。`mode:'query'` 只读子树;`'transform'` 返回值作为子树新值经 schema 校验后落地。超时按子树体积自适应(<100KB 3s;100KB~1MB 8s;>1MB 15s + warn)。不传 jsonPath 时行为同现状(全量 clone + 执行)。

## Requirement: write 回执返回 affectedPaths

`write`/`draft_commit` 成功返回 `{ ok, hash, affectedPaths }`,其中 `affectedPaths` 为本次 patch 实际改动的顶层 path 去重列表(≤20 项,超量报数量),不再 stringify 全量预览。LLM 可基于 `affectedPaths` + `hash` 选择性 `read` 子路径确认。
