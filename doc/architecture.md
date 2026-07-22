# page-agent 功能架构

> 框架无关的「页面内 Agent」JS SDK。Agent 通过自定义 tool 读写宿主页面 `window` 对象(属性注册表 + schema 校验),并具备 planning / skills / 内存工作区 / context 管理能力。
> 核心为**自研 Deep Agents 风格 harness**(ReAct + 可插拔中间件),不引入 LangGraph/langchain 整包(规避 [`deepagentsjs#292`](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。

本文从三个视角描述:**分层结构**、**运行控制流**、**window 操作安全流**。

---

## ① 分层结构

```mermaid
flowchart TD
  subgraph Host["🖥️ 宿主页面(任意网页)"]
    WP["window.page = reactive({...})<br/>响应式数据(测试模块)"]
  end

  subgraph SDK["📦 page-agent SDK — 框架无关,Vue 打包进,使用者无需装 Vue"]
    Entry["<b>对外入口</b><br/>createPageAgent(container, llm, windowProps, tools, skills, memory)<br/>.mount() / .unmount() / .send()"]
    Core["<b>harness 核心</b> createAgent<br/>ReAct 循环 + 中间件契约(before/wrap/after)"]
    MW["<b>中间件栈(可插拔)</b><br/>todos → skills → vfs → summarization → memory → permissions"]
    Tools["<b>工具层</b><br/>内置: windowOps · fetchDoc · vfs_*<br/>用户: defineTool(...) / defineSkill(...)"]
    State["<b>状态 / 数据</b><br/>HarnessState(messages·todos·files·skillsLoaded·memory)<br/>属性注册表(path→schema) · vfs store"]
    UI["<b>UI</b><br/>ChatDialog 对话框 · PageRenderer 渲染 window.page"]
    Entry --> Core --> MW --> Tools --> State
    Tools -. "直接读写(零桥接,无 iframe)" .-> WP
    UI -. "响应式绑定" .-> WP
  end
```

### 分层职责

| 层 | 职责 | 关键源文件 |
|---|---|---|
| **对外入口** | 命令式 API,组装 harness + 内置工具/中间件,挂载 UI | `src/core/sdk/createPageAgent.ts`、`src/core/sdk/defineTool.ts` |
| **harness 核心** | ReAct 循环 + 中间件生命周期驱动 | `src/core/harness/createAgent.ts`、`middleware.ts`、`state.ts` |
| **中间件栈** | 可插拔能力(planning/skills/工作区/压缩/记忆/权限) | `src/core/harness/{todos,skills,summarization,memory,permissions}.ts` |
| **工具层** | Agent 可调用的能力(window 操作/抓文档/工作区/自定义) | `src/core/tools/{windowOps,fetchDoc}.ts`、`src/core/backends/vfs.ts`、`src/core/utils/offload.ts` |
| **状态/数据** | 运行态 + 注册表 + 工作区存储 | `HarnessState`、属性注册表(`createWindowOps`)、`VfsStore` |
| **UI(通用)** | 对话框 + 调试抽屉(SDK 内) | `src/core/components/{ChatDialog,DebugDrawer}.vue` |
| **定制 demo** | 左侧 JSON 响应式页面(开发自举,非 SDK 部分) | `examples/page-demo/{App,PageRenderer}.vue` |

---

## ② 运行控制流(ReAct + 中间件生命周期)

```mermaid
flowchart TD
  BA["beforeAgent <i>(正序)</i><br/>各中间件初始化 todos/skills/memory/files"] --> Loop{"rounds < 10 ?"}
  Loop -->|是| BM["beforeModel <i>(正序)</i><br/>todos 推进 / 重置计数"]
  BM --> WM["wrapModelCall <i>(洋葱)</i><br/>+ compressInput 压缩历史<br/>+ augmentPrompt 渲染 system(todos/skills/memory)"]
  WM --> LLM["[ LLM.invoke + bindTools ]"]
  LLM --> AM["afterModel <i>(逆序)</i>"]
  AM --> TC{"返回 tool_calls?"}
  TC -->|否| AA["afterAgent <i>(逆序)</i> → 返回文本"]
  TC -->|是| WT["wrapToolCall <i>(洋葱,逐个)</i><br/>permissions 校验 / vfs 大结果外存"]
  WT --> EXEC["执行工具:windowOps / fetchDoc / vfs / 用户工具"]
  EXEC --> Loop
```

> 钩子顺序与 Deep Agents 一致:**before 类正序、after 类逆序、wrap 类洋葱(reduceRight)**。
> 工具结果以 `ToolMessage` 追加到上下文,循环直到 LLM 不再调工具或达上限(`MAX_TOOL_ROUNDS = 10`)。

---

## ③ window 操作安全流(核心)

```mermaid
flowchart TD
  A["Agent 调用 set_window_prop(path, value)"] --> B{"① 范围控制<br/>path 在属性注册表中?"}
  B -->|否| R1["拒绝 + 提示 list_window_props"]
  B -->|是| C{"② 格式校验<br/>value(JSON) 符合该 path 的 zod schema?"}
  C -->|否| R2["返回结构化错误(不写入)<br/>Agent 据此自修正"]
  C -->|是| D["③ window[path] = value<br/>零桥接直改宿主 window"]
  D --> E["响应式触发 → PageRenderer 更新<br/>审计日志 → DebugDrawer"]
```

**window 工具集**(均限属性注册表):`list_window_props` · `describe_window_prop` · `get_window_prop`(读自身/后代子路径/祖先) · `get_window_paths`(批量按路径读局部) · `set_window_prop`(范围 + schema 校验,整体替换) · `edit_window_prop`(按 jsonPath 增量改:set/remove/merge/append) · `delete_window_prop` · `snapshot_window_prop`/`list_window_snapshots`/`restore_window_snapshot`(快照回退)。

- **范围控制**:写操作仅限集成方声明的 `windowProps`(集成方可只暴露 `app.*` 命名空间收紧边界)。
- **schema 校验**:`set`/`edit` 按 zod schema 校验 JSON 值,失败返回结构化错误(不写入),Agent 据此修正。
- **增量编辑**:`edit_window_prop` 按 `jsonPath`(如 `components.0.text`)发 patch,避免重传整个大 JSON;校验在副本、落地用就地写回(改子属性不替换注册属性根引用 → 兼容 Vue reactive)。
- **按路径读**:`get_window_prop`/`get_window_paths` 支持读注册属性的任意后代子路径(精确读局部,不必整体读大对象)。
- **快照回退**:`set/edit/delete` 前自动存快照(per-path 栈,默认上限 20);`snapshot_window_prop` 手动检查点,`restore_window_snapshot` 一键回退(就地还原,保留 reactive 引用)。
- **大结果外存**:工具结果超阈值(默认 6000 字符)由 `createAgent` 统一转存 vfs,只留预览 + `vfs_read`/`vfs_grep` 引用(不再硬截断丢信息);vfs 不可用时退化为截断。
- **零桥接**:工具函数体 `window` = 宿主页面主 window(ChatDialog 不在 iframe/shadow),无需 postMessage。
- **无人工审批 + 强约束**:无弹框打断,但范围与校验在 tool 层强制;另留 `permissions` 中间件(first-match-wins)可选收紧。

---

## 关键特性

| 维度 | 设计 |
|---|---|
| **Agent 核心** | 自研 ReAct + 中间件契约(对齐 Deep Agents,零 LangGraph 依赖) |
| **window 操作** | 属性注册表 + schema 校验 + 范围控制 + 增量编辑(jsonPath)+ 按路径读 + 快照回退 + 大结果外存 vfs |
| **能力扩展** | 中间件(todos/skills/vfs/summarization/memory/permissions)+ 工具(`defineTool`)+ 技能(`defineSkill` 渐进披露) |
| **记忆** | 纯内存会话级;summarization 中间件复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回) |
| **响应式** | `window.page = reactive()`;set 子属性不替换引用 → 页面实时更新 |
| **交付** | 框架无关 SDK(vue 打包进)+ 命令式 `mount` + 纯 HTML 集成(`demo/plain.html`) |

---

## 相关文档
- 规范真相源(Requirements):[`../openspec/specs/page-agent-core.md`](../openspec/specs/page-agent-core.md)
- 变更记录(proposal/design/tasks):[`../openspec/changes/archive/refactor-to-page-agent-sdk/`](../openspec/changes/archive/refactor-to-page-agent-sdk/)
- 项目指引 / 约定与坑:[`../CLAUDE.md`](../CLAUDE.md)
- 框架无关集成示例:[`../demo/plain.html`](../demo/plain.html)
