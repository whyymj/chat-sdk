# Change: declarative-middleware-ordering

> 配套:本变更把中间件装载顺序从"`buildCore` 数组字面量硬编码"改为"声明式 priority 常量 + 排序 + 断言",并顺手收敛运行时重配置 setter 的重复 `infoTick++ + 条件 setX` 模式(原架构优化点 B + E)。两条同属"`createChatSdk` 装配/扩展机制统一",合并一个 change。建议在 `refactor-module-extraction`(搬 buildCore)之后,避免同区域冲突。

## Why

1. **中间件顺序是隐式契约,无静态保障**。`createChatSdk.ts:984-1032` 的 `middlewares` 数组字面量硬编码装载序:dataHint → usageHints → todos → skills → vfs → summarization → memory → permissions → checkpoint → humanConfirm → approval → verify → subagent → subagents → augmentSystem → 用户中间件 → sdk-events。顺序蕴含隐式依赖(verify 必须在用户中间件前、humanConfirm 在 approval 前、sdk-events 最末、dataHint 最前),增删中间件全靠人脑保证,改错顺序 = 静默 bug(如 verify 跑在用户中间件后,自纠被用户中间件拦截)。

2. **运行时重配置 setter 重复 `infoTick++ + 条件 setX`**。`setTools`/`setLlm`/`setMemory`/`setSubagents`/`setData`/`setSkills`/`addTool`/`removeTool`/`addSubagent`/`removeSubagent` 每个 setter 各自:`if (core.agent) core.agent.setX(...)` + `core.infoTick.value++`(:1196-1282 散落 10+ 处)。新增可重配置项需手动重复这套,易漏 infoTick(导致 DebugDrawer 不刷新)或漏 rebind。

## What Changes

### 1. 声明式中间件 priority + 排序(治 B)

- `createChatSdk.ts` 定义 `MIDDLEWARE_PRIORITY: Record<string, number>` 常量(name → priority,如 dataHint=10 / usageHints=20 / ... / sdk-events=9999);用户自定义中间件无 priority,排在 builtin 之后(保持声明序)。
- `composeMiddlewareStack(middlewares)` 纯函数:按 priority 稳定排序(builtin 间按 priority,用户中间件按原序尾随)。
- buildCore 仍按条件构造中间件实例(顺序无关),末尾经 `composeMiddlewareStack` 排序后传 `createAgent`。
- **断言**:排序后顺序满足已知约束(dataHint 最前 builtin / sdk-events 最末 / verify 在用户中间件前 / humanConfirm 在 approval 前)—— selftest 锁死,顺序偏移立即失败。
- 不改 `Middleware` 接口(priority 是 buildCore 内部常量,不要求中间件作者声明)。

### 2. 运行时重配置统一(治 E)

- 抽 `createReconfigurable()` 注册表:`register(key, handler(value))` 注册;`update(key, value)` 统一入口 → 调 handler + `infoTick++` + emit(可选)。
- 现有 setter(`setTools`/`setLlm`/`setMemory`/`setSubagents`/`setData`/`setSkills`/`addTool`/...)改为经注册表,消除散落的 `infoTick++ + 条件 setX` 重复。
- 新增可重配置项 = 注册一个 handler,自动获得 rebind + tick + 一致语义。

## Impact

- **改造**:`src/core/sdk/createChatSdk.ts` —— 新增 `MIDDLEWARE_PRIORITY` 常量 + `composeMiddlewareStack`;`middlewares` 数组末尾加排序;抽 `createReconfigurable`(可放 `sdk/reconfig.ts`),setter 改调注册表。
- **新增导出**(可选):`composeMiddlewareStack` 纯函数(供集成方自定义中间件栈排序复用)。
- **行为变化**:无(排序后顺序与当前硬编码一致;setter 行为不变)。向后兼容。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(中间件声明式排序 + 重配置统一)。
- **测试**:selftest 补 `composeMiddlewareStack` 排序 + 约束断言;e2e `inspect().middleware` 顺序反映。断言计数同步。

## Non-goals

- **不改** `Middleware` 接口签名 —— priority 是 buildCore 内部常量,中间件作者无需声明(降低第三方中间件门槛)。
- **不引入** 完整依赖图(requires/before/after)—— priority 数字 + 稳定排序已覆盖当前约束;完整 DAG 复杂度高、收益低。
- **不改** 中间件装载的"条件装载"逻辑(`usePlanning`/`useSkills` 等条件)—— 只改"已构造中间件的排序"。
- **不合并** setter 为单一 `sdk.update(key, value)` 公开 API —— 内部注册表统一即可,对外仍保留语义化方法名(`setTools` 等)。
- **不动** `createAgent` 内部的 before/after/wrap 执行序(正序/逆序/洋葱)—— 那是 harness 契约,本变更只管 createChatSdk 侧的装载排序。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `MIDDLEWARE_PRIORITY` + `composeMiddlewareStack` + 排序断言 | 低(顺序不变,仅机制化) | ✅ patch |
| 期二 | `createReconfigurable` 注册表(setter 收敛) | 中(setter 改造,需 e2e) | ✅ patch(叠加) |

建议在 `refactor-module-extraction` 之后(同区域)。两期 patch(内部机制化,行为不变)。
