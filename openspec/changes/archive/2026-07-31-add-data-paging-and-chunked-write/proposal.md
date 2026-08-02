# Change: add-data-paging-and-chunked-write

> 📦 **已归档(2026-08-02):被 `complex-agent-roadmap` 定位升级重启取代,落地为新 change(见下方 🔄 块)。作溯源底稿保留,不再实施。**

> 🟡 **状态:部分完成(2026-08-01)**
> **结论**:`read` offset/limit 分页 + `eval_script` jsonPath 子树模式 **已并入 `evolve-default-toolset` 落地**(read 多路径/分页 + eval 子树,2026-08-01);`draft_write`/`draft_commit` 分块写(⏸ 仍暂缓,场景存疑)
> **理由**:页面 Agent 典型 JSON 几十~几百 KB,单次 write 可扛,「超大 JSON 单次写不完」真实瓶颈未验证;drafts 池(2.16.0 已分)保持空池占位,不构成必须做 draft_write 的理由。
> **重启触发(draft 部分)**:真实「单次 write 装不下的超大 JSON 生成」场景。
> 决策详情见 [`openspec/deferred.md`](../../deferred.md)。原规划内容保留作底稿,下方不变。

> 🔄 **[2026-08-01 定位升级:重启 draft 部分 —— Phase 2]**
> 定位升级 + 用户真实场景「日常 JSON 100K+,复杂页面几百 K」(见 [`doc/complex-agent-roadmap.md`](../../../doc/complex-agent-roadmap.md)),**draft 部分重启授权**(几百 K 逼近 LLM max_tokens 输出上限,单次整体生成装不下)。
> **调整(去重)**:① **read 分页 + eval 子树已并入 2.17.0**(`evolve-default-toolset`),本 change 只剩 `draft_write`/`draft_commit` 分块构建到 vfs drafts 池再原子 commit;② 默认「高级 opt-in」(`capabilities.draftWrite`,批量/从零生成场景);③ drafts 池(2.16 已分)就绪。
> 落地为新 change `add-draft-write-commit`(Phase 2)。下方旧 🟡 评估保留作溯源。

---

> 数据平面改进(Phase 1 of「复杂任务 + 超大 JSON」演进)。直击两个 P0 阻塞:① 大数组无法分页读 ② 超大 JSON 无法分块写。配套:`add-cross-round-working-memory`(记忆平面)、`add-structured-todos-and-subagent-writes`(编排平面)、`add-complex-preset-and-vfs-json`(体验平面)。四者独立,可任意顺序实施。

## Why

1. **`read` 无数组分页**。大数组(如 `components[0..99]`)只能逐个 `jsonPath` 读或靠 `fields`/`depth` 裁剪,读 100 个元素需 100 次调用或依赖 `query_data` 先定位。LLM token 浪费在重复调用,且易在中途丢失位置。

2. **检索工具有硬上限**。`query_data`/`search_data` 单次最多 200 条,超量需多次查询,无 continuation token / offset,LLM 难表达「从第 201 条继续」。

3. **无分块/流式写入协议**。`write` 的 batch patches 原子性好,但**单次 LLM 输出仍受 token 限制**;超大 JSON(如生成 50 个组件的页面 schema)一次写不完,LLM 只能拆成多次 patch,但无「写入会话」概念,每次 patch 独立校验,中间态可能不合法。

4. **`eval_script` 全量深拷贝**。`deepClone(整个 bind)` 再跑脚本,超大 JSON 有内存/性能压力;3s 超时对复杂聚合偏紧。

5. **write 回执截断**。成功返回 `safeStringify(bind, 600)`,LLM 难确认大结构写入完整性。

## What Changes

### 1. read 数组分页(P0)

- `read` 工具参数增 `offset?: number` + `limit?: number`(仅当 `jsonPath` 指向数组时生效)
- 语义:返回 `{ items, total, offset, limit, hasMore }`;`items` 为切片
- 默认 `limit=50`,最大 `limit=200`;`offset` 超界返回空 items + 原始 total
- 与 `fields`/`depth` 正交(先切片再投影)

### 2. query/search cursor(P0)

- `query_data` / `search_data` 参数增 `cursor?: string`(opaque token,内含 offset + 查询签名)
- 返回增 `nextCursor?: string`(有更多结果时)+ `total`
- `cursor` 不变 + offset 推进;查询参数变更则 cursor 失效(返回 `CURSOR_INVALID`)

### 3. vfs draft → bind commit(P0,分块写入协议)

- 新增 `draft_write({ draftId, chunk, append? })` 工具:在 vfs 内渐进构建 JSON 草稿(支持 append 追加 / overwrite 覆盖)
- 新增 `draft_commit({ draftId, jsonPath?, merge? })` 工具:把 vfs 草稿一次性 schema 校验 + merge 进 bind(支持整体替换或 merge 到子路径)
- `draft_commit` 失败不污染 bind(原子性);成功后自动清理草稿
- 草稿存 vfs `drafts/{draftId}.json`,与 offload 分池(防 LRU 误删)

### 4. eval_script 子树模式(P1)

- `eval_script` 参数增 `jsonPath?: string`:仅 clone/执行子树,降低大 JSON 成本
- `mode: 'query'` 只读子树;`'transform'` 返回值作为子树新值经 schema 校验后落地
- 超时按子树体积自适应(默认 3s,子树 > 100KB 延长至 8s)

### 5. write 回执增强(P1)

- `write` / `draft_commit` 成功返回 `{ ok, hash, affectedPaths: string[] }`(不再 stringify 全量)
- `affectedPaths` 列出本次 patch 实际改动的顶层 path(≤ 20 项,超量只报数量)
- LLM 可基于 `affectedPaths` + `hash` 决定是否 `read` 子路径确认

## Impact

- **改造**:
  - `src/core/tools/dataOps.ts`:`read` 增 offset/limit;`query_data`/`search_data` 增 cursor;`eval_script` 增 jsonPath 子树;`write` 回执改 affectedPaths
  - `src/core/tools/dataOps.ts`:新增 `draft_write` / `draft_commit` 工具
  - `src/core/backends/vfs.ts`:drafts 分池;`draft_write`/`draft_commit` 复用 vfs 存取
- **新增**:5 个工具能力增强 + 2 个新工具(`draft_write`/`draft_commit`)
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 3 条 Requirement(分页读 / cursor / draft commit)
- **向后兼容**:
  - 不传 offset/limit/cursor/jsonPath = 现状行为
  - `draft_write`/`draft_commit` 是新工具,不影响现有 write 流程
  - write 回执从 `safeStringify` 改 `affectedPaths` 是**破坏性变更**(LLM 解析返回值格式变),需在 minor bump 标注
- **测试**:selftest 加分页/cursor/draft/eval子树/回执 断言;e2e 加 inspect().tools 含新工具

## Non-goals

- **不做** 流式 SSE 写入(WebSocket 式实时推送,超出当前 HTTP 工具调用模型)
- **不做** 草稿版本历史/分支(草稿是一次性,commit 后清理;如需版本由 checkpoint 覆盖)
- **不做** 跨 agent 草稿共享(草稿是当前 agent 私有,不进 storage)
- **不做** LLM 自动续写(分块由 LLM 决定,框架只提供 draft_write 原语)
