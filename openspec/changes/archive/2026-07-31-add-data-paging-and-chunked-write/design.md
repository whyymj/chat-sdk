# Design: add-data-paging-and-chunked-write

> 核心约束:**分页/cursor 是只读增强,零破坏**;**draft→commit 是新增工具,不改现有 write**;**eval 子树是参数扩展,默认行为同现状**。所有改动向后兼容,不传新参数 = 现状行为。

## 1. read 数组分页

**参数扩展**(`dataOps.ts` read 工具):
```ts
read({ jsonPath?, fields?, depth?, offset?, limit? })
```
- `offset`/`limit` 仅当 `jsonPath` 解析到的值是数组时生效;非数组忽略(不报错)
- 默认 `limit=50`(不传 offset/limit 时,行为同现状:返回全量)
- 最大 `limit=200`;超限截断为 200 + warn
- `offset` 超界:返回 `{ items: [], total, offset, limit, hasMore: false }`

**返回结构**:
```ts
// 数组分页时
{ items: any[], total: number, offset: number, limit: number, hasMore: boolean, hash: string }
// 非数组(现状)
{ value: any, hash: string }
```

**与 fields/depth 正交**:先按 offset/limit 切片,再对每个 item 应用 fields 投影 / depth 截断。

## 2. query/search cursor

**cursor 编码**(opaque token):
```ts
// cursor = base64(JSON.stringify({ sig, offset, limit }))
// sig = hash(query + jsonPath + mode)  // 查询签名,参数变更则失效
```

**流程**:
- 首次查询:不传 cursor,返回 `{ results, total, nextCursor? }`;`nextCursor` 含 offset=limit
- 续查:传 `cursor`,框架校验 `sig` 匹配当前查询参数,推进 offset,返回下一批 + 新 `nextCursor`
- 查询参数变更(如改 jsonPath/search term):cursor `sig` 不匹配 → `CURSOR_INVALID` 错误
- 无更多结果:`nextCursor` 不返回(或为 null)

**limit 语义**:cursor 模式下 limit 默认沿用首次查询的 limit;不传 limit 时默认 50,最大 200。

## 3. vfs draft → bind commit

**draft_write 工具**:
```ts
draft_write({ draftId: string, chunk: string, append?: boolean })
// append=true: 追加 chunk 到草稿末尾(构建大 JSON 时多次调用)
// append=false/省略: 覆盖草稿(首次写或重写)
// chunk 是 JSON 字符串片段(不要求每次合法 JSON,commit 时整体校验)
```

**draft_commit 工具**:
```ts
draft_commit({ draftId: string, jsonPath?: string, merge?: boolean })
// jsonPath 省略:整体替换 bind(经 schema 校验)
// jsonPath 指定 + merge=true: 把草稿 merge 到子路径
// jsonPath 指定 + merge=false: 把草稿 set 到子路径
// 校验失败:不污染 bind,返回 SCHEMA_INVALID + 草稿保留(可继续 draft_write 修正)
// 成功:自动清理草稿 + 返回 { ok, hash, affectedPaths }
```

**vfs 存储分池**(`vfs.ts`):
```ts
// drafts/ 命名空间:存草稿(draft_write 写入)
// large_results/ 命名空间:存 offload 大结果(现有)
// 两个池独立 LRU,drafts 池默认 2MB,large_results 池默认 4MB
// 防 offload 大结果挤掉进行中草稿
```

**草稿生命周期**:
- `draft_write` 创建/更新草稿
- `draft_commit` 成功后自动删除草稿
- `draft_commit` 失败草稿保留(可修正后重 commit)
- agent 会话结束(unmount)时清理所有草稿
- 草稿超时(30min 无操作)自动清理

## 4. eval_script 子树模式

**参数扩展**:
```ts
eval_script({ script, mode?, jsonPath? })
// jsonPath 省略:现状(全量 clone + 执行)
// jsonPath 指定:仅 clone/执行子树
```

**子树 clone**:
```ts
const subtree = jsonPath ? getByPath(bind, jsonPath) : bind
const cloned = deepClone(subtree)  // 只 clone 子树,降低成本
const result = runInSandbox(cloned, script)
// mode='query': 返回 result
// mode='transform': setByPath(bind, jsonPath, result) + schema 校验子树
```

**超时自适应**:
- 子树体积 < 100KB:默认 3s(现状)
- 子树体积 100KB~1MB:延长至 8s
- 子树体积 > 1MB:延长至 15s + warn(超大子树)

## 5. write 回执增强

**当前**:`safeStringify(bind, 600)`(截断全量预览)

**改为**:
```ts
{
  ok: true,
  hash: string,                    // 整体 hash(乐观锁)
  affectedPaths: string[],         // 本次 patch 实际改动的顶层 path
  // ≤ 20 项;超量返回 ['__more__', String(count)] 形式
}
```

**affectedPaths 计算**:从 patch 的 `jsonPath` 提取顶层段(如 `components.3.style.color` → `components`),去重。

**LLM 确认策略**:基于 `affectedPaths` + `hash`,LLM 可选择性 `read({ jsonPath: affectedPath })` 确认,而非读全量。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| read 分页返回结构变(数组 vs 非数组) | 同一工具按 jsonPath 解析结果类型分支;LLM 按返回字段判断 |
| cursor 解码失败/篡改 | sig 校验 + base64 仅编码不加密(防误用,非防攻击) |
| draft 草稿累积占 vfs | 30min 超时清理 + commit 成功即删 + 分池独立 LRU |
| draft_commit 大 JSON schema 校验慢 | 校验在 clone 上跑(不污染 bind);超时由 schema 复杂度决定,框架不额外限制 |
| write 回执破坏性变更 | minor bump 标注;usageHints 补「write 返回 affectedPaths + hash,按需 read 确认」 |
| eval 子树超时延长影响整体 | 仅子树模式延长;全量模式保持 3s |
