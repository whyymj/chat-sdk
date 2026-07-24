# Design: add-verify-middleware

> 核心约束:循环改动必须**增量、可控、可独立验证**。本项全部技术不确定性集中在 `beforeReturn` 钩子点的插入方式 —— 已在 `createAgent.ts` 精准定位,见下。

## 1. 循环钩子点:精准定位 + 插入方式

**现状**(`createAgent.ts:310-314`,agent 自认为做完的唯一 return 收口):

```ts
if (!response.toolCalls.length) {
  onEvent({ type: 'done', content: response.content })
  await runAfterAgent(middlewares, state)
  return response.content
}
```

**改后**(在 emit done / return 之前插 `beforeReturn` 钩子点;经 code-review 优化为**预算前置 + 最终答缓存**):

```ts
// 循环外声明:let lastFinalContent: string | null = null
if (!response.toolCalls.length) {
  // beforeReturn 钩子(正序):agent 返回前可拦截自纠。
  // 预算检查前置(verifyAttempts < maxVerifyAttempts):避免预算耗尽仍跑钩子(尤其 adversarial 子 agent 烧 token)—— 框架级防御,不靠中间件自觉
  if (maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts) {
    const feedback = await runBeforeReturn(middlewares, { messages: currentMessages, state, response })
    if (feedback) {
      lastFinalContent = response.content // 缓存最终答:自纠若耗尽 rounds 预算,兜底优先返回它(而非误导性"请简化问题")
      state.verifyAttempts += 1
      currentMessages.push(new HumanMessage(`⚠️ 验证未通过,请修正:${feedback}`))
      log('middleware', { stage: 'verify_retry', attempt: state.verifyAttempts, feedback })
      rounds += 1
      continue // 回灌反馈,继续循环让模型修正(不 return)
    }
  }
  onEvent({ type: 'done', content: response.content })
  await runAfterAgent(middlewares, state)
  return response.content
}
// 循环退出兜底:自纠耗尽 rounds → 优先 lastFinalContent;纯工具循环耗尽 → 兜底文案
const fallback = lastFinalContent ?? '已达到最大工具调用轮次，请简化你的问题。'
```

**关键点**:
- `runBeforeReturn` 正序遍历中间件,收集所有非 null `feedback`,拼接成一个字符串返回;全 null 则返回 `null`(放行 return)。
- **预算检查框架级前置**:`maxVerifyAttempts > 0 && verifyAttempts < maxVerifyAttempts` 在调用 `runBeforeReturn` **之前**判定 —— 预算耗尽则根本不跑钩子(避免 adversarial 子 agent 等昂贵 check 无谓重跑)。`verifyAttempts` 由 `createAgent` 在 `state` 维护,每触发一次自纠 +1。
- `maxVerifyAttempts` 默认 `0` = 关闭自纠 = 完全现状(向后兼容);>0 时双保险防死循环(`verifyAttempts` 上限 + `rounds < maxToolRounds`)。
- **最终答缓存**(`lastFinalContent`):自纠路径在拒掉 agent 最终答前缓存它;若自纠耗尽 rounds 预算,兜底优先返回缓存的有效最终答,而非误导性的"请简化问题"。
- `continue` 而非重构:不改变 `while` 骨架、不破坏 abort 语义、不破坏 maxToolRounds 语义(rounds 仍单调 +1;`continue` 跳过循环末尾的 `rounds++`,故钩子内手动 `rounds += 1`,无双重计数)。
- **不动**第 304 行 abort 收口、不动工具执行段、不动循环退出兜底(仅兜底文案加 `lastFinalContent ??` 前缀)。

## 2. 中间件契约扩展(`middleware.ts`)

`Middleware` 接口新增可选钩子:

```ts
interface BeforeReturnContext {
  messages: BaseMessage[]
  state: HarnessState        // 含 verifyAttempts
  response: ModelResponse    // 即将 return 的模型回复(含 content / toolCalls)
}

// null / undefined = 放行 return
// { continue: true, feedback } = 回灌 feedback 当 user 消息,继续循环
type BeforeReturnHook = (ctx: BeforeReturnContext) => Promise<string | null> | string | null

// Middleware 契约加可选字段
interface Middleware {
  // ... 现有 8 钩子 ...
  beforeReturn?: BeforeReturnHook
}
```

执行器 `runBeforeReturn`(正序,类似 `runBeforeModel`):

```ts
async function runBeforeReturn(middlewares: Middleware[], ctx: BeforeReturnContext): Promise<string | null> {
  const feedbacks: string[] = []
  for (const m of middlewares) {
    if (!m.beforeReturn) continue
    const fb = await m.beforeReturn(ctx)
    if (fb) feedbacks.push(fb)
  }
  return feedbacks.length ? feedbacks.join('\n\n') : null
}
```

## 3. `createVerifyMiddleware` 模板(`harness/verify.ts`)

把领域 `check` 包成 `beforeReturn` 钩子:

```ts
interface VerifyCheckContext {
  messages: BaseMessage[]   // 与 beforeReturn 底层一致(含 system 头 + agent 最新回复 + 历史 tool_result);期三 createWriteBackCheck 据此找 ToolMessage
  state: HarnessState
}

interface VerifyCheckResult {
  ok: boolean
  feedback?: string          // ok=false 时的修正指引(回灌给 agent)
}

type VerifyCheck = (ctx: VerifyCheckContext) => Promise<VerifyCheckResult> | VerifyCheckResult

interface VerifyMiddlewareOptions {
  check: VerifyCheck
  maxAttempts?: number       // 默认 2;createAgent 层兜底,中间件不自己计数
  adversarial?: { llm: BaseChatModelLike; allowedTools?: string[] }  // 可选对抗验证
}

export function createVerifyMiddleware(opts: VerifyMiddlewareOptions): Middleware {
  return {
    name: 'verify',
    async beforeReturn({ messages, state }) {
      const res = await opts.check({ messages, state })
      if (res.ok) return null
      return res.feedback ?? '结果未通过验证,请复查。'
    },
  }
}
```

## 4. 内置 domain 辅助:`createWriteBackCheck()`(可选)

page-agent 写后读回验证 —— **机械验证"写入生效 + 符合 schema"**,不做语义判断:

```ts
interface WriteBackCheckOptions {
  registry?: () => WindowPropRegistry   // 默认取 windowOps 注册表
}

export function createWriteBackCheck(opts?: WriteBackCheckOptions): VerifyCheck {
  return async ({ messages }) => {
    // 从最近一轮 tool_result 中提取被写的 path(set/edit/delete_window_prop 的返回)
    const writtenPaths = extractWrittenPaths(messages)
    if (!writtenPaths.length) return { ok: true }  // 本轮无写操作,放行

    const issues: string[] = []
    for (const p of writtenPaths) {
      const current = safeReadWindow(p)            // 读回当前值
      const { schema } = describeProp(p) ?? {}
      if (current === undefined) issues.push(`写入 ${p} 后读回为空,疑似未生效`)
      else if (schema && !validateAgainstSchema(current, schema)) issues.push(`${p} 读回值不符合声明的 schema`)
    }
    return issues.length ? { ok: false, feedback: issues.join(';\n') } : { ok: true }
  }
}
```

**用法**:`createPageAgent({ verify: { check: createWriteBackCheck(), maxAttempts: 1 } })`。
集成方也可完全自定义 `check`(领域不变量、业务规则等)。

## 5. 对抗式验证(check 通过后 spawn 找茬子 agent,refute 姿态)

`adversarial` 配置时,verify 中间件在 **check 通过后** spawn 一个无工具的"找茬"子 agent(refute 姿态,突破自审 confirmation bias):

```ts
// verify.ts:createVerifyMiddleware.beforeReturn
const res = await opts.check({ messages, state })
if (!res.ok) return res.feedback ?? '...'       // check 失败先回灌(不浪费子 agent)
if (opts.adversarial) {
  const advFeedback = await runAdversarial(messages, opts.adversarial.llm)
  if (advFeedback) return advFeedback           // 对抗发现问题 → 回灌
}
return null

// runAdversarial:构造无工具审查子 agent
const child = createAgent({ llm, maxToolRounds: 1, systemPrompt: '你是严格的对抗式审查者,只找问题不赞美。' })
const verdict = await child.invoke([{ role: 'user', content: 审查prompt }])
return isAdversarialClean(verdict) ? null : verdict.trim()
```

- **refute 姿态**:子 agent 的 KPI 是"证明回复有问题"(非"提改进"),突破自审 confirmation bias —— 这是它区别于普通反思模式的核心。
- **不复用 `runSubagent`**:`runSubagent` 为 spawn 工具设计(签名含 allTools/forward/递归);对抗验证是纯文本审查,复查 window 交 createWriteBackCheck,故用 createAgent 直接构造**无工具**子 agent,更简。
- **check 通过后才跑**:factual check(createWriteBackCheck)快速失败时不浪费子 agent token。
- **verdict 判定**:`isAdversarialClean`(导出)命中"无问题/没发现问题"等 → 放行。
- **token 成本**:check 过后多跑一个子 agent → 默认关闭,`verify.adversarial: true` 显式开启;`createPageAgent` 透传主 `llm`。

## 6. 配置与能力开关(`createPageAgent`)

```ts
createPageAgent({
  verify: {
    enabled?: boolean                 // 默认 false(向后兼容)
    check?: VerifyCheck               // 自定义;省略则用内置 createWriteBackCheck
    maxAttempts?: number              // 默认 2
    adversarial?: boolean             // 默认 false;true 时用主 agent 的 llm spawn 找茬子 agent
  },
  capabilities: { verify: true }      // 与 planning/skills/... 同级的能力开关
})
```

- `capabilities.verify: true` 且 `verify.enabled !== false` → 装载 verify 中间件(拼到内置栈 `permissions` 之后)。
- 默认 `check` = `createWriteBackCheck()`;传 `check` 覆盖。

## 7. 演进:本项是 #2 的轻量前身

```
  #5(本项):  循环 → beforeReturn 钩子 → 同步取 feedback → 注入 user 消息 → continue
                                   │
                                   │  循环已具备「停下 → 注入 → 继续」骨架
                                   ▼
  #2(后续):  循环 → ask_user/exit_plan_mode 工具返回 Pending → await UI Promise
                   → resolve 当 feedback → 注入 → continue
                                   (把「同步取」升级为「异步 await UI」)
```

#2 复用本项的 `beforeReturn` 注入与 `continue` 通路,只新增"工具挂起 + await 外部输入"。**#2 的最大风险(碰循环)被本项提前消化一半。**

## 权衡

- **通用 check 不可靠** → 框架只给钩子 + 模板,判断交给集成方;内置 `createWriteBackCheck` 只做机械读回,不碰语义。这是诚实的边界。
- **自纠烧 token** → 默认关闭,`maxAttempts` 兜底(默认 2),`adversarial` 默认关闭。
- **`beforeReturn` 语义 vs `afterAgent`** → `beforeReturn` 在 return 前(可回灌继续),`afterAgent` 在 return 后(只观察)。两者并存不冲突。

## 风险

- **死循环**:`maxVerifyAttempts` 兜底 + `rounds` 仍受 `maxToolRounds` 上限约束(双保险)。
- **feedback 质量决定自纠有效性**:check 写得烂会让 agent 越改越糟 → 文档给"好的 check 该返回具体、可操作的 feedback"指引。
- **写后读回的时序**:windowOps 写入(setByPath)同步更新值,readByPath 读底层值即可见新值,**无需 nextTick**(原设想的 reactive 异步仅影响 effect 调度/渲染,不影响数据读;经 code-review 澄清,已移除 nextTick + verify.ts 的运行时 vue 依赖,回归 type-only import)。
- **对抗验证子 agent 误报**:找茬 agent 可能无中生有 → feedback 经主 agent 自行判断,且 `maxAttempts` 限制波及范围。

## 落地点(文件清单)

| 文件 | 改动 |
|---|---|
| `src/core/harness/createAgent.ts` | `state.verifyAttempts`;第 310 行插 `beforeReturn` 钩子点;`maxVerifyAttempts` 配置 |
| `src/core/harness/middleware.ts` | `Middleware` 加 `beforeReturn?`;`runBeforeReturn` 执行器 |
| `src/core/harness/state.ts` | `HarnessState` 加 `verifyAttempts: number`(`createInitialState` 初始化 0) |
| `src/core/harness/verify.ts`(新) | `createVerifyMiddleware` + `createWriteBackCheck` + 对抗验证分支 |
| `src/core/sdk/createPageAgent.ts` | `PageAgentOptions.verify?` + `capabilities.verify`;装载 verify 中间件 |
| `types/index.ts` + `types/index.d.ts` | `VerifyCheck` / `VerifyMiddlewareOptions` / `VerifyOptions` 类型 + 导出 |
| `src/core/index.ts` | 导出 `createVerifyMiddleware` / `createWriteBackCheck` |
| `src/core/__tests__/selftest.ts` | `runBeforeReturn` 执行器 / `createWriteBackCheck` 读回验证 / 自纠计数兜底 纯函数测试 |
| `CLAUDE.md` + `doc/usage-guide.md` | verify 用法 + 能力开关依赖说明 |
