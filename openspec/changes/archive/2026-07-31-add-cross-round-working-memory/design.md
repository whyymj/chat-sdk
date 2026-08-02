# Design: add-cross-round-working-memory

> 核心约束:**工作记忆是框架自动维护的会话级状态,非 LLM 可写**。LLM 只读 `## 工作记忆` 段,不可直接修改(防 LLM 伪造记忆)。提取用纯规则,不调 LLM(零 token 开销)。与 mission-anchor 互补:mission 管「为什么」,working memory 管「做到了什么」。

## 1. WorkingMemory 数据模型

```ts
interface WorkingMemory {
  locatedPaths: string[]      // 已检索/读过的 path(去重,≤ 50 项)
  lastHash?: string            // 最近一次 read 的整体 hash(autoLock 用)
  draftVfsPath?: string        // 当前活跃 draft 的 vfs 路径(分块写时)
  notes: string[]              // 关键中间结论(LLM 经工具写入,≤ 20 项)
  updatedAt: number
}
```

**体积约束**:`locatedPaths` ≤ 50 项(超量 LRU 淘汰最旧);`notes` ≤ 20 项(超量淘汰最旧)。典型体积 < 800 字符,远小于 offload 阈值。

## 2. 中间件装载与提取

**装载序**(在 mission 之后、todos 之前):
```
dataHint → usageHints → mission → workingMemory → todos → skills → vfs → summarization
→ memory → ... → subagent → ...
```

**afterToolCall 提取规则**(`workingMemory.ts`):
```ts
afterToolCall: async ({ tool, result, state }) => {
  if (!state.workingMemory) return
  const wm = state.workingMemory

  if (tool.name === 'read') {
    // 提取 jsonPath + hash
    if (result?.hash) wm.lastHash = result.hash
    if (result?.path) addUnique(wm.locatedPaths, result.path)
  }
  if (tool.name === 'query_data' || tool.name === 'search_data') {
    // 提取匹配项的 path
    result?.matches?.forEach(m => addUnique(wm.locatedPaths, m.path))
  }
  if (tool.name === 'draft_write') {
    // 记录草稿 vfs 路径
    wm.draftVfsPath = `drafts/${result?.draftId}.json`
  }
  if (tool.name === 'draft_commit') {
    // commit 后清除草稿引用
    wm.draftVfsPath = undefined
  }
  wm.updatedAt = Date.now()
}
```

**notes 写入**:LLM 无法直接写 notes(防伪造);notes 由框架从 `write` 成功回执的 `affectedPaths` 自动追加(如 `notes.push('已修改 components.3.style.color')`)。

## 3. augmentPrompt 注入

```ts
augmentPrompt: (state) => {
  const wm = state.workingMemory
  if (!wm || (!wm.locatedPaths.length && !wm.lastHash && !wm.draftVfsPath && !wm.notes.length)) return undefined
  const lines = ['## 工作记忆(跨轮保留,勿重复检索)']
  if (wm.locatedPaths.length) lines.push(`已检索路径:${wm.locatedPaths.join(', ')}`)
  if (wm.lastHash) lines.push(`当前数据 hash:${wm.lastHash}(write 时自动校验)`)
  if (wm.draftVfsPath) lines.push(`活跃草稿:${wm.draftVfsPath}(draft_commit 提交)`)
  if (wm.notes.length) lines.push(`已完成:${wm.notes.join('; ')}`)
  return lines.join('\n')
}
```

**永不压缩**:`compressInput` 豁免 workingMemory 段(同 mission 段处理)。

## 4. preserveLastToolResults 默认扩展

**当前**:`['describe_data','read']`

**改为**:`['describe_data','read','query_data','search_data']`

**preserve 内容**:工具 result 的摘要片段(path + 关键字段,非全量)。`query_data`/`search_data` preserve 匹配项的 path 列表(≤ 20 项),不含完整 value。

**集成方覆盖**:`contextOptions.preserveLastToolResults: [...]` 显式配置时,完全覆盖默认(不合并)。

## 5. 压缩注入活跃 vfs 索引

**`summarization.compressInput`**:
```ts
compressInput: (state) => {
  // ... 现有压缩逻辑 ...
  const vfsFiles = state.vfs?.list?.() || []
  const largeResults = vfsFiles.filter(f => f.path.startsWith('large_results/'))
  const drafts = vfsFiles.filter(f => f.path.startsWith('drafts/'))
  if (largeResults.length || drafts.length) {
    summaryParts.push('【外存文件】')
    largeResults.forEach(f => summaryParts.push(`  ${f.path}(${f.size}B)`))
    drafts.forEach(f => summaryParts.push(`  ${f.path}(${f.size}B)`))
    summaryParts.push('按需 vfs_read/vfs_grep 回读')
  }
  // ...
}
```

## 6. recallRounds 三路召回

```ts
function recallRoundsTriple(messages, mission, workingMemory, lastUserQuery, topK=3) {
  const byGoal = mission ? recallRounds(messages, mission.goal, topK) : []
  const byLast = recallRounds(messages, lastUserQuery, topK)
  const byWm = workingMemory?.locatedPaths?.length
    ? recallRounds(messages, workingMemory.locatedPaths.slice(-5).join(' '), topK)
    : []
  return dedupeByIndex([...byGoal, ...byLast, ...byWm]).slice(0, topK)
}
```

## 7. hash 跨压缩持久

**autoLock 优先级**(`dataOps.ts` write 工具):
```ts
const expectedHash = args.expectedHash
  ?? state.workingMemory?.lastHash    // 优先取工作记忆
  ?? lastReadHash                     // fallback 进程内变量
// 不传 expectedHash + 两者都无 → 不校验(现状)
```

→ 跨轮压缩后,只要 `workingMemory.lastHash` 存在,write 仍能 autoLock 校验。

## 8. capabilities.workingMemory 开关

- `true`(默认):装载 workingMemory 中间件;自动提取;每轮注入
- `false`:不装载;`HarnessState.workingMemory` 恒 undefined;autoLock fallback 进程内变量;行为同现状

## 9. 与 mission-anchor 的协同

| 维度 | mission-anchor | 本变更 |
|---|---|---|
| 管什么 | 原始目标(goal + criteria) | 中间态(locatedPaths + lastHash + notes) |
| 谁写 | 集成方/自动 capture | 框架自动提取(LLM 不可写) |
| 压缩豁免 | 是 | 是 |
| recall 召回 | dual-query(goal + lastUser) | 三路(goal + lastUser + locatedPaths) |
| 装载序 | mission 中间件 | workingMemory 中间件(mission 之后) |

两者可独立实施;同时装载时,recall 自动三路(mission-anchor 的 dual-query 升级为本变更三路)。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| locatedPaths 累积过多 | ≤ 50 项 LRU 淘汰;典型任务远不超 |
| notes 语义混乱 | notes 由框架从 write 回执自动生成,非 LLM 自写;格式统一「已修改 {path}」 |
| workingMemory 段占 system | 典型 < 800 字符;远小于 offload 阈值 |
| 三路召回重复 | dedupeByIndex 去重;topK 不变 |
| hash 过期(数据被外部改) | autoLock 仍校验;hash 不匹配触发 VERSION_CONFLICT(现状) |
