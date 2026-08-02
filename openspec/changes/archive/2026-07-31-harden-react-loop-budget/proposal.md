# Change: harden-react-loop-budget

> 配套:本变更加固 `createAgent` ReAct 循环的两处预算/收口语义 —— ① `rounds` 把格式自纠(format retry)与 verify 自纠也计入"工具轮预算",小 `maxToolRounds` 下易被非工具轮挤占、提前耗尽;② 循环耗尽兜底文案"请简化你的问题"体验差(工具已做大量操作却让用户"简化")。与 `evolve-default-toolset` / `fix-dataops-write-correctness` 正交(那些改 dataOps,本变更只改 createAgent 循环骨架)。

## Why

1. **`rounds` 语义名为"工具轮次"实则"循环次数",自纠挤占工具预算**。`createAgent.ts` 的 `rounds` 在三处自增:格式自纠(:426 `rounds+=1;continue`)、verify 自纠(:438 `rounds+=1;continue`)、工具执行后(:474 `rounds++`)。用户设 `maxToolRounds: 3` 期望"最多 3 轮工具调用",但一次 verify 自纠 + 两次工具即触底 → 走 wrap-up 兜底,工具能力被自纠截断。verify 有 `maxVerifyAttempts` 前置保护(:431),format retry 仅靠 `maxFormatRetries=2` 自限,两者叠加仍消耗 `rounds`。

2. **循环耗尽兜底文案误导用户**。工具轮耗尽且无缓存最终答时(:512)返回"已达到最大工具调用轮次,请简化你的问题"。此时 agent 往往已完成大量工具操作(改了多个字段),却让用户"简化问题" —— 用户感觉"白做了"。虽有 `lastFinalContent` 缓存(:482)与 ToolMessage 收口(:489)兜底,但极端路径仍漏到这句冷冰冰的文案。

## What Changes

### 1. 双计数:`rounds`(工具轮)与 `iterations`(总循环)分离

- `rounds` **只在有 tool_calls 执行后 + 1**(工具轮预算,受 `maxToolRounds` 约束)—— 回归"工具轮次"语义。
- 新增 `iterations` 每次 while 循环 + 1(受新增硬上限 `maxIterations`,默认 `maxToolRounds * 3` 与 30 取大,防自纠死循环)。
- 格式自纠:仅 `formatRetries++`(已有,限 2),**不增 `rounds`**。
- verify 自纠:仅 `verifyAttempts++`(已有),**不增 `rounds`**。
- while 条件:`iterations < maxIterations`(工具轮耗尽由内部 wrap-up 逻辑处理,不改 while 退出条件语义)。

### 2. wrap-up 兜底文案改为"基于已有结果给进展"

- `:512` 文案从"已达到最大工具调用轮次,请简化你的问题"改为引导 agent 基于已完成工具结果给出**当前进展 + 已完成项 + 下一步建议**,不再把责任推给用户"简化"。
- wrap-up 触发逻辑(:489-510,末尾 ToolMessage 强制收口)保留不变。

## Impact

- **改造**:`src/core/harness/createAgent.ts` —— `stream()` 内 `rounds` 自增点调整(移除自纠路径的 `rounds+=1`);新增 `iterations` 计数 + `maxIterations` 上限;`:512` 兜底文案改写。
- **新增配置**:`CreateAgentOptions.maxIterations`(optional,默认推导);`ChatSdkOptions` 可选透传(非必须)。
- **行为变化**:`maxToolRounds` 现在严格只限工具轮;自纠不再挤占工具预算(同等 `maxToolRounds` 下,agent 可用工具轮更多)。向后兼容(默认值语义更符合用户直觉)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(ReAct 循环预算语义)。
- **测试**:selftest 补循环计数逻辑(纯函数化 `computeLoopBudget` 或经 mock 验证);断言计数同步。

## Non-goals

- **不改** wrap-up 的触发条件(:489-510)—— 只改兜底文案,触发逻辑(末尾 ToolMessage 强制收口)保留。
- **不改** `maxVerifyAttempts` / `maxFormatRetries` 既有预算 —— 它们本就是自纠的独立预算,本变更只是让它们**不再额外消耗 `rounds`**。
- **不改** verify / format-retry 的回灌消息内容 —— 只动计数归属。
- **不引入** 用户可配的"自纠轮上限" —— 复用 `maxVerifyAttempts`(已透传)+ `maxFormatRetries`(内部常量)。
- **不动** abort 路径 —— abort 保留 partial 的语义不变。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `rounds`/`iterations` 双计数 + 自纠不耗 rounds | 中(循环骨架,需保证不死循环) | ✅ patch |
| 期二 | wrap-up 兜底文案改写 | 极低 | ✅ patch(叠加) |

期一是核心,需配套 `maxIterations` 硬上限防自纠死循环。两期都 patch(向后兼容的语义修正)。
