# Design: declarative-middleware-ordering

> **状态:期一(中间件 priority 排序)已实现并归档;期二(createReconfigurable setter 收敛)DEFERRED** —— 当前 10+ setter 各自 `rebind + infoTick++` 工作正常,期二是纯内部重构(行为零变化),量大(10+ setter 改造 + 全套 e2e)收益低(新 setter 少抄几行),推迟到频繁加可配置项时再做。下文 §2.2 / 落地点的"setter / createReconfigurable"部分为期二设计,保留备查。

> 核心约束:**顺序机制化,但不改顺序结果**。当前硬编码顺序是正确的,本变更把它从"数组字面量位置"变成"priority 常量 + 排序 + 断言",顺序偏移可被测试捕捉。setter 收敛同理:消除重复模式,行为不变。`Middleware` 接口不动(priority 是 buildCore 内部契约,不增加中间件作者负担)。

## 1. 现状定位

**问题 B:中间件顺序硬编码(`createChatSdk.ts:984-1032`)** —— `middlewares` 数组字面量的元素位置即装载序。隐式约束:
- dataHint 最前(数据段紧跟 base)
- sdk-events 最末(最后观察)
- verify 在用户中间件前(`:1024` 注释)
- humanConfirm 在 approval 前(`:1019` 注释,"更外层先收口")
- subagent/subagents/augmentSystem 在用户中间件前

增删中间件需手动维护这些约束,无测试保障。

**问题 E:setter 重复(散落 `:1196-1282`)** —— 每个 setter `if (core.agent) core.agent.setX(...); core.infoTick.value++` 模式重复 10+ 次。

## 2. 解法

### 2.1 中间件 priority + 排序

```ts
// createChatSdk.ts(或 sdk/middlewareStack.ts)
const MIDDLEWARE_PRIORITY: Record<string, number> = {
  dataHint: 10, usageHints: 20, todos: 30, skills: 40, vfs: 50,
  summarization: 60, memory: 70, permissions: 80, checkpoint: 90,
  humanConfirm: 100, approval: 110, verify: 120,
  subagent: 130, subagents: 140, augmentSystem: 150,
  'sdk-events': 9999,   // 最末
}

/**
 * 按 priority 稳定排序中间件栈:builtin 按 priority,用户中间件(无 priority)尾随保持声明序。
 * 纯函数(可单测)。
 */
export function composeMiddlewareStack(mws: Middleware[]): Middleware[] {
  const indexed = mws.map((m, i) => ({ m, i, p: MIDDLEWARE_PRIORITY[m.name] ?? Infinity }))
  // 有 priority 的按 p 升序;无 priority(Infinity)的按原声明序尾随;稳定排序
  return indexed
    .sort((a, b) => (a.p - b.p) || (a.i - b.i))
    .map((x) => x.m)
}
```

buildCore 末尾:`const middlewares = composeMiddlewareStack([...构造的中间件...])`。

**断言**(selftest):排序后顺序满足约束:
```ts
const ordered = composeMiddlewareStack(allMiddlewares).map(m => m.name)
assert(ordered.indexOf('dataHint') < ordered.indexOf('usageHints'))
assert(ordered[ordered.length - 1] === 'sdk-events')
assert(ordered.indexOf('verify') < ordered.findIndex(userMiddlewareStart))  // verify 在用户中间件前
assert(ordered.indexOf('humanConfirm') < ordered.indexOf('approval'))
```

### 2.2 createReconfigurable(setter 收敛)

```ts
// sdk/reconfig.ts
export interface Reconfigurable {
  register<T>(key: string, handler: (value: T, agent: AgentInstance | null) => void): void
  update<T>(key: string, value: T): void   // 调 handler + infoTick++ + 可选 emit
}

export function createReconfigurable(infoTick: Ref<number>, getAgent: () => AgentInstance | null): Reconfigurable {
  const handlers = new Map<string, (value: any, agent: any) => void>()
  return {
    register: (key, handler) => { handlers.set(key, handler) },
    update: (key, value) => {
      const h = handlers.get(key); if (!h) return
      h(value, getAgent())
      infoTick.value++
    },
  }
}
```

buildCore 内注册:
```ts
const reconfig = createReconfigurable(infoTick, () => core.agent)
reconfig.register('tools', (t, agent) => { rebuild(); agent?.setTools(allTools) })
reconfig.register('llm', (l, agent) => { ...; agent?.setLlm(l) })
reconfig.register('memory', (m) => memoryMw.reset(...))
// ...
```

`sdk.setTools = (t) => reconfig.update('tools', t)` —— 对外方法名保留(语义化),内部走注册表。

## 3. 测试策略

### 3.1 selftest

- `composeMiddlewareStack` 排序:builtin 按 priority、用户尾随、稳定(`Infinity` 保持声明序)。
- 约束断言:dataHint<usageHints、sdk-events 最末、verify 在用户前、humanConfirm<approval。
- `createReconfigurable`:`register` + `update` 触发 handler + infoTick++。

### 3.2 e2e

- `inspect().middleware` 顺序与 MIDDLEWARE_PRIORITY 一致(已有 `custom-injection.mjs` 可加断言)。
- 现有 setter e2e(setTools/setLlm/...)不破坏。

### 3.3 门禁

`npm test` + `npm run build && npm run test:e2e` + 断言计数同步。

## 权衡

- **为何 priority 数字而非完整 DAG(requires/before/after)**:当前约束简单(线性 + 少量"X 在 Y 前"),priority + 稳定排序 + 断言足够;完整 DAG(拓扑排序 + 依赖声明)复杂度高、对第三方中间件门槛高。若未来约束变复杂再升级。
- **为何 priority 放 buildCore 常量而非 Middleware 接口字段**:不增加中间件作者负担(第三方中间件无需声明 priority,自动尾随 builtin);buildCore 内部对自有中间件定义 priority 即可。
- **为何 setter 仍保留语义化方法名**:对外 API 稳定(`sdk.setTools` 等,集成方已用);内部注册表统一消除重复,不破坏公开契约。`sdk.update(key,value)` 不作公开 API(内部机制)。
- **为何不合并 B+E 为更大重构**:它们同属"装配/扩展机制统一",但可独立交付(期一排序 / 期二 setter),分期降风险。

## 风险

- **排序后顺序与当前不一致**:priority 常量写错 → 顺序偏移。靠断言锁死已知约束 + e2e `inspect().middleware` 顺序断言捕捉。
- **用户中间件尾随 Infinity 的稳定性**:JS `sort` 非稳定?现代引擎 Array.sort 稳定(ES2019+);加 `|| (a.i-b.i)` 双保险。
- **setter 收敛漏 rebind**:`createReconfigurable` 统一调 handler,handler 内负责 rebind;漏 rebind = handler 写错。靠现有 setter e2e(setTools 后 inspect 反映)捕捉。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/sdk/createChatSdk.ts`(或 `sdk/middlewareStack.ts`) | 新增 `MIDDLEWARE_PRIORITY` + `composeMiddlewareStack`;`middlewares` 末尾排序 |
| `src/core/sdk/reconfig.ts`(新建) | `createReconfigurable` 注册表 |
| `src/core/sdk/createChatSdk.ts`(setter 段) | `setTools`/`setLlm`/... 改经 `reconfig.update` |
| `src/core/index.ts` + `types/index.d.ts` | 可选导出 `composeMiddlewareStack` |
| `src/core/__tests__/modules/` | `composeMiddlewareStack` 排序 + 约束断言 + `createReconfigurable` |
| `tests/e2e/`(inspect / custom-injection) | `inspect().middleware` 顺序断言 |
| `openspec/specs/page-agent-core.md` | 合入 Requirement |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数 + 中间件排序机制说明 |
