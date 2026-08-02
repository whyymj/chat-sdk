# Design: add-mission-anchor

> 核心约束:**Mission 是会话级只读锚点,非可变工作记忆**。一经设定(capture 或显式 set),只允许整体替换(`setMission`),不支持增量 patch。压缩/trim 对 mission 段做豁免,但 mission 本身体积小(goal 一句话 + 可选 criteria 数组),不构成上下文压力。capture 用启发式规则,不调 LLM(避免每会话额外 token 开销)。

## 1. 现状定位:三个主线丢失点

**丢失点① HarnessState 无 mission 字段**(`createAgent.ts`):
```ts
// state = { messages, todos, skills, vfs, memory, ... }  // 无 mission
// 每轮 buildSystemPrompt 拼接 middlewares.augmentPrompt,无 mission 段
```
→ 原始 user 指令只在 messages[0] 里,压缩后随 older 轮次被摘要/截断。

**丢失点② 压缩截断首条指令**(`useContextManager.ts:147-189`):
```ts
// indexSummarize: user 截 60 字,assistant 截 80 字
// recallRounds 基于 lastUserQuery(最新 user),非原始 goal
// preserveLastToolResults 默认仅 describe_data/read,不含 mission
```
→ 多轮后「为什么做这个任务」被稀释为模糊摘要;召回偏向最近子问题。

**丢失点③ 子 agent 无 parent context**(`subagent.ts:7-8`):
```ts
// spawn_agent(prompt): prompt 由主 LLM 填写,框架不自动注入 parent goal
// 子 agent 返回 unstructured string,无 synthesis 强制
```
→ 子 agent 不知主线,返回后主 agent 可能忽略/误读/过度展开。

## 2. Mission 数据模型

```ts
interface Mission {
  goal: string                       // 一句话任务目标(必填)
  acceptanceCriteria?: string[]      // 完成标准(可选,集成方显式传入时填)
  sourceMessageIdx: number           // 来源 user 消息 index(自动 capture 时填)
  capturedAt: number                 // capture 时间戳
  explicit: boolean                  // true=集成方显式 setMission;false=自动 capture
}
```

**体积约束**:`goal` 建议单行 < 200 字;`acceptanceCriteria` 建议数组 ≤ 5 项。框架不硬截,但 `augmentPrompt` 注入时若 mission 段超 1000 字符,在 offload 阈值下不外存(mission 必须常驻 system,不外存 vfs)。

## 3. capture 启发式(自动模式)

`createMissionMiddleware` 在 `beforeAgent` 钩子检测:若 `state.mission` 为空且存在未处理的 user 消息,按以下规则判断是否 capture:

```ts
function shouldCapture(text: string): boolean {
  if (!text || text.trim().length < 8) return false           // 太短,疑似问候/确认
  if (/^(你好|hi|hello|ok|好的|继续|嗯|谢谢)/i.test(text.trim())) return false  // 纯社交/确认
  if (text.length > 2000) return false                        // 超长,疑似粘贴文档而非任务
  // 启发式:含动词 + 宾语(「改/加/删/生成/查询/分析...」+ 名词)
  return /(?:改|加|删|生成|查询|分析|创建|修改|配置|实现|检查|对比|整理|转换)/.test(text)
}
```

- capture 取首条满足条件的 user 消息**原文**(不截断,但 `augmentPrompt` 注入时若 > 200 字只取首 200 字 + 省略号)
- `explicit: false` 标记自动 capture;集成方 `setMission` 后 `explicit: true` 且覆盖自动 capture
- **不调 LLM**:纯规则判断,零 token 开销

**边界**:若首条 user 是「你好,帮我做个页面」——「帮我做个页面」含动词「做」但不在白名单 → 不 capture;第二条 user「把标题改成红色」含「改」→ capture 第二条。集成方可用 `send(text, { mission: '...' })` 显式指定避免误判。

## 4. 中间件装载与 prompt 注入

**装载序**(在 `createChatSdk` 的 middlewares 数组,usageHints 之后、todos 之前):
```
dataHint → usageHints → mission → todos → skills → vfs → summarization
→ memory → permissions → ... → subagent → ... → augmentSystem → user middleware
```

**augmentPrompt 注入段**:
```ts
augmentPrompt: (state) => {
  if (!state.mission) return undefined
  const lines = [`## 当前主线目标`, state.mission.goal]
  if (state.mission.acceptanceCriteria?.length) {
    lines.push(`完成标准:`)
    state.mission.acceptanceCriteria.forEach((c, i) => lines.push(`${i + 1}. ${c}`))
  }
  lines.push(`(每步操作应服务此目标;偏离时回到主线)`)
  return lines.join('\n')
}
```

**永不压缩**:`summarization.compressInput` 钩子识别 mission 段(由 mission 中间件在 `beforeAgent` 写入 `state.mission`),compress 时:
- mission 段不进 `older` 分区
- mission 段不进 `indexSummarize`
- mission 段作为独立 pin 段始终保留在 system(经 `augmentPrompt` 每轮重建)

**trimMemoryMessages 豁免**:mission 段标记为 `__pinned: true`(不可枚举属性),`trimMemoryMessages` 跳过。

## 5. recallRounds dual-query

当前 `recallRounds(messages, query, topK=3)` 基于 `query`(最新 user)。改为:

```ts
function recallRoundsDual(messages, mission, lastUserQuery, topK=3) {
  const byGoal = mission ? recallRounds(messages, mission.goal, topK) : []
  const byLast = recallRounds(messages, lastUserQuery, topK)
  // 合并去重(按 message index),保留 topK
  return dedupeByIndex([...byGoal, ...byLast]).slice(0, topK)
}
```

→ 多轮 follow-up 后,既能召回与最近子问题相关的早期轮次,也能召回与原始目标相关的早期轮次。

## 6. spawn prepend parent mission

`subagent` 中间件 `wrapToolCall` 钩子拦截 `spawn_agent` / `spawn_agents` / `use_<id>`:

```ts
wrapToolCall: async ({ tool, args, run }) => {
  if (isSpawnTool(tool) && state.mission) {
    const parentGoalBlock = [
      `【父任务目标】${state.mission.goal}`,
      state.mission.acceptanceCriteria?.length
        ? `【完成标准】\n${state.mission.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        : '',
      `【本子任务范围】${args.prompt}`,
    ].filter(Boolean).join('\n\n')
    args = { ...args, prompt: parentGoalBlock }
  }
  return run(args)
}
```

→ 子 agent 首轮 system/user 即知 parent goal,避免越钻越深偏离主线。

**结构化返回(可选,向后兼容)**:子 agent 返回若为合法 JSON 且含 `conclusion` 字段,框架解析为结构化;否则按纯文本处理。主 agent 收到后,`usageHints` 规则引导:「spawn 返回后先 synthesis(对照主线目标)再下一步」。

## 7. SDK API

```ts
// createChatSdk 返回对象
getMission(): Mission | undefined
setMission(mission: Partial<Mission>): void  // 合并更新;传 { goal } 重设;传 {} 清空

// send 支持 mission 参数
send(text: string, options?: { mission?: Partial<Mission> }): Promise<...>

// inspect
inspect().mission: Mission | undefined

// capabilities
capabilities.missionAnchor?: boolean  // 默认 true
```

**setMission 语义**:
- `setMission({ goal: '新目标' })` → 替换 goal,保留 criteria
- `setMission({ goal: '新目标', acceptanceCriteria: ['...'] })` → 整体替换
- `setMission({})` → 清空 mission(回到无锚点)
- `setMission` 后 `infoTick++` 触发 inspect 刷新

## 8. capabilities.missionAnchor 开关

- `true`(默认):装载 mission 中间件;自动 capture;每轮注入 pin 段
- `false`:不装载 mission 中间件;`HarnessState.mission` 恒为 undefined;`getMission` 返回 undefined;`setMission` warn 不抛错;行为完全同现状(零开销)

## 9. 与现有机制的兼容性

| 现有机制 | 兼容性 |
|---|---|
| `memory` 中间件 | 并存:memory 是静态集成方知识,mission 是会话级目标;两段并列注入 system |
| `todos` 中间件 | 并存:todos 是 LLM 自写步骤,mission 是框架锚定目标;mission 段在 todos 段之前 |
| `summarization` | 增强:mission 段豁免;recall dual-query;不破坏现有 compress 流程 |
| `subagent` | 增强:spawn prepend;不破坏现有 spawn 协议(纯 prepend,不改返回契约) |
| `verify` | 不变:本变更不动 verify(Phase 4 才做 goal verify) |
| `checkpoint` | 不变:mission 不进 checkpoint 快照(会话级,不持久化) |

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| capture 启发式误判(把非任务当任务) | ① `explicit: false` 标记,集成方可 `setMission` 覆盖;② `capabilities.missionAnchor: false` 完全关闭;③ 启发式偏保守(白名单动词),宁可漏 capture 不可误 capture |
| mission 段占 system 空间 | goal 一句话 + criteria ≤ 5 项,典型 < 500 字符;远小于 offload 阈值 |
| 子 agent prepend 增加 prompt 体积 | parent goal block 典型 < 300 字符;子 agent maxToolRounds=6 内可忽略 |
| dual-query 召回重复 | `dedupeByIndex` 去重;topK 不变(3),只改召回来源 |
| 结构化返回解析失败 | try/catch 降级为纯文本;不破坏现有 spawn 返回契约 |
