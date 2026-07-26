# page-agent-sdk 功能架构

> 框架无关的「页面内 Agent」JS SDK。Agent 通过自定义 tool 读写宿主页面 `window` 对象(schema 校验 + 乐观锁),并具备 planning / skills / 内存工作区 / context 管理 / 冲突人工介入能力。
> 核心为**自研 Deep Agents 风格 harness**(ReAct + 可插拔中间件),不引入 LangGraph/langchain 整包(规避 [`deepagentsjs#292`](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。

本文从六个视角描述:**分层结构**、**组装与挂载**、**ReAct 主循环**、**数据操作与乐观锁**、**冲突人工介入**、**上下文压缩与持久化**。

---

## ① 分层结构

```mermaid
flowchart TD
  subgraph Host["🖥️ 宿主页面(任意网页)"]
    WP["主数据 bind = {...}<br/>(reactive 或普通对象,SDK 不强制)"]
  end

  subgraph SDK["📦 page-agent-sdk SDK — 框架无关,Vue 打包进,使用者无需装 Vue"]
    Entry["<b>对外入口</b><br/>createChatSdk(container, llm, data, tools, skills, memory)<br/>.mount() / .unmount() / .send() / .resolveConflict()"]
    Core["<b>harness 核心</b> createAgent<br/>ReAct 循环 + 中间件契约(before/wrap/after)"]
    MW["<b>中间件栈(可插拔)</b><br/>usageHints → todos → skills → vfs → summarization<br/>→ memory → permissions → verify → subagent → 用户 → sdkEvent"]
    Tools["<b>工具层</b><br/>内置: dataOps · fetchDoc · vfs_*<br/>用户: defineTool(...) / defineSkill(...)"]
    State["<b>状态 / 数据</b><br/>HarnessState · 主数据 · vfs store · 快照栈 · pendingConflict"]
    UI["<b>UI</b><br/>ChatDialog(对话框+冲突条+确认条) · DebugDrawer"]
    Entry --> Core --> MW --> Tools --> State
    Tools -. "直接读写 bind(reactive/普通对象,不挂 window)" .-> WP
    UI -. "响应式绑定 + pendingConflict" .-> State
  end
```

### 分层职责

| 层 | 职责 | 关键源文件 |
|---|---|---|
| **对外入口** | 命令式 API,组装 harness + 内置工具/中间件,挂载 UI,暴露冲突解决 | `src/core/sdk/createChatSdk.ts`、`defineTool.ts` |
| **harness 核心** | ReAct 循环 + 中间件生命周期 + 格式自纠 + verify 自纠 | `src/core/harness/createAgent.ts`、`middleware.ts`、`state.ts` |
| **中间件栈** | 可插拔能力(planning/skills/工作区/压缩/记忆/权限/verify/subagent) | `src/core/harness/{todos,skills,summarization,memory,permissions,verify,subagent,usageHints}.ts` |
| **工具层** | Agent 可调用的能力(数据操作含乐观锁/抓文档/工作区/自定义) | `src/core/tools/{dataOps,fetchDoc}.ts`、`backends/vfs.ts`、`utils/offload.ts` |
| **状态/数据** | 运行态 + 主数据 + 工作区 + 快照栈 + 冲突挂起 | `HarnessState`、主数据 bind、`VfsStore`、`pendingConflict` ref |
| **UI(通用)** | 对话框 + 调试抽屉 + 冲突条 + 确认条(SDK 内) | `src/core/components/{ChatDialog,DebugDrawer}.vue` |

---

## ② 组装与挂载流程

```mermaid
flowchart TD
  A["createChatSdk(options)"] --> B{"shareContext?"}
  B -->|是| C{"sharedCores 有同 id?"}
  C -->|有| D["复用现有 AgentCore"]
  C -->|无| E["buildCore"]
  B -->|否| E
  E --> E1["resolveStorage 持久化后端"]
  E --> E2["resolveModelCaps 模型能力"]
  E --> E3["createVfs + VfsStore"]
  E --> E4["createDataOps<br/>注入 onConflict=setPendingConflict"]
  E --> E5["selectBuiltinTools 筛选(capabilities)"]
  E --> E6["组装中间件栈<br/>usageHints→todos→skills→vfs→summarization→memory<br/>→permissions→verify→subagent→用户→sdkEvent"]
  E --> E7["connectMcp 远程工具注入"]
  E --> E8["createAgent harness"]
  E --> E9["core 对象含 pendingConflict ref"]
  D --> F["core.refCount++"]
  F --> G["返回 sdk 实例"]
  G --> H["mount()"]
  H --> I["await core.initDone"]
  I --> J{"ui === false?"}
  J -->|是 headless| K["装 flush 兜底 返回"]
  J -->|default| L["createApp(Wrapper)"]
  L --> M["h(ChatDialog, 传 pendingConflict/onResolveConflict)"]
  M --> N["vueApp.mount(el)"]
  N --> O["装 pagehide/visibility flush"]
```

**要点:**
- `shareContext` 复用 core 时,`pendingConflict` ref 也共享——同 id 多实例是「同一 agent 的多对话框视图」,共享冲突 UI 一致
- `dataOps` 关闭(`capabilities.dataOps:false`)时不注入 `onConflict`,`pendingConflict` 永远 null,无副作用

---

## ③ ReAct 主循环(含中间件钩子 + 格式自纠 + verify 自纠)

```mermaid
flowchart TD
  S["send/stream 入口"] --> B0["beforeAgent (正序)"]
  B0 --> LOOP{"rounds < maxToolRounds?"}
  LOOP -->|是| W0["wrapModelCall (洋葱进入)"]
  W0 --> BF["beforeModel (正序)<br/>todos 推进 / skills 加载 / summarization 压缩"]
  BF --> MC["coreModelCall<br/>withRetry(网络/429/5xx)"]
  MC --> RESP{response}
  RESP --> TC{有 tool_calls?}
  TC -->|有| WT["wrapToolCall (洋葱)<br/>permissions 校验 / approval 人工确认 / vfs 大结果外存"]
  WT --> EX["执行工具<br/>dataOps(含乐观锁冲突挂起) / fetchDoc / vfs / 用户工具"]
  EX --> AM["afterModel (逆序)"]
  AM --> LOOP
  TC -->|无| FG{"detectGarbledToolCall?<br/>(formatRetries < 2)"}
  FG -->|是乱码工具调用| FB["注入 feedback HumanMessage<br/>formatRetries++"]
  FB --> LOOP
  FG -->|否| BR["beforeReturn (正序)<br/>verify check?"]
  BR --> VR{"verify 需自纠?<br/>(attempts < max)"}
  VR -->|是| VF["feedback 回灌 user 消息<br/>verifyAttempts++"]
  VF --> LOOP
  VR -->|否| AR["afterAgent (逆序)"]
  AR --> RT["返回最终结果"]
  MC -.abort.-> EXA["coreModelCall 不抛<br/>返回 aborted + partial"]
  WT -.abort.-> EXA
```

> 钩子顺序:**before 类正序、after 类逆序、wrap 类洋葱(reduceRight)**。
> `formatRetries` / `verifyAttempts` 均为 **per-run**(每次 stream/invoke 调用重置),长会话不累加。
> abort 时 `coreModelCall` 不抛、返回已生成 partial;**挂起的 approval/conflict 由 stream 包装层监听 abort 自动收口**(见 ⑤)。

---

## ④ 数据操作与乐观锁流程

```mermaid
flowchart TD
  A["set/edit/delete 入参<br/>path value expectedHash"] --> B["registry.get(path)"]
  B --> C{已注册?}
  C -->|否| ERR1["NOT_REGISTERED"]
  C -->|是| D["handleConflict(path, op, expectedHash, agentValue)"]
  D --> E{expectedHash 非空?}
  E -->|否 空串/undefined| NULL1["返回 null<br/>跳过乐观锁"]
  E -->|是| F["算 curHash = hashValue(window[path])"]
  F --> G{curHash === expectedHash?}
  G -->|是 无冲突| NULL2["返回 null"]
  G -->|否 冲突| H{opts.onConflict?}
  H -->|否 向后兼容| ERR2["返回 VERSION_CONFLICT<br/>agent 重新 get"]
  H -->|是| J["await onConflict(info)<br/>info.currentValue = V1 引用"]
  J --> K{用户决定}
  K -->|keep_external| K1["返回 已保留外部<br/>不写入"]
  K -->|overwrite| NULL3["返回 null<br/>fall through 继续写入"]
  K -->|restore| R["回退到快照栈顶<br/>(历史检查点)"]
  R --> R1["返回 已回退"]
  NULL1 --> W["正常写入流程"]
  NULL2 --> W
  NULL3 --> W
  W --> W1["set: JSON.parse + schema 校验"]
  W1 --> W2["pushSnapshot(path, op)<br/>存写前快照"]
  W2 --> W3["就地写回 setByPath/restoreInPlace<br/>(不替换根引用,兼容 reactive)"]
  W3 --> W4["audit 记日志"]
  W4 --> W5["返回 已设置/已edit/已删除"]
```

**数据存储位置:**
- **实际值** → 宿主 `window[path]`(唯一数据源,V0/V1/V2 都在这)
- **快照** → `dataOps` 闭包内 `snapshots: SnapshotEntry[]`(纯内存栈,FIFO 限长 20)
- **hash** → 实时计算 `djb2(safeStringify(value))`,不存储,只在 `get_data`/`read` 返回末尾附 `hash=xxx`(整体 bind 的 hash)
- **冲突挂起信息** → `core.pendingConflict` ref(响应式内存,供 UI)+ `SdkEvent 'conflict'` 外发

**关键约定:**
- `get` 不存快照 → `restore` 只能回到「快照栈顶(历史检查点)」,无法回到 agent `get` 时的 V0
- `overwrite` 由正常流程 `pushSnapshot`(避免冲突时重复 push 浪费栈位)
- 不传 `expectedHash` → 向后兼容直接写(不校验)

---

## ⑤ 冲突人工介入(挂起 + 事件 + UI + abort 联动)

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Detecting: set/edit/delete with expectedHash
  Detecting --> Idle: 无冲突(hash 匹配)
  Detecting --> Conflict: hash 不匹配
  Conflict --> Pending: onConflict 存在(挂起 + 发 conflict 事件)
  Conflict --> Rejected: 无 onConflict → VERSION_CONFLICT
  Pending --> KeepExternal: 用户选「保留外部」
  Pending --> Overwrite: 用户选「强制覆盖」
  Pending --> Restore: 用户选「回退」
  Pending --> KeepExternal: abort/unmount/switchSession 自动收口
  KeepExternal --> Idle: 不写入,agent 重新 get
  Overwrite --> Writing: fall through 正常写入
  Restore --> Idle: 回退到历史快照,不写入
  Writing --> Idle: 写入完成
  Rejected --> Idle: agent 重新 get
```

**三选项语义:**
| 选项 | 行为 | window[path] 结果 |
|------|------|-------------------|
| `keep_external` | 不写入,保留外部改后的值 | V1(外部改后) |
| `overwrite` | 强制执行 agent 写入 | V2(agent 值) |
| `restore` | 回退到快照栈顶(历史检查点) | 栈顶快照值(可能撤销外部改) |

**挂起收口(防永久挂起):**
- **abort**:用户停止生成 → `stream`/`fetchResponse` 包装层监听 `signal.abort` → 自动 `resolveConflict('keep_external')`
- **unmount**:`unmount()` 调 `resolveConflict('keep_external')`
- **switchSession**:`switchSession()` 开头调 `resolveConflict('keep_external')`

**集成方接入:**
- 内置 UI:ChatDialog 渲染冲突条(三按钮 + 值对比 diff),用户点按钮调 `sdk.resolveConflict(action)`
- headless:`watch(sdk.pendingConflict)` 或 `sdk.hook(e => e.type==='conflict')` 自建 UI,调 `sdk.resolveConflict(action)`
- 独立 `createDataOps(config, { onConflict })`:不接 ChatDialog 时自行处理冲突

---

## ⑥ 上下文压缩与持久化

```mermaid
flowchart LR
  A["每轮 afterRound"] --> B{"对话历史 > maxMemoryRounds?"}
  B -->|是| C["trimMemoryMessages<br/>最旧轮压成摘要 system 消息"]
  B -->|否| D["vfs Proxy 捕获 files 变更<br/>debounce save"]
  D --> E["store.saveSession<br/>messages/vfs/todos/memory"]
  E --> F{"全局配额超限?"}
  F -->|是| G["整会话 LRU 淘汰到 0.9 水位"]
  F -->|否| H["落盘成功"]
  G --> I{"仍 QuotaExceeded?"}
  I -->|是| J["降级内存重写 + emit degraded"]
  I -->|否| H
```

> 详细压缩策略见 [`context-management.md`](./context-management.md);持久化配额/淘汰/降级见 `CLAUDE.md`「持久化存储」小节。

---

## 关键特性

| 维度 | 设计 |
|---|---|
| **Agent 核心** | 自研 ReAct + 中间件契约(对齐 Deep Agents,零 LangGraph 依赖)+ 格式自纠 + verify 自纠 |
| **数据操作** | 单主对象 `data:{schema,bind}`;schema 校验 + 增量编辑(jsonPath)+ 按路径读 + 快照回退 + **乐观锁(expectedHash)+ 冲突人工介入** + **schema 形状自动白名单**(ZodObject 顶层声明字段隐藏未声明项)+ 高层 `read`(fields/depth 裁剪)+ `write`(批量 patches 原子)+ 大结果外存 vfs |
| **能力扩展** | 中间件(todos/skills/vfs/summarization/memory/permissions/verify/subagent/usageHints)+ 工具(`defineTool`)+ 技能(`defineSkill` 渐进披露) |
| **记忆** | 纯内存会话级;summarization 复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回);`maxMemoryRounds` 防长会话 OOM |
| **持久化** | 多后端(IndexedDB/WebStorage/Memory)+ 多 agent 隔离 + 全局配额 LRU 淘汰 + 降级内存 |
| **响应式** | `bind = reactive() 或普通对象`(工具直接读写 bind,不挂 window;普通对象经 `onEvent('data_change')` 或 `:key` 重渲染);set 子属性不替换引用 → 页面实时更新 |
| **鲁棒性** | 模型调用重试(网络/429/5xx)+ 停止生成(abort 保留 partial)+ 出错重试 + 冲突挂起自动收口 |
| **交付** | 框架无关 SDK(vue 打包进)+ 命令式 `mount` + headless(`ui:false`)+ 纯 HTML 集成(`demo/plain.html`) |

---

## 相关文档
- 使用手册:[`./usage-guide.md`](./usage-guide.md)(安装/配置项/能力详解/FAQ)
- 上下文压缩策略:[`./context-management.md`](./context-management.md)
- 项目指引 / 约定与坑:[`../CLAUDE.md`](../CLAUDE.md)
- 框架无关集成示例:[`../demo/plain.html`](../demo/plain.html)
