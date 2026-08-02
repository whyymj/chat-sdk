# Design: unify-context-compression

> 核心约束:**只统一摘要段的格式与合并逻辑,不合并两套压缩机制**。`summarization`(上下文窗口)与 `trimMemoryMessages`(内存 OOM)解决不同问题,保留各自触发;但"什么是摘要段、新旧摘要如何合并"收敛为单一纯函数 `mergeSummarySegments`,消除两处重复的"防丢失"补丁。

## 1. 现状定位:两套压缩 + 两份合并补丁

**`trimMemoryMessages`(`rounds.ts:trimMemoryMessagesImpl`,`afterRound` 调)**:
- 触发:`messages.length > maxMemoryRounds`(默认 50),内存 OOM 兜底。
- 动作:splice messages,产 `【更早对话摘要(N 轮)】` system 消息。
- 防丢失:提取头部已有旧摘要正文(:93-102 `prevSummary`),并入新摘要(:113-116)。

**`summarization`(`summarization.ts` → `useContextManager.compress`,`compressInput` 调)**:
- 触发:上下文 token 超阈值(预设档位),窗口压缩。
- 动作:cutoff-event,产 SystemMessage 注入(**不删原 messages**)。
- 防丢失:CLAUDE.md 记载"compress 现提取头部旧摘要正文并入新摘要的【更早累积摘要】段"(双摘要协同)。

**问题**:同一份"提取头部旧摘要 → 并入新摘要"逻辑在两处各写一遍(`rounds.ts` + `useContextManager.ts`),格式不同(前者 `MEMORY_SUMMARY_PREFIX`,后者裸 SystemMessage + 【更早累积摘要】段)。改一方不自动同步另一方。

## 2. 解法

### 2.1 `SummarySegment` 协议 + `mergeSummarySegments` 纯函数

```ts
// 统一摘要段标记(既有常量,提升为协议入口)
export const MEMORY_SUMMARY_PREFIX = '【更早对话摘要'

export interface SummarySegment {
  /** 摘要正文(不含前缀标记) */
  body: string
  /** 涵盖轮数(供 meta 显示) */
  rounds?: number
}

/**
 * 合并新旧摘要段:prev 为头部已有的累积摘要,current 为本次新产摘要。
 * 返回合并后的 SummarySegment(prev 的 body 在前作"更早",current 在后作"续")。
 * 单一 source of truth:trim 与 summarization 共用,保证累积历史不丢。
 */
export function mergeSummarySegments(current: SummarySegment, prev?: SummarySegment): SummarySegment {
  if (!prev || !prev.body) return current
  return {
    body: `${prev.body}\n【续】\n${current.body}`,
    rounds: (prev.rounds ?? 0) + (current.rounds ?? 0),
  }
}

/** 从一条 system 消息内容解析出 SummarySegment(若是摘要段);否则 null */
export function parseSummarySegment(content: string): SummarySegment | null {
  if (!content.startsWith(MEMORY_SUMMARY_PREFIX)) return null
  const body = content.replace(/^【[^】]*】\n?/, '')
  return { body }
}

/** 把 SummarySegment 渲染为 system 消息内容 */
export function renderSummarySegment(seg: SummarySegment): string {
  const n = seg.rounds ? `(${seg.rounds} 轮,含累积)` : ''
  return `${MEMORY_SUMMARY_PREFIX}${n}】\n${seg.body}`
}
```

### 2.2 两套压缩改调共享函数

**`trimMemoryMessagesImpl`(`rounds.ts:82-124`)改写**:

```ts
// 既有:手写 prevSummary 提取 + 并入
// 改为:parseSummarySegment + mergeSummarySegments + renderSummarySegment
const prevSeg = parseSummarySegment(prevSummary)  // 头部旧摘要
const curSeg = { body: olderDigest, rounds: older.length }
const merged = mergeSummarySegments(curSeg, prevSeg ?? undefined)
const summary: AgentMessage = { role: 'system', content: renderSummarySegment(merged), timestamp: ... }
```

**`summarization` / `useContextManager.compress`** 头部旧摘要合并逻辑同样改调 `mergeSummarySegments` + `renderSummarySegment`(产出统一用 `MEMORY_SUMMARY_PREFIX` 标记,使 `groupRounds` 与互合并能识别)。

### 2.3 单一 source of truth 效果

- "新旧摘要如何合并" = `mergeSummarySegments` 唯一实现;改一处两套受益。
- 摘要段标记统一(`MEMORY_SUMMARY_PREFIX`),`parseSummarySegment` 是唯一解析入口。
- 移除 `rounds.ts:113-116` 与 `useContextManager` 内的重复拼接逻辑。

## 3. 测试策略

### 3.1 selftest 白盒

```ts
// mergeSummarySegments
assert(mergeSummarySegments({body:'新'}).body === '新')                       // 无 prev
assert(mergeSummarySegments({body:'新',rounds:3},{body:'旧',rounds:5}).body === '旧\n【续】\n新')
assert(mergeSummarySegments({body:'新',rounds:3},{body:'旧',rounds:5}).rounds === 8)
// parse / render 往返
const seg = { body: 'x', rounds: 2 }
assert(parseSummarySegment(renderSummarySegment(seg))?.body === 'x')
assert(parseSummarySegment('非摘要内容') === null)
// 现有 trimMemoryMessagesImpl 行为不破坏(产出仍以 MEMORY_SUMMARY_PREFIX 开头、累积合并)
```

### 3.2 e2e

现有压缩相关 e2e 不破坏(产出格式不变,内部逻辑收敛)。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e`(压缩核心改 e2e 验证)+ 断言计数同步。

## 权衡

- **为何不合并两套压缩为单一机制**:它们触发维度不同(上下文 token vs 内存轮数)、动作不同(不删 messages vs splice)。强行合并会把两个正交需求耦死。统一"摘要段协议 + 合并逻辑"已消除重复,是最小代价根治。
- **为何 `mergeSummarySegments` 放纯函数而非中间件方法**:合并是无状态纯逻辑,纯函数易白盒测、可被两套独立调用、无生命周期。中间件方法会绑死到某一侧。
- **为何用 `MEMORY_SUMMARY_PREFIX` 作统一标记**:既有(`rounds.ts:71`),`groupRounds` 已识别(跳过头部摘要 system);`summarization` 也采用此前缀即可复用识别逻辑,无需新标记。
- **为何不引入版本号/结构化 meta**:摘要段对 LLM 是文本,结构化 meta 增加序列化复杂度;`rounds` 作轻量 meta 够用。

## 风险

- **`summarization` 改调共享函数**:压缩是上下文核心,改写需保证产出与原一致(经 e2e + selftest 双向断言)。
- **`groupRounds` 与统一标记的配合**:头部摘要 system 不进 round 的既有行为必须保留(`parseSummarySegment` 依赖此前缀识别);若 `summarization` 此前用裸 SystemMessage,改用前缀后 `groupRounds` 行为变化需验证(预计是正向:头部摘要被正确识别)。
- **refactor-module-extraction 冲突**:contextIndex 抽离与本变更都在 `useContextManager`/`rounds` 区域;建议顺序:refactor 先(搬位置)→ 本变更(统一逻辑),或同期合并。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/utils/rounds.ts` | 新增 `SummarySegment` / `mergeSummarySegments` / `parseSummarySegment` / `renderSummarySegment`;`trimMemoryMessagesImpl` 改调它们 |
| `src/core/composables/useContextManager.ts` / `summarization.ts` | 头部旧摘要合并改调 `mergeSummarySegments`;产出统一用 `MEMORY_SUMMARY_PREFIX` 标记 |
| `src/core/__tests__/modules/`(压缩相关) | `mergeSummarySegments`/`parse`/`render` 白盒 + 现有 trim/compress 断言不破坏 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数同步 |
