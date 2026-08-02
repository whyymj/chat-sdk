# Design: revive-mission-anchor(Phase 1)

> Phase 1 最小版:capture + pin 段 + 压缩豁免 + API。**不做** recall dual-query / spawn prepend(后续 Phase)。旧完整 design 在 [`../2026-07-31-add-mission-anchor/design.md`](../2026-07-31-add-mission-anchor/design.md)。
> 核心约束:**Mission 是会话级只读锚点**(一经设定只允许 `setMission` 整体替换,无增量 patch);体积小(goal 一句话 + criteria ≤5),常驻 system 不外存;capture 纯启发式不调 LLM(零 token)。

## 1. Mission 数据模型

```ts
interface Mission {
  goal: string                       // 一句话任务目标(必填)
  acceptanceCriteria?: string[]      // 完成标准(可选,集成方显式传入时填)
  sourceMessageIdx: number           // 来源 user 消息 index(自动 capture 时填)
  capturedAt: number                 // capture 时间戳
  explicit: boolean                  // true=集成方显式 setMission;false=自动 capture
}
```
体积约束:goal 单行 <200 字;criteria ≤5 项;框架不硬截。

## 2. capture 启发式(纯规则,不调 LLM)

```ts
function shouldCapture(text: string): boolean {
  if (!text || text.trim().length < 8) return false           // 太短(问候/确认)
  if (/^(你好|hi|hello|ok|好的|继续|嗯|谢谢)/i.test(text.trim())) return false  // 纯社交
  if (text.length > 2000) return false                        // 超长(疑似粘贴文档)
  return /(?:改|加|删|生成|查询|分析|创建|修改|配置|实现|检查|对比|整理|转换|设计|搭建|编排)/.test(text)
}
```
- 取首条满足条件的 user **原文**(不截;`augmentPrompt` 注入时 >200 字取首 200 + 省略号)
- `explicit:false`;`setMission` 后 `explicit:true` 覆盖自动 capture
- 偏保守:宁可漏 capture(集成方 setMission 兜底)

## 3. 中间件装载 + pin 段注入

装载序(在 todos 之前,pin 段在 todos 段之前):
```
dataHint → usageHints → mission → todos → skills → vfs → summarization → ...
```
```ts
augmentPrompt: (state) => {
  if (!state.mission) return undefined
  const lines = ['## 当前主线目标', state.mission.goal]
  if (state.mission.acceptanceCriteria?.length) {
    lines.push('完成标准:')
    state.mission.acceptanceCriteria.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  }
  lines.push('(每步操作应服务此目标;偏离时回到主线)')
  return lines.join('\n')
}
```

## 4. 压缩豁免

`summarization.compressInput`:mission 段(由 mission 中间件 `beforeAgent` 写入 `state.mission`)compress 时:
- 不进 `older` 分区
- 不进 `indexSummarize`
- 作独立 pin 段始终保留 system(经 `augmentPrompt` 每轮重建)

→ 压缩不稀释 mission;LLM 每轮看到完整原始目标。

## 5. SDK API

```ts
getMission(): Mission | undefined
setMission(mission: Partial<Mission>): void  // 合并:传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空
send(text, options?: { mission?: Partial<Mission> }): Promise<...>
inspect().mission: Mission | undefined
capabilities.missionAnchor?: boolean  // 默认 true(分层默认核心)
```
- `capabilities.missionAnchor:false` → 不装 mission 中间件;`getMission` 返 undefined;`setMission` warn 不抛;行同现状
- `setMission` 后 `infoTick++` 触发 inspect 刷新

## 6. 兼容性

| 现有机制 | 关系 |
|---|---|
| `memory` 中间件 | 并存:memory 静态集成方知识,mission 会话级目标;两段并列 |
| `todos` 中间件 | 并存:mission 管目标,todos 管步骤;mission 段在 todos 段前 |
| `summarization` | 增强:mission 段豁免;不破坏 compress 流程 |
| `checkpoint` | 不变:mission 不进 checkpoint(会话级,不持久化) |
| `adaptive-planning` | 正交:planning 管步骤拆解,mission 管目标锚定 |

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| capture 启发式误判 | `explicit:false` 标记 + `setMission` 覆盖 + `capabilities.missionAnchor:false` 关 + 启发式偏保守(白名单动词,宁漏不误) |
| mission 段占 system | goal 一句话 + criteria ≤5,典型 <500 字符;远小于 offload 阈值 |
| 默认开影响轻量使用者 | 分层默认核心:轻量场景 capture 保守(简单任务不触发);`missionAnchor:false` 可关 |
