# Design: harden-react-loop-budget

> 核心约束:**回归 `rounds` 的"工具轮"语义,加 `iterations` 硬上限防死循环**。自纠(format/verify)本就有独立预算(`formatRetries`/`verifyAttempts`),让它们不再额外消耗 `rounds`;但自纠会 continue 回循环顶再调 LLM,故必须加总迭代上限防"自纠无限循环耗尽资源"。兜底文案只改措辞,不动触发逻辑。

## 1. 现状定位

**`createAgent.stream()` 循环(:388-475)** —— `rounds` 三处自增:

```ts
while (rounds < maxToolRounds) {
  // ... 模型调用 ...
  if (!response.toolCalls.length) {
    if (formatRetries < maxFormatRetries && detectGarbledToolCall(...)) {
      formatRetries += 1
      rounds += 1; continue        // ❌ 格式自纠耗工具轮预算
    }
    if (maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts) {
      const feedback = await runBeforeReturn(...)
      if (feedback) {
        state.verifyAttempts += 1
        rounds += 1; continue      // ❌ verify 自纠耗工具轮预算
      }
    }
    return content
  }
  // ... 工具执行 ...
  rounds++                         // ✅ 真实工具轮
}
```

**问题**:`maxToolRounds` 名为"工具轮上限",但自纠轮(无 tool_calls)也消耗它。`maxToolRounds:3` 时,1 次 verify 自纠 + 2 次工具即耗尽 → 工具能力被截断。

**兜底文案(:512)**:`'已达到最大工具调用轮次，请简化你的问题。'` —— 工具已做大量操作,文案却让用户"简化",体验差。

## 2. 解法

### 2.1 双计数

```ts
let rounds = 0          // 工具轮(只在有 tool_calls 执行后 +1)
let iterations = 0      // 总循环(每次 while +1,防死循环硬上限)
const maxIterations = options.maxIterations ?? Math.max(maxToolRounds * 3, 30)

while (rounds < maxToolRounds && iterations < maxIterations) {
  iterations++
  if (signal?.aborted) break
  onEvent({ type: 'round_start', round: rounds + 1 })
  // ... beforeModel / 模型调用 / afterModel ...
  if (!response.toolCalls.length) {
    if (formatRetries < maxFormatRetries && detectGarbledToolCall(...)) {
      formatRetries += 1
      continue                      // ✅ 不增 rounds
    }
    if (maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts) {
      const feedback = await runBeforeReturn(...)
      if (feedback) { state.verifyAttempts += 1; continue }  // ✅ 不增 rounds
    }
    return content
  }
  // ... 工具执行 ...
  rounds++                           // ✅ 真实工具轮
}
// 循环退出:工具轮耗尽(rounds>=maxToolRounds)或迭代触顶(iterations>=maxIterations)
```

**为何 `maxIterations = max(maxToolRounds*3, 30)`**:
- 工具轮 `maxToolRounds`(默认 10)+ 每轮可能的自纠(format 2 + verify `maxAttempts` 默认 2)= 最坏 ~4× 工具轮 → `*3` 留余量。
- 下限 30:小 `maxToolRounds`(如 3)时仍给自纠合理空间(3×3=9 太小)。
- 自纠本身有界(`formatRetries<=2`、`verifyAttempts<maxVerifyAttempts`),`maxIterations` 是双保险,正常不会触顶。

### 2.2 兜底文案

```ts
// :512 改为(末尾 ToolMessage 收口失败的极端路径)
const fallback = '我已完成本轮能做的操作,但未能综合出最终结论。请基于上方已完成的工具操作结果继续,或告诉我下一步重点。'
```

保留 `lastFinalContent`(:482)与 ToolMessage 收口(:489)的优先返回,文案只在最末端触发。

## 3. 测试策略

### 3.1 selftest

循环计数逻辑较难直接单测(在 createAgent 闭包内)。可抽纯函数 `computeMaxIterations(maxToolRounds, maxIterations?)` 白盒测:

```ts
assert(computeMaxIterations(10) === 30)      // max(10*3, 30)
assert(computeMaxIterations(3) === 30)       // max(9, 30) = 30
assert(computeMaxIterations(20) === 60)      // max(60, 30)
assert(computeMaxIterations(10, 50) === 50)  // 显式覆盖
```

mock LLM 验证:构造"每次返回无 tool_calls + verify 反馈"的 mock,断言自纠不增 `rounds`(工具轮计数)、`iterations` 递增、触顶 `maxIterations` 强制退出不死循环。

### 3.2 门禁

`npm test` + `npm run build && npm run test:e2e`(createAgent 改动,e2e 验证不破坏现有 agent 行为)+ 断言计数同步。

## 权衡

- **为何不直接放宽 `maxToolRounds` 默认值**:治标不治本 —— 语义仍混乱(自纠占工具轮),用户调小 `maxToolRounds` 时仍踩。双计数根治语义。
- **为何加 `maxIterations` 而非只靠自纠独立预算**:自纠预算(`formatRetries`/`verifyAttempts`)各自有界,但"工具轮 → 自纠 → 工具轮 → 自纠"交替的总数无界时仍可能长循环。`maxIterations` 是总闸,防资源耗尽。
- **为何兜底文案不直接复用 `lastFinalContent`**:该缓存仅在 verify 触发时赋值(:434);未触发 verify 的路径无缓存。文案面向"极端无缓存"路径,改为"进展引导"比"简化问题"合理。
- **为何 `maxIterations` 默认不暴露给 ChatSdkOptions**:避免配置项膨胀;有需要的高级用户经 `CreateAgentOptions` 透传(createChatSdk 可选转发,本期不强制)。

## 风险

- **死循环**:`maxIterations` 兜底;正常自纠有界不会触顶,触顶即说明模型异常(反复格式错误 / verify 反复拒),强制退出并返回 fallback 文案。
- **行为变化(轮次更多)**:同等 `maxToolRounds` 下 agent 可用工具轮更多(自纠不再挤占)→ 可能多消耗 token。这是用户直觉预期(`maxToolRounds:10` = 10 轮工具),属正确修正;介意成本的用户调小 `maxToolRounds`。
- **e2e 轮次相关断言**:若有 e2e 断言"固定轮次",双计数后可能变化。排查 e2e 是否有此类硬编码(预计无,e2e 多用 mock 固定响应不依赖轮次上限)。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/harness/createAgent.ts:63-98`(options) | 加 `maxIterations?: number` |
| `src/core/harness/createAgent.ts:383-475`(循环) | `rounds` 自增点调整 + 新增 `iterations` 计数 + while 条件加 `iterations < maxIterations`;抽 `computeMaxIterations` 纯函数 |
| `src/core/harness/createAgent.ts:512` | 兜底文案改写 |
| `src/core/__tests__/modules/`(createAgent 相关) | `computeMaxIterations` 白盒 + mock 自纠不耗 rounds 断言 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement(循环预算语义) |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | `maxToolRounds` 语义说明(只计工具轮)+ 断言计数 |
