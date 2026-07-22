# Specification: page-agent-core

本文件为 `refactor-to-page-agent-sdk` change 的**增量规范**(ADDED / REMOVED)。实现须满足全部 ADDED requirement。

## ADDED Requirements

### Requirement: 框架无关的命令式 SDK 入口
SDK SHALL 以 `createPageAgent(options)` 命令式 API 对外暴露,返回带 `mount(container)`/`unmount()` 的实例。使用者 SHALL NOT 需要安装或了解 Vue。

#### Scenario: 纯 HTML 页面集成
- WHEN 使用者在普通 HTML 页面引入 SDK 并调用 `createPageAgent({ container: '#x', llm }).mount()`
- THEN 对话框 SHALL 渲染到 `#x`,且页面本身无需引入 Vue

### Requirement: Agent 执行可插拔中间件的 ReAct 循环
系统 SHALL 以 ReAct 循环(最多 `MAX_TOOL_ROUNDS = 10`)驱动 LLM,并在 `beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent` 生命周期点执行注册中间件。before 类钩子按注册顺序执行,after 类按逆序执行。

#### Scenario: 工具调用循环
- WHEN LLM 返回 tool_calls
- THEN 系统 SHALL 经 `wrapToolCall` 执行工具、把结果追加到上下文、并回到模型调用,直到无 tool_calls 或达到轮数上限

### Requirement: window 操作基于属性注册表
系统 SHALL 维护一个属性注册表,集成方通过 `createPageAgent` 配置声明可操作属性(`{ path, description, schema }`)。所有 window 的读写 SHALL 仅通过工具执行(不暴露任意 window 访问)。

#### Scenario: 集成方声明可操作属性
- WHEN 调用 `createPageAgent({ windowProps: [{ path: 'app.theme', description, schema }] })`
- THEN 仅 `app.theme` 成为 Agent 可操作的 window 属性

### Requirement: 写操作的范围控制
`set_window_prop` 与 `delete_window_prop` SHALL 仅允许操作注册表内声明过的 path;对未注册 path SHALL 拒绝并提示用 `list_window_props` 查询可用属性。

#### Scenario: 写未注册属性被拒
- WHEN Agent 调用 `set_window_prop({ path: 'app.unknown', value })` 且 `app.unknown` 未在注册表
- THEN 工具 SHALL 返回错误,不修改 window,并提示使用 `list_window_props`

### Requirement: JSON 值格式校验
`set_window_prop` SHALL 按属性声明的 `schema` 对 JSON 值做格式校验;校验失败 SHALL 返回结构化错误而非写入。读写值 SHALL 均为可序列化 JSON。

#### Scenario: schema 校验失败
- WHEN 属性 `app.theme` 声明 schema 为 `enum: ['light','dark']`,Agent 传入 `'red'`
- THEN 工具 SHALL 返回结构化校验错误,不写入 `window.app.theme`

### Requirement: 属性说明文档通过工具获取
`list_window_props` SHALL 返回所有可操作属性的 path 与 description;`describe_window_prop` SHALL 返回单项属性的说明与 schema,供 Agent 决策数据格式。

#### Scenario: Agent 发现可操作属性
- WHEN Agent 调用 `list_window_props`
- THEN 返回全部注册属性的 path + description,供 Agent 决定后续操作

### Requirement: window 操作零桥接 + 审计
window 工具 SHALL 直接作用于宿主页面主 `window`(无需 postMessage);`get_window_prop` SHALL 对循环引用、函数、DOM 节点、超大对象做安全序列化;所有 set/delete SHALL 记录审计日志。

#### Scenario: 写入直接生效于宿主 window
- WHEN `set_window_prop` 校验通过并写入
- THEN 宿主页面的 `window[path]` SHALL 立即更新,且审计日志记录此次变更

### Requirement: GET 文档工具遵循浏览器 CORS
`fetch_document` SHALL 仅以 GET 请求获取资源;对跨域被拦截的情形 SHALL 返回清晰错误提示。

#### Scenario: 跨域请求被拦
- WHEN Agent 用 `fetch_document` 请求一个未配 CORS 的跨域 URL
- THEN 工具 SHALL 返回清晰的 CORS 错误提示,而非静默失败

### Requirement: Skills 渐进式披露
系统 SHALL 在 agent 启动时仅把每个 skill 的 name + description 注入 system prompt;skill 全文 SHALL 仅在 LLM 调用 `load_skill(name)` 时加载到当轮 context。

#### Scenario: skill 全文按需加载
- WHEN Agent 启动
- THEN system prompt 仅含 skill 索引(name + description)
- AND WHEN Agent 调用 `load_skill('x')`
- THEN skill `x` 的全文被加载到当轮 context

### Requirement: Planning 以 write_todos 整表替换
`write_todos` 工具 SHALL 以整表替换语义更新 todos 列表(状态 pending/in_progress/completed);系统 SHALL 拒绝并行的多个 `write_todos` 调用。

#### Scenario: 并行 write_todos 被拒
- WHEN LLM 在一轮中并行发起多个 `write_todos`
- THEN 系统 SHALL 拒绝并返回错误,避免整表替换冲突

### Requirement: 内存虚拟工作区(vfs)
系统 SHALL 提供基于内存的 `vfs_read/write/edit/ls/glob/grep`,作为 agent 工作记忆;会话级、刷新即失。

#### Scenario: 工作区读写
- WHEN Agent 调用 `vfs_write` 写入文件再 `vfs_read` 读回
- THEN 读回内容 SHALL 与写入一致

### Requirement: Context 管理 token 触发 + 大结果外存
context 压缩 SHALL 以 token 估算(字符数 / 4)触发(阈值 0.85 × maxInputTokens);超过 ~20000 token 的工具结果 SHALL 外存到 vfs 并以预览 + 引用替换原文,而非硬截断。

#### Scenario: 超大工具结果外存
- WHEN 某工具返回结果超过 ~20000 token
- THEN 系统 SHALL 把原文写入 vfs,ToolMessage 内容替换为预览 + `vfs_read` 引用

### Requirement: Memory 注入
`createPageAgent` 的 `memory` 参数 SHALL 作为持久指令注入 system prompt 前段。

#### Scenario: 注入持久指令
- WHEN `createPageAgent` 传入 `memory: '遵循某约定...'`
- THEN system prompt 前段 SHALL 包含该指令

## REMOVED Requirements
- **子 agent 委派(delegation)**:本期不实现 `task`/`delegate_task` 工具。
- **专题业务身份**:移除 smzdm 专题系统提示词与文案。
- **本地文档分段库**:移除 `readDocument`/`documentStore` 上传-分段-检索工具(以 `fetch_document` + vfs 替代)。
