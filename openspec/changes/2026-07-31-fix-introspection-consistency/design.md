# Design: fix-introspection-consistency

> 核心约束:**只收敛展示出口,不改拼装逻辑**。实际发给 LLM 的 system prompt 一直是对的(`createAgent.buildSystemPrompt` 拼的);问题只在 `getInfo` 另起炉灶拼了一遍还漏段。解法:把 `buildSystemPrompt` 的结果导出,getInfo 直接读,消除两套拼装。

## 1. 现状定位:三处拼装,getInfo 漏段

**实际 system(权威,`createAgent.buildSystemPrompt` :213-222)**:

```ts
function buildSystemPrompt(): string {
  const parts: string[] = [systemPrompt || '你是一个智能助手。']  // base
  for (const m of middlewares) {
    if (m.augmentPrompt) {
      const seg = m.augmentPrompt(state)                         // Σ 各中间件段
      if (seg) parts.push(seg)
    }
  }
  return parts.join('\n\n')
}
```

中间件 `augmentPrompt` 段(按装载序):dataHint / usageHints / todos / skills / vfs(无)/ summarization(无)/ memory / permissions(无)/ checkpoint(无)/ humanConfirm(无)/ approval(无)/ verify(无)/ subagent(无)/ subagents / augmentSystem / 用户中间件 / sdk-events(无)。
→ 实际 system 含:base + dataHint + usageHints + todos(若有)+ skills(若有)+ memory(若有)+ subagents(若有)+ augmentSystem(若有)+ ...

**getInfo 的拼装(`createChatSdk.ts:1289`)**:

```ts
systemPrompt: baseSystemPrompt + buildDataPrompt(liveData()) + (augmentSystemMw ? (augmentSystemMw.augmentPrompt(...) || '') : '')
```

→ 只含:base + data + augmentSystem。**漏:usageHints / todos / skills / memory / subagents**。

**差异**:

| 段 | 实际 system | getInfo |
|---|---|---|
| base(用户 prompt + reliableWriteRules) | ✅ | ✅(`baseSystemPrompt`) |
| data(可操作数据) | ✅(dataHint 中间件) | ✅(`buildDataPrompt`) |
| usageHints(工具用法) | ✅ | ❌ 漏 |
| todos(任务清单) | ✅(若有) | ❌ 漏 |
| skills(技能索引) | ✅(若有) | ❌ 漏 |
| memory(持久指令) | ✅(若有) | ❌ 漏 |
| subagents(预声明) | ✅(若有) | ❌ 漏 |
| augmentSystem(用户钩子) | ✅(若有) | ✅ |

## 2. 解法:导出权威拼装,getInfo 代理

### 2.1 createAgent 暴露 getEffectiveSystemPrompt

`createAgent.ts` return 块(:559-568)新增:

```ts
return {
  invoke,
  stream,
  getState: () => state,
  get allTools() { return allTools },
  setTools,
  setLlm,
  debugLogs,
  getEffectiveSystemPrompt: () => buildSystemPrompt(),   // 新增:复用内部权威拼装
}
```

`buildSystemPrompt` 是闭包内函数,直接调即得当前 state 下的完整 system。

### 2.2 getInfo 代理到出口

`createChatSdk.ts:1289`:

```ts
// before
systemPrompt: baseSystemPrompt + buildDataPrompt(liveData()) + (augmentSystemMw ? ... : ''),

// after
systemPrompt: core.agent?.getEffectiveSystemPrompt?.() ?? (baseSystemPrompt + buildDataPrompt(liveData())),
```

agent 已构造(常态)→ 用 `getEffectiveSystemPrompt`(完整);agent 未构造(initDone 前、headless 早调 inspect)→ 回退旧拼接(有 data 段,至少不空)。

### 2.3 为何不改 buildSystemPrompt 签名

`buildSystemPrompt()` 无参,读闭包 `state` 与 `middlewares`。`getEffectiveSystemPrompt` 同样无参,调它即可。无需把 state / middlewares 传出 createAgent(那会破坏封装)。state 在非运行时是 `createInitialState`(无 todos/memory),展示"配置态将注入哪些段"足够;运行中调 inspect 读的是当前 state(含运行态 todos 等),也正确。

## 3. 测试策略

### 3.1 e2e(inspect 完整性)

`tests/e2e/inspect.mjs` 或 `systemprompt.mjs` 补:

```js
// 配 skills + memory + 各 capabilities
const sdk = createSdk({ skills:[{name:'s1',...}], memory:'记住X', capabilities:{...} })
const info = sdk.inspect()
// 修复前缺失,修复后存在
assert(info.systemPrompt.includes('Skills'))            // skills 索引段
assert(info.systemPrompt.includes('记住X'))             // memory 段
assert(info.systemPrompt.includes('工具'))              // usageHints 段(按 toolMode)
// base + data 段不丢
assert(info.systemPrompt.includes(basePrompt内容片段))
```

### 3.2 selftest

无需新增。`buildSystemPrompt` 是 createAgent 内部,e2e 经 inspect 覆盖顶层出口足够。

### 3.3 门禁

`npm run build && npm run test:e2e` 全过(改了 getInfo 顶层出口,e2e 必跑)+ 断言计数同步。

## 权衡

- **为何导出函数而非暴露 middlewares**:暴露 middlewares 给 getInfo 自己拼,等于保留两套拼装(又可能不同步)。导出 `buildSystemPrompt` 的结果(`getEffectiveSystemPrompt`),getInfo 直接读,**单一真相源**,根治。
- **为何不把 getInfo 的拼装也搬进 createAgent**:getInfo 还拼了非 prompt 字段(tools / skills / data / ...),整体搬不合适;只收敛 systemPrompt 字段即可。
- **为何留回退**:agent 在 initDone 内才构造(:1410),极早期 inspect(initDone 未 resolve、headless 未 await mount)需兜底。回退用旧拼接(base + data),虽不全但不崩。

## 风险

- **getEffectiveSystemPrompt 读 state,非运行时为初始态**:展示的 todos / memory 段在"未运行"时为空属正常(配置态本就无运行态 todos)。文档 / DebugDrawer 说明"inspect 反映当前态,运行中调用含运行时 todos"。
- **中间件 augmentPrompt 返回 undefined 的段会跳过**:`buildSystemPrompt` 已处理(`if (seg)`),`getEffectiveSystemPrompt` 继承,无空段噪音。
- **性能**:`getEffectiveSystemPrompt` 每次调都拼(遍历中间件),但 inspect 非高频(用户点 DebugDrawer / infoTick 触发),开销可忽略。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/harness/createAgent.ts:559-568` | return 块加 `getEffectiveSystemPrompt: () => buildSystemPrompt()` |
| `src/core/sdk/createChatSdk.ts:1289` | systemPrompt 改为代理到 `core.agent?.getEffectiveSystemPrompt?.()` + 旧拼接回退 |
| `tests/e2e/inspect.mjs`(或 systemprompt.mjs) | 补 `inspect().systemPrompt` 含 skills / memory / usageHints 段断言 |
| `openspec/specs/page-agent-core.md` | 合入 1 条 Requirement(归档时) |
| `README.md` / `README.zh-CN.md` / `CLAUDE.md` | 断言计数同步 |
