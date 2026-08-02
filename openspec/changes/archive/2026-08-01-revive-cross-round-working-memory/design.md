# Design: revive-cross-round-working-memory(Phase 1)

> **解绑 C 组**(不依赖 draft/mission)→ 独立中间件。**只 pin 关键态**(path/hash,非全量)→ 控 context。不做 notes(自由文本易膨胀)。

## 1. workingMemory 状态

```ts
interface WorkingMemory {
  locatedPaths: string[]                    // 最近定位的 jsonPath(LRU 去重,≤10)
  lastHashes: Record<string, string>        // 最近 read 的 path→hash(LRU,≤10 项)
}
```
体积:每项 path 几十字 + hash 几十字,≤10 项,典型 **<1KB**。远小于 offload 阈值,常驻 system 不外存。

## 2. 自动捕获(afterToolCall,不调 LLM)

`wrapToolCall` 的 `afterToolCall`(或 `wrapToolCall` next 后)拦截 `read`/`query`/`search` 工具结果:

**实现选项**(apply 时定,倾向 a):
- **a. 从 ToolExecResult.content 提取**:工具结果文本已含 `path=`/`hash=` 标记(read 返回末尾 `hash=xxx`;query 返回 path/index)→ 正则提取,结构化入 workingMemory。零工具改动。
- **b. dataOps controller 暴露**:dataOps controller 增 `lastPath`/`lastHash` getter,中间件读。更可靠但耦合 dataOps。

捕获规则:
- `read`/`query`/`search` 结果 → 提取 path 进 `locatedPaths`(LRU 去重,超 10 淘汰最旧)
- `read` 结果 → 提取 hash 进 `lastHashes[path]`(LRU,超 10 淘汰)
- 其他工具不捕获

## 3. 压缩豁免

`summarization.compressInput`:workingMemory 段(由中间件 `beforeAgent` 写 `state.workingMemory`)compress 时:
- 不进 `older` 分区
- 不进 `indexSummarize`
- 作独立 pin 段常驻 system(经 `augmentPrompt` 每轮重建)

→ 跨压缩保留 path/hash,LLM 不重复检索 + 写时用对 hash(避免乐观锁误冲突)。

## 4. augmentPrompt 注入

```ts
augmentPrompt: (state) => {
  const wm = state.workingMemory
  if (!wm || (!wm.locatedPaths.length && !Object.keys(wm.lastHashes).length)) return undefined
  const lines = ['## 工作记忆(跨压缩保留,勿重复检索)']
  if (wm.locatedPaths.length) lines.push('最近定位:' + wm.locatedPaths.join(', '))
  if (Object.keys(wm.lastHashes).length) {
    lines.push('最近 hash:' + Object.entries(wm.lastHashes).map(([p, h]) => `${p}=${h.slice(0, 8)}`).join(', '))
  }
  return lines.join('\n')
}
```

## 5. 中间件装载序

```
dataHint → usageHints → mission → todos → skills → vfs → summarization → workingMemory → ...
```
workingMemory 装载在 summarization 之后(它读 state.workingMemory 做豁免,需 workingMemory beforeAgent 先写)。augmentPrompt 段在 todos/skills 段之后。

## 6. 与现有机制

| 机制 | 关系 |
|---|---|
| `preserveLastToolResults` | **互补**:preserve 保工具结果摘要片段(防字段描述丢);workingMemory 保 path/hash 结构化(防定位丢)。complex 预设已扩 preserve 含 query/search,与本互补不冲突 |
| `summarization` | 增强:workingMemory 段豁免 |
| `mission` | 正交:mission 管目标,workingMemory 管中间态;两者都豁免压缩,并存 |
| 乐观锁 `autoLock` | 增强:workingMemory 保 lastHashes,LLM 跨压缩后仍能用对 hash(减少误冲突) |

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| workingMemory 占 context | 只 pin 关键(path/hash),≤10 LRU,典型 <1KB;不做 notes(易膨胀) |
| 自动捕获误纳 | 只捕获 read/query/search(定位类);其他工具不纳 |
| content 提取不准(选项 a) | 工具结果 path=/hash= 标记格式稳定(read 返回结构化);提取失败静默跳过 |
| 默认开影响轻量 | 分层默认核心:轻量场景 read 少,locatedPaths 增长慢;<1KB 可忽略;`workingMemory:false` 可关 |
