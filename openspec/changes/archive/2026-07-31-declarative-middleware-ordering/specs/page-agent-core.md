# Specification Delta: page-agent-core

> 本文件为 change `declarative-middleware-ordering` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 中间件声明式 priority 排序与运行时重配置统一

`createChatSdk` 的中间件装载顺序由声明式 `MIDDLEWARE_PRIORITY` 常量(name → priority 数字)驱动,经纯函数 `composeMiddlewareStack(middlewares)` 稳定排序:builtin 中间件按 priority 升序,用户自定义中间件(无 priority)尾随并保持其声明序。已知顺序约束由 selftest 断言锁死(`dataHint` 在 `usageHints` 前 / `sdk-events` 最末 / `verify` 在用户中间件前 / `humanConfirm` 在 `approval` 前 等)。该机制替代此前"`middlewares` 数组字面量位置 = 装载序"的隐式硬编码,使顺序偏移可被测试捕捉,增删中间件不再靠人脑维护位置。`Middleware` 接口不增加 priority 字段(第三方中间件零负担,自动尾随 builtin)。

运行时重配置(`setTools`/`setLlm`/`setMemory`/`setSubagents`/`setData`/`setSkills`/`addTool`/`removeTool`/...)经统一注册表 `createReconfigurable`:`register(key, handler)` 注册,`update(key, value)` 统一调用 handler(负责 rebind)+ `infoTick++`(触发 DebugDrawer 刷新)。对外仍保留语义化方法名(`sdk.setTools` 等,公开 API 不变),内部消除"每个 setter 各自 `if(agent) agent.setX(); infoTick++`"的重复模式,新增可重配置项 = 注册一个 handler,自动获得一致语义。排序与重配置均不改运行时行为(顺序与 setter 语义与此前一致)。
