# Design: harden-large-json-write(大 JSON 写入链路加固)

> **核心**:修 A1 安全缺陷(draft_commit 乐观锁)+ 3 项性能/鲁棒(A2 快照字节上限 / A3 惰性 hash / B1 draft 中间校验 + B2 淘汰显式化)+ 2 项能力(C1 多草稿合并 / C2 子树 patches)。全增量,默认零行为变化。评审修正:逐行核对写入链。

## 1. 现状核对(证据)

### 1.1 写路径收敛点
- 整体写:`commitSetToBind`(`dataOps.ts:112`)—— set_data(:317)/write(set)(:779)/draft_commit(:886) 共用。校验→快照→merge/替换→audit→onWrite。
- 增量写:`applyPatchesToBind`(`:160`)—— edit_data/write(edit)/eval-patches/eval-subtree 共用。clone→逐 patch 校验→整体校验→快照→落地。

### 1.2 乐观锁覆盖(关键发现)
| 写路径 | handleConflict |
|---|---|
| set_data(:313) / edit_data(:350) / delete_data(:391) | ✅ |
| write 三意图(:742/:759/:777) | ✅ |
| **draft_commit(:875)** | ❌ **直接 commitSetToBind,跳过** |
| restore(:441) / importData / controller.set/update | 特殊(整体回退/替换,语义不同) |

**A1 确认**:draft_commit 是唯一跳过乐观锁的普通写路径。draft 累积跨多轮 LLM 调用,期间外部改动风险高,却静默覆盖。

### 1.3 成本点
- 快照:`maxSnapshots` 默认 20(`:217`),push 全量 `deepClone`(`jsonUtils.ts:69` = JSON.parse(JSON.stringify))。
- hash:`hashValue = cyrb53(safeStringify(v))`(`jsonUtils.ts:159`),read(:297)/写后/冲突(:254) 都全量序列化。
- draft:`existing.content + chunk` 裸拼(:860),无中间校验;drafts 池 2MB 内按 updatedAt 淘汰(`vfs.ts:101-116`),超限删最旧,无显式报错。

### 1.4 能力缺口
- eval 子树 transform(:557)只支持「整体替换子树新值」,不支持 `{patches}`(整树 :565 支持)。
- draft 只能单 draftId 累积→一次 commit,无多草稿合并。

## 2. P0 · A1 draft_commit 乐观锁

```ts
// draft_commit 写前(参照 write set 路径 :777)
const effHash = expectedHash ?? (autoLock ? lastReadHash : undefined)  // 从工具参数补
const conflict = await handleConflict('set', effHash)
if (conflict !== null) return conflict   // 冲突 → 人工介入/报错,不静默覆盖
const r = commitSetToBind({ ... })
```

- `draft_commit` 工具参数加 `expectedHash?`(显式传优先;缺省 autoLock)。
- 冲突返回与 set/edit 一致(触发 pendingConflict 人工介入,或返回 VERSION_CONFLICT)。
- 现有 draft 用户行为变化:仅当「read 后 bind 被改过」才触发,正常流程无感。

## 3. P1 · A2 快照栈字节上限

```ts
// createDataOps 新配置
maxSnapshotBytes?: number  // 默认 2 * 1024 * 1024(2MB)
// pushSnapshot 内联处(commitSetToBind:133 / applyPatchesToBind:202 / restore 等)统一改经闭包 helper
function pushSnapshot(op, label?): void {
  const size = estimateJsonBytes(bindRef)  // 新增估算:JSON.stringify(bindRef).length(粗,或近似)
  if (size > maxSnapshotBytes) {
    // 单次写入就超上限:只保留最近 1 个快照(仍可回退到本次改前)
    while (snapshots.length > 0) snapshots.shift()
    snapshots.push({ id: nextId(), ts: Date.now(), op, value: deepClone(bindRef), label })
    return
  }
  snapshots.push(...)
  while (snapshots.length > maxSnapshots) snapshots.shift()
  // 字节兜底:从最旧起逐删至累计 bytes ≤ maxSnapshotBytes
  let total = snapshots.reduce((s, e) => s + estimateJsonBytes(e.value), 0)
  while (total > maxSnapshotBytes && snapshots.length > 1) {
    total -= estimateJsonBytes(snapshots[0].value); snapshots.shift()
  }
}
```

- **语义**:`maxSnapshots`(数量)与 `maxSnapshotBytes`(字节)双上限;大 JSON 下数量自动收敛到「撑满 2MB 的那几个」。
- 默认 2MB 保守:现有小数据用户不受影响(数量上限先命中)。

## 4. P1 · A3 惰性 hash

```ts
// hashValue 缓存:dirty 时重算,未 dirty 复用
// bind 挂 _hashDirty/_hashCache(不可枚举,与 vfs 脏标记同思路)
export function hashValueCached(bindRef: object): string {
  const cache = (bindRef as any).__hashCache  // WeakMap 或不可枚举属性
  if (cache && !cache.dirty) return cache.value
  const v = cyrb53(safeStringify(bindRef)).toString(36)
  cache = { value: v, dirty: false }
  return v
}
// 写路径(commitSetToBind/applyPatchesToBind 落地后)标 dirty → 下次 read/冲突检测重算
```

- **实现注意**:`__hashCache` 用 `Object.defineProperty`(不可枚举,不进 safeStringify 防污染 hash 自身);或 WeakMap keyed by bindRef。
- **关键防自引用**:cache 本身不能出现在 safeStringify 输出里(否则每次 hash 不同)。用不可枚举属性或 WeakMap 避免。
- 读多写少场景:一次写标脏,后续多次 read 复用 hash;写后惰性重算(写路径本来就要算新 hash 返回,所以写后立即标脏+首次读重算)。

## 5. P1 · B1 draft_write 中间校验

```ts
// draft_write 内(append 后)
function precheckFragment(content: string): { ok: true } | { ok: false; error: string } {
  if (content.length <= FRAGMENT_PARSE_THRESHOLD /* 512K */) {
    try { JSON.parse(content); return { ok: true } } catch (e) { return { ok: false, error: `当前拼接不合法 JSON: ${(e as Error).message}` } }
  }
  // 大 draft 轻量扫描:括号/引号平衡 + 首尾闭合(成本 O(len),远低于 parse)
  return scanBalance(content)
}
```

- 失败返回 `DRAFT_FRAGMENT_INVALID`,草稿保留,LLM 可回退到上个合法 chunk(`draft_write` 加 `mode:'rewind'` 或提示「重 start」)。
- **阈值**:≤512K 全量 parse(准);更大轻量扫描(快)。阈值可配。

## 5b. P1 · A4 子路径 hash 粒度(评审补充)

**问题**:`read({jsonPath})` 当前返回**整体 bind 的 hash**(`dataOps.ts:297`),`handleConflict` 也整体比对(`:254`)。大 JSON 下 LLM 分多次 read 子路径,外部改**未读部分** → 整体 hash 变 → 写已读子路径误冲突。

**方案**:read 子路径返回 `subHash`,写侧支持 `expectedSubHash` 单路径比对。

```ts
// read({jsonPath}) 子路径分支(:288-300)
async ({ jsonPath }) => {
  const jp = jsonPath || ''
  ...
  let val = jp ? getByPath(bindRef, jp) : bindRef
  if (!jp) val = projectBySchema(val, allowKeys)
  const h = hashValue(bindRef)                       // 整体 hash(保留,向后兼容)
  lastReadHash = h
  if (jp) {
    const sub = hashValue(val)                        // 子路径 hash(评审补充)
    return `主数据 @ ${jp} = ${safeStringify(val)} (hash=${h} subHash=${sub})`
  }
  return `主数据 = ${safeStringify(val)} (hash=${h})`
}
```

**写侧 `expectedSubHash`**:
```ts
// handleConflict 增加 scopePath 参数:有 scopePath 则比对子树 hash,否则整体
async function handleConflict(op, expectedHash, agentValue?, scopePath?: string) {
  const curHash = scopePath ? hashValue(getByPath(bindRef, scopePath)) : hashValue(bindRef)
  const expected = scopePath ? expectedSubHash : expectedHash
  if (expected === undefined || expected === '') return null
  if (curHash === expected) return null
  ... // 冲突处理(scopePath 时 agentValue 为该子树)
}
```

- 适用:`write`/`edit_data`/`delete_data`/`draft_commit` 的单 jsonPath 操作(工具参数加 `expectedSubHash?`),冲突比对目标子路径子树 hash。
- **批量 patches 无单一目标路径 → 维持整体 hash**(不适用子路径 hash,`scopePath` 缺省)。
- **边界**:`scopePath` 目标不存在时 `getByPath` 返回 undefined → hashValue(undefined) = 固定值,与「该路径空」状态一致(删除场景可接受)。
- **与 A3(惰性 hash)协同**:子路径 hash 只算 `getByPath` 子树,成本低于整体;A3 的 dirty 缓存对整体 hash 优化,子路径按需算。

## 5c. P1 · A5 round 预算提示(评审补充)

**问题**:`maxToolRounds` 默认 10(`createAgent.ts:185`),`rounds++` 每工具轮递增(`:641`),大 JSON 分块构建(draft_write×N + commit + read 确认 + 调研)易触顶被截断。

**方案:提示 + 文档,不做自动放大**(改默认影响所有用户,违背零行为变化)。

```ts
// usageHints.ts draftWrite 段(:70)
if (rc.draftWrite) hints.push('生成超大 JSON(如 50+ 组件页面)用 draft_write 分块构建 → draft_commit 原子提交…')
// 追加(评审补充):
hints.push('⚠️ 大 JSON 分块构建是典型多轮工具调用(draft_write×N + draft_commit + read 确认 + 调研 read/query),默认 maxToolRounds=10 可能触顶被截断导致草稿写不完。若目标组件数大,请集成方在 createChatSdk 配 maxToolRounds ≥ 20(或按 N+5 估算),否则草稿可能写到一半被 while 截断。')
```

- **不做自动放大**:`createAgent` 的 `DEFAULT_MAX_TOOL_ROUNDS` 是全局硬编码,改动影响所有用户;大 JSON 场景是子集,应集成方按场景显式配。
- 可考虑在 `createChatSdk` 类型注释/文档补 `maxToolRounds` 的大 JSON 建议值(如 `maxToolRounds: 20`)。

## 5d. P1 · A3 与 A4 的关系

- **A3(惰性 hash)**:优化「整体 hash」计算成本(dirty 缓存),读多写少场景省每次全量序列化。
- **A4(子路径 hash)**:修正「hash 粒度」—— 子路径操作不再受整体变化影响,只算目标子树 hash(成本更低)。
- 两者互补:A3 管「整体 hash 怎么算省」,A4 管「单路径操作用哪个 hash 更准」。

## 6. P1 · B2 draft 池淘汰显式化

```ts
// draft_write 写入前
if (content.length > maxDraftBytes /* 默认 1.5MB */) {
  return toolError({ code: 'DRAFT_TOO_LARGE', message: `草稿 "${draftId}" 累计 ${content.length} bytes 超单草稿上限 ${maxDraftBytes}`, hint: '拆分多个 draftId 用 draft_commit({merge}) 合并,或检查 chunk 是否重复追加' })
}
// draft_commit 读时检测被淘汰
if (!entry) {
  return toolError({ code: 'DRAFT_EVICTED', message: `草稿 "${draftId}" 不存在(可能已被 drafts 池 LRU 淘汰)`, hint: '重新 draft_write({mode:"start"}) 从零累积;大草稿可拆多个 draftId 合并' })
}
```

- **语义**:超单草稿上限显式报错,不再静默;池满淘汰被 commit 检测到,不再 append 到空。

## 7. P2 · C1 多草稿合并

```ts
// draft_commit 工具参数加 merge?: string[]
async ({ draftId, merge }) => {
  const ids = merge?.length ? [...merge, draftId] : [draftId]
  const parts = []
  for (const id of ids) {
    const entry = store.files[draftKey(id)]
    if (!entry) return toolError({ code: 'DRAFT_NOT_FOUND', message: `草稿 "${id}" 不存在`, hint: '先 draft_write 累积' })
    try { parts.push(JSON.parse(entry.content)) } catch (e) { return toolError({ code: 'JSON_INVALID', ... }) }
  }
  // merge 语义:目标对象按 key 合并(后覆盖前)/ 数组按顺序拼接 / 其它类型后者覆盖
  const merged = parts.length === 1 ? parts[0] : mergeParts(parts[0], parts[1], ...)
  // 校验 + commit(同现状)+ 清草稿
}
```

- `mergeParts` 纯函数:对象递归 merge(后覆盖前)、数组 concat、标量后覆盖。
- 整体 schema 校验(现状)兜底;合并冲突不逐 key 处理(决策 6)。
- 各草稿仍单 draftId 可单独 commit(向后兼容)。

## 8. P2 · C2 eval 子树 transform 支持 patches

```ts
// 子树模式 transform(:557)
if (jp) {
  const isPatches = result && typeof result === 'object' && !Array.isArray(result) && 'patches' in result
  if (isPatches) {
    // path 相对子树根:把子树 jsonPath 前缀拼到各 patch 的 jsonPath(如 jp="components" → "components.0.text")
    const prefixed = (result as any).patches.map((p: any) => ({ ...p, jsonPath: p.jsonPath ? `${jp}.${p.jsonPath}` : jp }))
    const r = applyPatchesToBind({ bindRef, patches: prefixed, ... })
    ...
  } else {
    // 现状:整体替换子树新值
  }
}
```

- 对齐整树行为;子树内增量改不退化整树(省大 JSON 深拷贝)。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| A1 改动 draft 现有用户 | 仅「read 后 bind 被改过」才触发;正常流程无感 |
| A2 快照字节估算成本 | `estimateJsonBytes` 用近似(如先 `JSON.stringify` 长度),本身 O(n) 但快照场景低频 |
| A3 缓存污染 safeStringify | 不可枚举属性 / WeakMap,防自引用 |
| B1 大 draft parse 成本 | 阈值化:小 parse(准)大轻量扫描(快) |
| B2 默认值误伤大草稿 | maxDraftBytes 默认 1.5MB(drafts 池 2MB 内留余量);可配 |
| C1 merge 冲突语义 | mergeParts 确定性(后覆盖前);整体 schema 校验兜底 |
| C2 子树 patch path 前缀 | 相对子树根,applyPatchesToBind 校验沿用 |

## 10. 关键实现文件

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts` | A1 draft_commit 乐观锁;A2 pushSnapshot 字节上限;A3 写路径标脏;C1 draft_commit merge;C2 eval 子树 patches;draft_write 预检/超限 |
| `src/core/tools/jsonUtils.ts` | `estimateJsonBytes` + `hashValueCached`(或 dataOps 内私有) |
| `src/core/backends/vfs.ts` | (如需)池淘汰细节,若 B2 主要靠 dataOps 层检测则不动 |
| `src/core/types/index.ts` + `types/index.d.ts` | `maxSnapshotBytes`/`maxDraftBytes`/draft_commit merge 参数 |
| `src/core/index.ts` | 若导出 hashValueCached/mergeParts 则同步 |
