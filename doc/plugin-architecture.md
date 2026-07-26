# Capability Plugin 架构设计

> 目标:把「JSON 修改 / 创作 / 页面生成」等业务能力从 `createChatSdk` 核心抽离为**可插拔能力包(Capability Plugin)**,让核心稳定不膨胀,新能力以独立模块按需装配。
> 状态:**设计稿,待 review**。本文不含实现代码,只定接口与装配管线。

---

## 1. 背景与动机

### 1.1 现状问题

`createChatSdk` 顶层硬编码了 `dataSlotOps` 能力包的 7 处横切关注点:

| # | 位置 | 横切关注点 |
|---|---|---|
| 1 | `createDataSlotOps(dataSlots, { onConflict })` | 工具集装配 |
| 2 | `dataSlotOpsController` | 注册表控制器(动态增删) |
| 3 | `liveDataSlots()` | 供 inspect/verify/summarization 读最新注册表 |
| 4 | `READONLY_FOR_ADVERSARIAL` | 对抗 verify 的只读工具白名单 |
| 5 | `createWriteBackCheck({ schemas: liveDataSlots })` | verify 默认 check 的 schema 来源 |
| 6 | `getRegisteredSlots` + `preserveLastToolResults` | summarization 压缩时注入注册表快照 + 保留 describe/list 结果 |
| 7 | checkpoint `slotPaths` + `pendingConflict`/`resolveConflict` | checkpoint 回滚范围 + 冲突挂起 API |

这些是「dataSlotOps 能力包」的横切逻辑,却散在核心。后期加「创作」「页面生成」会有同类横切,又堆进核心 → `createChatSdk` 越来越臃肿,且核心与业务能力耦合,难以独立测试/独立发布。

### 1.2 设计目标

- **核心稳定**:createChatSdk 核心只做装配管线,不随业务能力增加而改动
- **能力独立**:每个能力包独立模块、独立测试、可独立 npm 包
- **按需装配**:集成方只装需要的 plugin,tree-shaking 友好
- **能力依赖**:能力间可声明依赖(如 pageBuilder 复用 dataSlotOps)
- **向后兼容**:现有 `dataSlots`/`capabilities.dataSlotOps`/`addDataSlot` 等 API 不变,透传到 plugin

### 1.3 非目标

- 不重写 harness 核心(ReAct 循环、中间件契约不变)
- 不改现有公开 API 签名(向后兼容)
- 不强制所有能力立刻 plugin 化(渐进迁移)

---

## 2. 核心抽象:CapabilityPlugin

```ts
// src/core/plugin/types.ts(新增)

export interface CapabilityPlugin {
  /** 唯一标识,如 'dataSlotOps' / 'creation' / 'pageBuilder' */
  name: string
  /** 人类可读描述,供 inspect/debug 展示 */
  description?: string

  /** 默认是否启用(集成方可经 capabilities[name] 覆盖);默认 true */
  defaultEnabled?: boolean
  /** 依赖的其他 plugin name;装配前按依赖排序,缺失则报错或 warn */
  requires?: string[]
  /** 装载顺序提示(小的先;同 order 按 requires 拓扑序);默认 100 */
  order?: number

  /** 工具集(可空;返回的工具并入主工具池,source 标 'plugin:<name>') */
  tools?: (ctx: PluginContext) => StructuredToolInterface[] | Promise<StructuredToolInterface[]>
  /** 中间件(可空;按返回顺序拼到内置中间件栈的「用户自定义」之前) */
  middlewares?: (ctx: PluginContext) => Middleware[]
  /** systemPrompt 片段(拼接到主 systemPrompt 后;augmentPrompt 语义) */
  systemPromptFragment?: (ctx: PluginContext) => string | undefined

  /** 挂到 sdk 实例的方法(如 addDataSlot/removeDataSlot/listDataSlots) */
  api?: (ctx: PluginContext) => Record<string, (...args: any[]) => any>
  /** 暴露到 sdk 的响应式状态(如 pendingConflict: Ref) */
  state?: (ctx: PluginContext) => Record<string, Ref<any>>
  /** 贡献到 inspect() 的字段(如 { dataSlots: [...] }) */
  inspect?: (ctx: PluginContext) => Record<string, unknown>

  /** 向通用中间件注入横切关注点(关键:让 plugin 不硬编码进核心) */
  hooks?: PluginHooks

  /** 装配时调用(可选):做一次性初始化,如创建 controller、注册全局副作用 */
  setup?: (ctx: PluginContext) => void | Promise<void>
  /** 卸载时调用(可选):清理副作用、释放资源 */
  teardown?: (ctx: PluginContext) => void
}

export interface PluginHooks {
  /** 压缩时注入注册表快照(防 LLM 基于过时记忆操作已卸载动态组件) → summarization */
  registeredSlots?: () => { path: string; description: string }[]
  /** 跨轮摘要时保留这些工具的 result 摘要片段 → summarization.preserveLastToolResults */
  preserveToolResults?: string[]
  /** verify 默认 check 的 path→schema 来源(动态取最新) → verify.createWriteBackCheck */
  writeBackSchemas?: () => Record<string, unknown>
  /** checkpoint 整体回滚的 path 范围 → checkpoint.slotPaths */
  checkpointPaths?: () => string[]
  /** 对抗 verify 子 agent 的只读工具白名单 → verify.adversarial */
  readonlyTools?: string[]
  /** 能力用法提示(按 caps 注入;全关返回 undefined) → usageHints */
  usageHint?: (ctx: PluginContext) => string | undefined
}
```

---

## 3. PluginContext

plugin 与核心、plugin 与 plugin 之间经 `PluginContext` 通信:

```ts
export interface PluginContext {
  /** 原始配置(只读视图;plugin 读自己关心的字段) */
  options: Readonly<ChatSdkOptions>
  /** 解析后的能力开关(经 defaultEnabled + capabilities 覆盖) */
  capabilities: Record<string, boolean>
  /** LLM 实例(供 plugin 构造子 agent/verify 用) */
  llm: ChatModelLike
  /** 对话消息响应式数组(供 plugin 读写) */
  messages: Ref<Message[]>
  /** vfs store(vfs 启用时) */
  vfsStore?: VfsStore
  /** SDK 事件 emit(供 plugin 发自定义事件) */
  emit: SdkEventHandler

  /** plugin 间共享对象(按 name 存取;供依赖的 plugin 拿上游句柄) */
  shared: Map<string, PluginInstance>
  /** 已装配的依赖 plugin 句柄(按 requires 解析) */
  deps: Record<string, PluginInstance>

  /** 核心提供的工具函数(供 plugin 复用,如 readSlotPath) */
  utils: PluginUtils
}

export interface PluginInstance {
  name: string
  api: Record<string, (...args: any[]) => any>
  state: Record<string, Ref<any>>
  hooks: PluginHooks
}

export interface PluginUtils {
  /** 读取某 path 的当前值(经安全序列化) */
  readSlotPath?: (path: string) => unknown
  // ...按需扩展
}
```

**`shared` vs `deps`**:`deps` 是声明式依赖句柄(`requires` 解析后核心注入),`shared` 是任意 plugin 往里塞的共享对象(供未声明依赖的临时协作)。优先用 `deps`(显式)。

---

## 4. 通用 harness vs plugin 界线

| 类别 | 归属 | 说明 |
|---|---|---|
| ReAct 循环、中间件执行器、retry、格式自纠 | **核心 harness** | 任何 agent 都需要,与业务无关 |
| summarization(上下文压缩) | **核心**(但内容由 plugin hooks 注入) | 通用能力;`registeredSlots`/`preserveToolResults` 从 hooks 读 |
| memory、subagent、approval、checkpoint | **核心**(checkpoint 的 `slotPaths` 从 hooks 读) | 通用 agent 能力 |
| sdk-events、hook、inspect 框架 | **核心** | 事件/检视基础设施 |
| dataSlotOps(13 工具 + 冲突挂起 + 注册表快照注入 + verify 默认 check + checkpoint slotPaths + usageHints 片段) | **plugin** `dataSlotPlugin` | 业务能力 |
| 创作(待建) | **plugin** `creationPlugin` | 业务能力 |
| 页面生成(待建,可能复用 dataSlotOps) | **plugin** `pageBuilderPlugin` | 业务能力 |

**判定原则**:若某能力「换一个 agent 用途就不需要」(如 JSON 修改、创作、页面生成)→ plugin;若「任何 agent 都需要」(如上下文压缩、记忆、子 agent)→ 核心(但其业务相关内容由 hooks 注入)。

---

## 5. 装配管线

`createChatSdk` 核心瘦身为装配管线:

```ts
createChatSdk({
  container, llm, systemPrompt,
  // 新:plugin 数组(高级用法/新能力)
  plugins: [dataSlotPlugin(), creationPlugin(), pageBuilderPlugin()],
  // capabilities 覆盖 plugin 默认开关
  capabilities: { dataSlotOps: true, creation: false, pageBuilder: true },
  // 旧 API 保留(向后兼容,透传给对应 plugin):
  dataSlots: [...],              // → dataSlotPlugin.tools()
  tools: [...],                  // → 直接并入工具池,source='user'
  middleware: [...],             // → 拼到栈末尾
  skills: [...], memory: '...',  // → 对应核心中间件
  // presets 改为 plugins 数组预设组合:
  // presets: pageBuilderPreset = { plugins: [dataSlotPlugin(), pageBuilderPlugin()], systemPrompt: '...' }
})
```

核心装配步骤:

1. **解析 plugins**:`options.plugins ?? [dataSlotPlugin()]`(默认仍装 dataSlot,保持零配置)
2. **合并 capabilities**:`capabilities[name] ?? plugin.defaultEnabled ?? true`
3. **拓扑排序**:按 `requires` + `order` 排序,循环依赖报错
4. **构造 PluginContext**:注入 options/caps/llm/messages/vfs/emit/shared/utils
5. **逐 plugin setup()**:按序调 `setup(ctx)`,plugin 往 `ctx.shared` 塞 controller 等
6. **收集**:tools / middlewares / systemPromptFragment / api / state / inspect,按序合并
7. **注入通用中间件 hooks**:从所有 plugin 的 hooks 聚合,传给 summarization/verify/checkpoint/usageHints
8. **装配 harness**:内置中间件 + plugin 中间件 + 用户 middleware,工具池 = plugin tools + 用户 tools
9. **暴露 sdk 实例**:messages/send/stream/inspect/hook + plugin 贡献的 api/state

### hooks 聚合规则

多个 plugin 可能贡献同名 hook,聚合策略:

| hook | 聚合方式 |
|---|---|
| `registeredSlots` | 数组拼接(summarization 注入所有 plugin 的注册表) |
| `preserveToolResults` | 数组并集 |
| `writeBackSchemas` | 对象合并(后装覆盖先装,同 path 以最后声明者为准) |
| `checkpointPaths` | 数组并集 |
| `readonlyTools` | 数组并集 |
| `usageHint` | 字符串拼接(各 plugin 贡献一行,全空则 undefined) |

---

## 6. dataSlotOps 迁移示例(第一个 plugin)

### 6.1 现有耦合点 → plugin 映射

| 现有耦合点(见 §1.1) | 迁移到 plugin 的位置 |
|---|---|
| 1 `createDataSlotOps(dataSlots, { onConflict })` | `tools(ctx)` |
| 2 `dataSlotOpsController` | `setup(ctx)` 里创建,塞 `ctx.shared`;`api` 用它 |
| 3 `liveDataSlots()` | plugin 内部闭包;`hooks.writeBackSchemas`/`registeredSlots` 用 |
| 4 `READONLY_FOR_ADVERSARIAL` | `hooks.readonlyTools` |
| 5 `createWriteBackCheck({ schemas })` | 核心从 `hooks.writeBackSchemas` 聚合后构造 |
| 6 `getRegisteredSlots` + `preserveLastToolResults` | `hooks.registeredSlots` + `hooks.preserveToolResults` |
| 7 checkpoint `slotPaths` + `pendingConflict`/`resolveConflict` | `hooks.checkpointPaths` + `state.pendingConflict` + `api.resolveConflict` |

### 6.2 dataSlotPlugin 骨架(示意,非实现)

```ts
export function dataSlotPlugin(): CapabilityPlugin {
  return {
    name: 'dataSlotOps',
    description: '规范化 JSON 数据槽操作(注册表 + schema 校验 + 增量 patch + 快照回退 + 乐观锁)',
    defaultEnabled: true,
    order: 50,  // 基础能力,先装

    setup(ctx) {
      const controller = { /* 注册表闭包 */ }
      ctx.shared.set('dataSlotOps.controller', controller)
      ctx.shared.set('dataSlotOps.pendingConflict', ref(null))
    },

    tools(ctx) {
      const controller = ctx.shared.get('dataSlotOps.controller')
      const pendingConflict = ctx.shared.get('dataSlotOps.pendingConflict')
      return createDataSlotOps(ctx.options.dataSlots || [], {
        onConflict: (info) => { pendingConflict.value = info },  // 挂起
        maxSnapshots: ctx.options.maxSnapshots,
        onAudit: ctx.options.debug ? (e) => console.log('[audit]', e) : undefined,
      })
    },

    middlewares() { return [] },  // dataSlotOps 无独立中间件

    systemPromptFragment(ctx) {
      return ctx.options.systemPrompt ? undefined : reliableWriteRulesFragment
    },

    api(ctx) {
      const controller = ctx.shared.get('dataSlotOps.controller')
      return {
        addDataSlot: (spec) => controller.add(spec),
        removeDataSlot: (path) => controller.remove(path),
        listDataSlots: () => controller.list(),
        resolveConflict: (action) => { /* 收口挂起 */ },
      }
    },

    state(ctx) {
      return { pendingConflict: ctx.shared.get('dataSlotOps.pendingConflict') }
    },

    inspect(ctx) {
      const controller = ctx.shared.get('dataSlotOps.controller')
      return { dataSlots: controller.list().map((p) => ({ path, description, schema })) }
    },

    hooks: {
      registeredSlots: () => controller.list().map((p) => ({ path: p.path, description: p.description })),
      preserveToolResults: ['read'],
      writeBackSchemas: () => Object.fromEntries(controller.list().map((p) => [p.path, p.schema])),
      checkpointPaths: () => (ctx.options.dataSlots ?? []).map((w) => w.path),
      readonlyTools: ['read', 'get_slot_paths', 'search_data_slot'],
      usageHint: (ctx) => ctx.capabilities.dataSlotOps && ctx.options.dataSlots?.length
        ? '修改前先 read 拿当前值(含 hash);write 自动乐观锁防覆盖(无需手传 expectedHash);误改可用 restore_data_snapshot 回退。'
        : undefined,
    },
  }
}
```

### 6.3 通用中间件 hook 化清单

核心中间件选项从「硬编码 dataSlot 名」改为「从 plugin hooks 读」:

| 中间件 | 现有硬编码 | 改为 |
|---|---|---|
| `summarization` | `getRegisteredSlots: () => liveDataSlots()...` | `getRegisteredSlots: () => aggregate(plugins, p => p.hooks.registeredSlots?.())` |
| `summarization` | `preserveLastToolResults: ['describe_data_slot','list_data_slots']` | `preserveLastToolResults: aggregate(plugins, p => p.hooks.preserveToolResults ?? [])` |
| `verify` | `createWriteBackCheck({ schemas: liveDataSlots })` | `createWriteBackCheck({ schemas: () => merge(plugins.map(p => p.hooks.writeBackSchemas?.())) })` |
| `verify` adversarial | `READONLY_FOR_ADVERSARIAL` 常量 | `tools: allTools.filter(t => aggregate(plugins, readonlyTools).includes(t.name))` |
| `checkpoint` | `slotPaths: dataSlots.map(w => w.path)` | `slotPaths: () => aggregate(plugins, checkpointPaths)` |
| `usageHints` | 按 caps 硬编码 dataSlot 提示 | `hints: () => plugins.map(p => p.hooks.usageHint?.(ctx)).filter(Boolean).join('\n')` |

---

## 7. 向后兼容策略

现有公开 API 不变,核心透传到对应 plugin:

| 现有 API | 透传去向 |
|---|---|
| `options.dataSlots` | `dataSlotPlugin.tools(ctx)` 读 `ctx.options.dataSlots` |
| `options.capabilities.dataSlotOps` | 覆盖 `dataSlotPlugin.defaultEnabled` |
| `options.maxSnapshots` | `dataSlotPlugin.tools()` 透传 |
| `sdk.addDataSlot`/`removeDataSlot`/`listDataSlots` | `dataSlotPlugin.api()` |
| `sdk.pendingConflict`/`resolveConflict` | `dataSlotPlugin.state()`/`api()` |
| `inspect().dataSlots` | `dataSlotPlugin.inspect()` |
| `options.tools`/`middleware` | 直接并入工具池/中间件栈(source='user',不变) |

**默认行为不变**:不传 `plugins` 时,核心默认 `[dataSlotPlugin()]`,与现状等价。集成方显式传 `plugins` 即走新装配。

**迁移期**:旧 options 字段(`dataSlots`/`maxSnapshots` 等)继续支持,核心识别后注入 `dataSlotPlugin` 的 ctx.options。未来版本可在文档标记「建议改用 `plugins: [dataSlotPlugin({ dataSlots, maxSnapshots })]`」,但旧写法至少保留一个大版本。

---

## 8. 渐进迁移步骤

### Step 1(本次,~1-2 天):抽 dataSlotPlugin + 通用中间件 hook 化
- 新增 `src/core/plugin/types.ts` + `plugin/registry.ts`(装配管线)
- 抽 `dataSlotPlugin()`(从 createChatSdk 移出 §1.1 的 7 处耦合)
- 通用中间件(summarization/verify/checkpoint/usageHints)选项改从聚合 hooks 读
- 对外 API 完全不变;selftest 384 + e2e 125 全绿
- 验收:核心 createChatSdk 不再 import `dataSlotOps.ts`,只 import `plugin/registry`

### Step 2(后续):presets 改 plugins 组合 + 文档
- `presets.pageBuilder/researcher/minimal` 改为 `{ plugins: [...], systemPrompt: '...' }`
- 文档鼓励新能力以 plugin 形式提供
- `inspect()` 增加 `plugins` 字段(列出已装 plugin + 开关状态)

### Step 3(后期):加创作/页面生成 plugin
- 按需补 `PluginHooks` 字段(如 `previewRenderer`/`contentValidator`)
- 验证抽象够用,迭代接口

---

## 9. 测试策略

| 层 | 测试 | 覆盖 |
|---|---|---|
| 单元(selftest) | 新增 `plugin/registry` 测试模块 | 拓扑排序、hooks 聚合、依赖缺失报错、teardown 清理 |
| 单元(selftest) | `dataSlotPlugin` 测试 | tools/api/state/inspect/hooks 各字段正确;与现有 dataSlotOps 行为等价 |
| 集成(e2e) | 装配管线 e2e | `plugins:[dataSlotPlugin()]` 与旧 `dataSlots:` 写法行为一致;`capabilities.dataSlotOps:false` 关闭;`inspect().plugins` 含 |
| 集成(e2e) | 多 plugin 协作 | 两个 plugin(可用 fake plugin)hooks 聚合正确 |
| 回归 | 现有 384+125 全绿 | API 不变 |

**测试同步约定**:Step 1 实施时同步补 selftest `plugin` 模块 + e2e `plugins.mjs`,与代码同 commit。

---

## 10. 风险与未决问题

| 风险 | 缓解 |
|---|---|
| 抽象层增加复杂度(PluginContext/依赖解析) | 接口最小化;`shared`/`deps` 二选一,优先 `deps` |
| 向后兼容透传逻辑易漏 | e2e 全量回归 + 旧 options 字段逐项 e2e 覆盖 |
| 通用中间件 hook 化是侵入式改造 | Step 1 一次性完成,后续中间件不再改 |
| plugin 间隐式协作(经 shared)难追踪 | `shared` 仅作 escape hatch,显式 `requires`/`deps` 优先;inspect 暴露 shared key |
| 未来能力(创作/页面生成)需求未定,接口可能不够 | Step 3 按需补 hook;预留 `hooks` 为可扩展对象 |
| 异步 setup/tools 的加载顺序 | 装配管线 await;但工具池构造若异步会延迟 mount,需评估 |

**未决**:
- `creationPlugin`/`pageBuilderPlugin` 的具体 hook 需求(待后期补)
- 是否支持 plugin 独立 npm 包(`@page-agent-sdk/plugin-creation`):Step 3 评估
- `shared` 是否需要类型化(泛型 `shared.get<T>`):先 `Map<string, unknown>`,后期按需加泛型

---

## 11. 未来能力 plugin 示意(待细化)

> 本节仅示意接口预留,具体待后期需求明确后补。

### 11.1 creationPlugin(创作能力)
- `tools`: 文本生成/改写/润色/翻译工具
- `middlewares`: 风格约束中间件(augmentPrompt 注入风格指南)、内容审核中间件(afterModel 校验输出)
- `hooks.contentValidator`: verify 阶段校验内容合规
- `systemPromptFragment`: 创作身份与风格说明

### 11.2 pageBuilderPlugin(前端页面生成)
- `requires: ['dataSlotOps']`(复用 JSON 操作能力读写页面 schema)
- `tools`: 组件插入/布局调整/样式生成工具(部分可能包装 dataSlot 工具)
- `middlewares`: 预览中间件(每轮 afterAgent 渲染预览)、可访问性检查
- `hooks.previewRenderer`: 预览渲染钩子
- `deps.dataSlotOps`: 拿 dataSlot controller 注册页面 schema

---

## 12. 决策点(review 请确认)

1. **plugin 接口字段是否够用**:`tools/middlewares/systemPromptFragment/api/state/inspect/hooks/setup/teardown` 是否有遗漏?
2. **hooks 聚合策略**(§5 表)是否合理?特别是 `writeBackSchemas` 的「后装覆盖先装」语义。
3. **向后兼容**(`dataSlots` 等旧字段透传)保留多久?建议至少到 3.0。
4. **默认 plugin**:不传 `plugins` 时默认 `[dataSlotPlugin()]`,还是改为 `[]`(强制显式装配)?建议前者(零配置)。
5. **`shared` vs `deps`**:是否只保留 `deps`(显式依赖),去掉 `shared`(隐式协作)?倾向保留 `shared` 作 escape hatch 但文档不鼓励。
6. **Step 1 是否独立发版**:Step 1 不改 API,可作 minor;Step 2/3 视改动定。

---

> review 通过后,Step 1 实施按 §8 + §9 执行,代码与测试同 commit。
