# Design: fix-context-window-stale-on-setllm

> 关联 `proposal.md`。本文记录技术决策与实现细节。

## §1 现状:contextWindow 的 5 个固化点(逐行证据)

| # | 消费点 | 代码 | 固化方式 |
|---|---|---|---|
| 1 | createAgent offload 阈值 | `createAgent.ts:270-278` | `const caps = resolveModelCaps(...)` + `const offloadThreshold = offloadThresholdChars(caps.contextWindow)` + `const offloadPassThrough = offloadPassThroughChars(caps.contextWindow)`,均为局部 const |
| 2 | summarization 压缩阈值 | `useContextManager.ts:74` `const config = { ...DEFAULT, ...opts }` → `:118-120` `compress` 用 `config.contextWindow * summaryThresholdRatio` | config 构造快照;但 `:232` `return { compress, config }` —— **config 是共享对象引用,改 `config.contextWindow` compress 下次即读到新值** |
| 3 | contextInspector 占比 | `createChatSdk.ts:952-956` `createContextInspectorMiddleware({ contextWindow: modelCaps.contextWindow, ... })` | 传入后中间件内部快照(待 apply 时确认中间件内部存法) |
| 4 | resolveContextOptions | `createChatSdk.ts:697` `resolvedCtxOpts = resolveContextOptions(options, modelCaps.contextWindow)` → `:1086-1094` 展开传 createSummarizationMiddleware | 一次性对象;展开后 summarization 内部另构 config,改 `resolvedCtxOpts` 不影响已构造中间件 |
| 5 | onLlmChange 回灌缺失 | `createChatSdk.ts:1796-1805` | 重算 `modelCaps` 但只 `modelCaps = resolveModelCaps(...)` 赋局部变量;注释「影响 offload 阈值/压缩」与实现不符 |

## §2 当前数据流(setLlm 触发链)

```
sdk.setLlm(newLlm)                          // 用户/集成方调用
  → core.agent.setLlm(newLlm)               // createChatSdk 委派
    → createAgent.setLlm (createAgent.ts:762-766):
        llm = newLlm
        rebindTools()
        onLlmChange?.(newLlm)               // 回调 SDK
          → SDK onLlmChange (createChatSdk.ts:1796-1805):
              modelCaps = resolveModelCaps(...)   // 重算,只存局部 ❌ 不回灌
              currentLlm = newLlm
```

**断点**:onLlmChange 重算的 `modelCaps` 没有流向任何消费点(#1-#4 全部陈旧)。

## §3 方案对比

### 方案 A:`onLlmChange` 回调返回 `ModelCaps`

- `onLlmChange` 签名从 `(newLlm) => void` 改为 `(newLlm) => ModelCaps | void`;`createAgent.setLlm` 用返回值重算 offload(`const` → `let`)。
- SDK onLlmChange:重算 modelCaps → 更新 ctxManager.config + contextInspector + `return modelCaps`。
- **优**:数据流单向清晰(回调返回,createAgent 消费);createAgent 仍是 offload owner。
- **缺**:onLlmChange 返回值语义变化(void → ModelCaps|void),回调「有返回值」不直观;contextInspector 仍需单独入口。

### 方案 B:独立 setter(推荐 ✅)

- `createAgent` 加 `setModelCaps(caps)`;各中间件工厂返回 `{ middleware, setContextWindow }`(controller 模式)。
- SDK onLlmChange:重算 modelCaps → `core.agent.setModelCaps(modelCaps)` + `summarizationMw.setContextWindow(cw)` + `contextInspectorMw.setContextWindow(cw)` + 闭包更新。
- **优**:与 SDK setter 风格一致(`setLlm`/`setTools`/`setData`);各组件自管、可独立单测;onLlmChange 保持 void;复用 focusMw 已验证 controller 模式;新增中间件天然支持。
- **缺**:新增 3 个接口(`setModelCaps` + 2 个 `setContextWindow`)。

### 方案 C:全 getter(动态读 live contextWindow)

- contextWindow 做成 getter 函数 `() => liveCw`,各处 compress/offload 调用时求值。
- **优**:最「动态」,零 setter。
- **缺**:改面大(每处 const → 函数调用);`useContextManager` config 结构变(字段从 number 变 function);破坏现有 `config.contextWindow` 直读契约。

**决策:选 B**。理由见 proposal Decision #1-#2:风格一致 + 可独立单测 + controller 模式复用 + onLlmChange 不破坏。

## §4 实现细节(方案 B)

### 4.1 `createAgent.setModelCaps`

```ts
// createAgent.ts: caps/offloadThreshold/offloadPassThrough 从 const 改 let
let caps = resolveModelCaps({ ... })
let offloadThreshold = offloadThresholdChars(caps.contextWindow)
let offloadPassThrough = offloadPassThroughChars(caps.contextWindow)

function setModelCaps(newCaps: ModelCaps): void {
  caps = newCaps
  offloadThreshold = offloadThresholdChars(caps.contextWindow)
  offloadPassThrough = offloadPassThroughChars(caps.contextWindow)
  // maxTokens 缺省若依赖 caps.maxOutputTokens 且未显式传,考虑是否更新(见边界)
}

// 返回对象加 setModelCaps
return { ..., setLlm, setModelCaps, ... }
```

### 4.2 中间件工厂 controller 模式

`createSummarizationMiddleware`:
```ts
// harness/summarization.ts
export function createSummarizationMiddleware(opts) {
  const ctxManager = useContextManager(opts)   // 已返回 { compress, config }
  const middleware: Middleware = { ... 用 ctxManager.compress ... }
  return Object.assign(middleware, {
    setContextWindow(cw: number) { ctxManager.config.contextWindow = cw }  // 共享引用,compress 即读新值
  })
}
```

`createContextInspectorMiddleware`:同模式,内部快照改 `let`,加 `setContextWindow`(apply 时确认中间件内部 contextWindow 存法,可能是闭包变量)。

### 4.3 `createChatSdk` onLlmChange 集中回灌

```ts
// createChatSdk.ts:1796 onLlmChange
onLlmChange: (newLlm) => {
  const cfg = isChatModel(newLlm) ? undefined : (newLlm as LLMConfig)
  modelCaps = resolveModelCaps({ model: ..., contextWindow: ..., maxOutputTokens: ... })
  currentLlm = newLlm
  // 新增:集中回灌
  core.agent.setModelCaps?.(modelCaps)
  summarizationMw?.setContextWindow?.(modelCaps.contextWindow)
  contextInspectorMw?.setContextWindow?.(modelCaps.contextWindow)
  core.infoTick.value++   // 触发 inspect/DebugDrawer 刷新(inspect().context 读最新)
}
```

## §5 边界与风险

- **caps 声明优先级不变**:`resolveModelCaps` 仍是 `集成方显式声明 > model 名查表 > 缺省`;setLlm 后用新 model 重解析,优先级链一致。
- **中间件未装时**:`useSummarization=false` / `useContextInspector=false` → 对应中间件变量 undefined,`?.setContextWindow?.()` 安全 no-op。
- **maxTokens 缺省**:`resolvedMaxTokens = maxTokens ?? caps.maxOutputTokens`(createAgent.ts:275);setModelCaps 后若用户未显式传 maxTokens,理论应跟随新 caps.maxOutputTokens。本 change 聚焦 contextWindow(压缩/offload),maxTokens 跟随作为**可选附带**(design 标注,apply 时定)。
- **switchSession 不涉及**:会话切换不改模型,modelCaps 不变;历史恢复后下一轮 compressInput 用(现已正确的)contextWindow 收敛。
- **不影响 trimMemoryMessages**:轮数维度,与 contextWindow 正交,本 change 不碰。

## §6 测试策略

- **selftest(逻辑层)**:
  - `createAgent.setModelCaps`:offloadThreshold 前后断言(小 caps → 小阈值)。
  - `createSummarizationMiddleware.setContextWindow`:改后 `ctxManager.config.contextWindow` 更新;`compress` 在新阈值下触发(构造超新窗口 token 的 rounds)。
  - `createContextInspectorMiddleware.setContextWindow`:占比重算。
- **e2e(集成层)**:`sdk.setLlm(小窗口 LLMConfig)` → `inspect().context.contextWindow` 反映新值;inspect().model 反映新模型。
- **不依赖真 LLM**:setter 是同步纯逻辑,FAKE_LLM 可验集成层 inspect 反映。
