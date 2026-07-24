# Specification: page-agent-core

本文件为「页面内 Agent」SDK 的**系统规范真相源**(由 change `refactor-to-page-agent-sdk` 实现并归档合入)。实现须满足全部 Requirement。

## Requirement: 框架无关的命令式 SDK 入口
SDK 以 `createPageAgent(options)` 命令式 API 对外暴露,返回带 `mount(container)`/`unmount()` 的实例。使用者无需安装或了解 Vue。

## Requirement: Agent 执行可插拔中间件的 ReAct 循环
系统以 ReAct 循环(最多 `MAX_TOOL_ROUNDS = 10`)驱动 LLM,并在 `beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent` 生命周期点执行注册中间件。before 类钩子按注册顺序执行,after 类按逆序执行,wrap 类按洋葱(reduceRight)执行。

## Requirement: window 操作基于属性注册表
系统维护一个属性注册表,集成方通过 `createPageAgent` 配置声明可操作属性(`{ path, description, schema }`)。所有 window 的读写仅通过工具执行(不暴露任意 window 访问)。

## Requirement: 写操作的范围控制
`set_window_prop` 与 `delete_window_prop` 仅允许操作注册表内声明过的 path;对未注册 path 拒绝并提示用 `list_window_props` 查询可用属性。

## Requirement: JSON 值格式校验
`set_window_prop` 按属性声明的 `schema` 对 JSON 值做格式校验;校验失败返回结构化错误而非写入。读写值均为可序列化 JSON。

## Requirement: 属性说明文档通过工具获取
`list_window_props` 返回所有可操作属性的 path 与 description;`describe_window_prop` 返回单项属性的说明与 schema。

## Requirement: window 操作零桥接 + 审计
window 工具直接作用于宿主页面主 `window`(无需 postMessage);`get_window_prop` 对循环引用、函数、DOM 节点、超大对象做安全序列化;`get_window_prop` 允许读取注册属性的祖先路径;所有 set/delete 记录审计日志。

## Requirement: GET 文档工具遵循浏览器 CORS
`fetch_document` 仅以 GET 请求获取资源;对跨域被拦截的情形返回清晰错误提示。

## Requirement: Skills 渐进式披露
系统在 agent 启动时仅把每个 skill 的 name + description 注入 system prompt;skill 全文仅在 LLM 调用 `load_skill(name)` 时加载到当轮 context;重复加载被防。

## Requirement: Planning 以 write_todos 整表替换
`write_todos` 工具以整表替换语义更新 todos 列表(状态 pending/in_progress/completed);系统拒绝并行的多个 `write_todos` 调用。

## Requirement: 内存虚拟工作区(vfs)
系统提供基于内存的 `vfs_read/write/edit/ls/glob/grep`,作为 agent 工作记忆;会话级、刷新即失。

## Requirement: Context 管理
context 压缩以 token 估算(字符数/4)或轮数阈值触发(复用 useContextManager);通过 `compressInput` 中间件钩子在构建上下文前压缩跨轮历史(滑动窗口 + 摘要 + 关键词召回)。

## Requirement: Memory 注入
`createPageAgent` 的 `memory` 参数作为持久指令注入 system prompt 前段。

## Requirement: window 增量编辑(edit_window_prop)
`edit_window_prop` 对「对象/数组」注册属性按 `op`(set/remove/merge/append)+ `jsonPath` 发增量 patch,无需重传整个大对象;系统在深拷贝副本上应用并整体 schema 校验,通过后才就地写回(改子属性,不替换注册属性根引用,兼容响应式);校验失败不写入。

## Requirement: window 快照与快速回退
系统在 `set/edit/delete` 执行前自动为该属性存快照(per-path 栈,默认上限 20,FIFO);提供 `snapshot_window_prop`(手动命名检查点)、`list_window_snapshots`(时间线)、`restore_window_snapshot`(回退到指定快照或最近一次)。回退就地还原、保留响应式容器引用,且不再入栈。

## Requirement: 大工具结果外存 vfs
工具结果超过阈值(默认 6000 字符)时,系统将其转存虚拟工作区,仅在上下文中保留预览与 `vfs_read`/`vfs_grep` 引用(而非硬截断);虚拟工作区不可用时退化为截断。该处理在工具结果唯一收口处统一生效,对所有工具受益。

## Requirement: 按路径读取 window 局部
`get_window_prop` 可读取注册属性的后代子路径(精确读局部,如 `page.components.0.text`);`get_window_paths` 批量按多个路径读取,逐行返回 `path = value`,未注册路径标记拒绝。

## Requirement: 自测覆盖核心逻辑
`npm test`(tsx 跑 `src/__tests__/selftest.ts`)覆盖 windowOps(范围/校验/祖先读/后代读/批量读/增量编辑/快照回退)、offload(大结果外存三态)、vfs、todos/skills/permissions/memory 中间件、middleware 执行器(正序/逆序)、retry/pool/subagent/mcp extractText、verify(runBeforeReturn + createWriteBackCheck + isAdversarialClean),146 项断言全过。

## Requirement: 循环 beforeReturn 钩子(可拦截 return 并回灌自纠)

agent 主循环在「模型本轮无工具调用、即将返回最终结果」的收口点执行已注册中间件的 `beforeReturn` 钩子(正序)。钩子返回 `null`/放行则正常 return;返回反馈字符串时,系统将该反馈作为新 user 消息注入对话历史并**继续循环**(非 return),驱动 agent 基于反馈自纠。该机制为**纯增量插入**,不改变 `while` 循环骨架、不破坏 abort 语义与 `maxToolRounds` 上限。

## Requirement: 自纠次数兜底

系统为 beforeReturn 自纠维护计数(`verifyAttempts`),受 `maxVerifyAttempts` 配置约束。预算检查**前置**(`verifyAttempts < maxVerifyAttempts` 在调用钩子前判定):耗尽则根本不跑钩子(避免无谓工作,尤其对抗验证烧 token);计数达上限(或配置为 0)时即使钩子仍有反馈也强制 return。`maxVerifyAttempts` 默认 0(关闭 = 纯放行 = 现状),启用时默认上限 2;自纠耗尽 rounds 预算时返回缓存的有效最终答(非误导性兜底)。

## Requirement: Verify 自检中间件

系统提供 `createVerifyMiddleware({ check, adversarial? })` 中间件模板,把领域校验函数(`check: ({ messages, state }) => { ok, feedback? }`)包装为 `beforeReturn` 钩子:`ok=true` 放行,`ok=false` 将 `feedback` 回灌驱动自纠。自纠上限 `maxAttempts` 经 `createPageAgent` 透传 `createAgent` 的 `maxVerifyAttempts`(非中间件字段,中间件不自己计数)。`createPageAgent({ capabilities:{verify:true}, verify:{ check?, maxAttempts?, adversarial? } })` 控制;verify **默认关**(烧 token),误用 warn(传 check 忘 caps.verify 等),`check` 省略时默认 `createWriteBackCheck`。

## Requirement: 写后读回验证(domain 辅助)

系统提供可选 `createWriteBackCheck()`:扫描会话**所有**写操作(`set/edit/delete_window_prop`,按 path 去重保留最后操作,覆盖「写→读→答」序列),读回被改属性校验写入生效 + 符合 schema。`delete` 读回空 = 删除成功(放行);写被 windowOps 合法拒绝(校验失败/范围拒绝,ToolMessage 命中)则**跳过不误报**。windowOps 写入(`setByPath`)同步,读回无需等待响应式 flush。集成方可完全自定义 `check` 覆盖。

## Requirement: 对抗式验证(可选)

`verify.adversarial: true` 时,verify 中间件在 check 通过后 spawn 一个**无工具**的「找茬」子 agent(refute 姿态,目标是证明回复有问题,突破自审 confirmation bias),审查 agent 最新回复;verdict 表明无问题则放行,否则作为反馈回灌。默认关闭(每次烧一个子 agent token),`createPageAgent` 透传主 `llm` 构造子 agent。
