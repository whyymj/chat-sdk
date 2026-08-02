# Change: fix-unify-error-half-done

> 修正 `unify-error-model` 落地后的半成品状态:`routeError` 死代码 + middleware 空头契约承诺。
> 方向:**缩水**(选项 A)——诚实承认"未实现自动路由",但**保留 `routeError` 导出为未来扩展预留口**(不删),为后续功能升级(wrapToolCall 自动路由)留低改动面接通路径。

## Why

`unify-error-model` 落地后存在三处不一致(复盘发现):

1. **`routeError` 是死代码**:selftest 测其返回值,但 `createAgent`/`events`/`createChatSdk` 的 catch 点只调 `asAgentError(err,'xxx').message` 取消息,**无人消费 `routeError`**——severity 路由结果被丢弃。

2. **middleware 契约是空头承诺**:`middleware.ts:11-13` 注释"中间件抛 `AgentError(recoverable)` → wrapToolCall 捕获转 feedback",但 `wrapToolCall` 执行器(166-172)是标准洋葱,**未实现**该路由;中间件抛任何错仍按原状冒泡。

3. 实际外部价值仅:`onEvent('error')` severity 字段(且只在 invoke fatal 一个点触发,基本都 fatal)+ 类型导出。

## What Changes(缩水 A,但保留扩展口)

### 1. `routeError` 不删,降级为"导出工具 + 未来扩展点"

- **不删**(考虑未来 wrapToolCall 补全):`routeError`/`asAgentError`/`agentError` 保留导出。
- 顶部注释诚实化:"框架内置 catch 点用**简化硬编码路由**(coreExecTool 总 recoverable 回灌 / afterAgent·emit observable warn / invoke fatal emit),**当前未消费 `routeError`**。`routeError` 是公共工具:① 供集成方自定义中间件 catch 按 severity 决策;② 为未来 `wrapToolCall` 实现 recoverable→feedback 自动路由预留(届时在执行器接通,catch 点/接口零改动)。"

### 2. middleware 注释诚实化

- 删"wrapToolCall 捕获转 feedback"空头承诺。
- 改为:"错误契约(**规划中,未实现**):中间件抛普通 Error 当前按原状冒泡(fatal 语义);未来计划在 `wrapToolCall` 执行器实现 `AgentError(recoverable)→feedback` 自动路由(消费 `routeError`)。当前集成方需自行在中间件 catch 处理。"

### 3. 保留有价值的部分(不动)

- `asAgentError` catch 归一化(message 提取统一)——留
- `onEvent('error')` severity 字段——留(已发布,向后兼容)

### 4. selftest `routeError` 断言

- 保留(导出可用 + 行为正确),补注释"框架内部未消费,验证导出可用 + 为未来扩展锁行为"。

## 扩展性设计(为未来 wrapToolCall 补全留口)

| 现状(缩水后) | 未来补全时(功能升级) |
|---|---|
| `routeError` 导出,catch 点未调 | `wrapToolCall` 执行器 catch `AgentError` → `routeError` 决定 feedback/abort/log |
| middleware 注释"规划中" | 注释升级"已实现",wrapToolCall 路由落地 |
| `asAgentError` 归一化(留) | 不变(catch 点继续用) |

**补全时改动面:仅 middleware 执行器 + 其测试**,catch 点/`asAgentError`/`routeError` 接口零改动。这是"缩水而非删除"的理由——结构预留,未来接通成本低,不堵功能升级。

## Impact

- **行为零变化**(只删死代码消费歧义 + 改文档注释,catch 行为不变)
- 向后兼容(`routeError`/`asAgentError`/`onEvent` severity 全保留)
- 新增导出:无(只改注释)
- 测试:selftest `routeError` 断言保留 + 补注释;零行为变化故无新断言
- 影响规范:`page-agent-core.md` 的"三档错误模型"Requirement 需修正(删"routeError 各层路由"过头描述,改为"内置 catch 简化硬编码 + routeError 供集成方/未来扩展")

## Non-goals

- **不补全** wrapToolCall recoverable→feedback 自动路由(YAGNI,无需求驱动;留扩展口,未来真有需求再接通)
- **不删** `routeError`(留作公共工具 + 扩展点)
- **不动** `asAgentError` catch 归一化(有实价值)
- **不改** `onEvent('error')` severity(已发布)
