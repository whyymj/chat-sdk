# Change: focus-auto-switch(focus 自动切换全局/局部修改任务)

> 用户诉求(2026-08-08):「要能通过 focus api 自动切换全局,局部的修改任务」。诊断:focus 机制(三层收敛中间件:目标提示 + 子树视野 + 写越界 PATH_DENIED)完整,但从「任务」到「自动拨动 focus 开关」的驱动链断三处。
> **状态**:实施中(三 phase)。umbrella change,三件同源诉求。simple 模式 set_focus 暴露 deferred(P1)。详细设计见 plan + design.md。

## Why

| 层面 | 现状 | 断点 |
|---|---|---|
| L3 自动判断 | usageHints 对 focus **0 命中** | agent 不知何时该 set/clear focus |
| L4 状态可靠 | SnapshotKind 有 mission/workingMemory,**无 focus** | 刷新丢焦点,精修改一半退回全局 |
| 子 agent | `subagent.ts` 完全不涉及 focus | 主 agent 局部模式委派子任务,子 agent 无约束可越界 |

## What Changes

1. **usageHints focus 引导(模块1,L3 发动机)**:advanced + capabilities.focus 开 → 注入 focus 段(局部任务→set_focus / 全局任务→不聚焦 / 完成→clear_focus / 先 read 定位 path)。门控 `rc.focus && !simple`,与 set_focus 工具暴露条件一致。
2. **focus 持久化(模块2,L4 可靠)**:照抄 mission 模式。SnapshotKind 加 `'focus'`;createChatSdk `applySnapshot`(restore 含 `getSchemaAtPath` 校验失效丢弃)/`persistRuntime`/`switchSession` 三处接线。
3. **子 agent 继承(模块3,Q1=a 最安全)**:主聚焦 → spawn 子 agent 默认同一焦点(三层收敛)。`createFocusMiddleware` 加 `initialFocus` 构造参数;subagent 透传 `getFocus`/`getSchema`;createChatSdk 两处装配注入。

## Impact

- **测试**:selftest +13(sec-56 新建 + sec-02/sec-54 扩展)/ e2e +11(focus.mjs/subagents.mjs)/ browser +2(刷新保留;子 agent 继承端到端 manual/deferred,e2e 已覆盖逻辑层)。
- **行为变化**:全增量。focus 默认开但需 advanced + 实际聚焦才生效,未聚焦零变化。
- **向后兼容**:旧存档无 focus kind 安全(load 时 undefined 跳过);新透传项可选;主未聚焦 → 子 agent 无 focus 中间件(零回归)。
