# Specification: page-agent-core

本文件为「页面内 Agent」SDK 的**系统规范真相源**(由 change `refactor-to-chat-sdk-sdk` 实现并归档合入)。实现须满足全部 Requirement。

## Requirement: 框架无关的命令式 SDK 入口
SDK 以 `createChatSdk(options)` 命令式 API 对外暴露,返回带 `mount(container)`/`unmount()` 的实例。使用者无需安装或了解 Vue。

## Requirement: Agent 执行可插拔中间件的 ReAct 循环
系统以 ReAct 循环(最多 `MAX_TOOL_ROUNDS = 10`)驱动 LLM,并在 `beforeAgent/wrapModelCall/beforeModel/afterModel/wrapToolCall/afterAgent` 生命周期点执行注册中间件。before 类钩子按注册顺序执行,after 类按逆序执行,wrap 类按洋葱(reduceRight)执行。

## Requirement: window 操作基于属性注册表
系统维护一个属性注册表,集成方通过 `createChatSdk` 配置声明可操作属性(`{ path, description, schema }`)。所有 window 的读写仅通过工具执行(不暴露任意 window 访问)。

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
`createChatSdk` 的 `memory` 参数作为持久指令注入 system prompt 前段。

## Requirement: window 增量编辑(edit_window_prop)
`edit_window_prop` 对「对象/数组」注册属性按 `op`(set/remove/merge/append)+ `jsonPath` 发增量 patch,无需重传整个大对象;系统在深拷贝副本上应用并整体 schema 校验,通过后才就地写回(改子属性,不替换注册属性根引用,兼容响应式);校验失败不写入。

## Requirement: window 快照与快速回退
系统在 `set/edit/delete` 执行前自动为该属性存快照(per-path 栈,默认上限 20,FIFO);提供 `snapshot_window_prop`(手动命名检查点)、`list_window_snapshots`(时间线)、`restore_window_snapshot`(回退到指定快照或最近一次)。回退就地还原、保留响应式容器引用,且不再入栈。

## Requirement: 大工具结果外存 vfs
工具结果超过阈值(默认 6000 字符)时,系统将其转存虚拟工作区,仅在上下文中保留预览与 `vfs_read`/`vfs_grep` 引用(而非硬截断);虚拟工作区不可用时退化为截断。该处理在工具结果唯一收口处统一生效,对所有工具受益。

## Requirement: 按路径读取 window 局部
`get_window_prop` 可读取注册属性的后代子路径(精确读局部,如 `page.components.0.text`);`get_window_paths` 批量按多个路径读取,逐行返回 `path = value`,未注册路径标记拒绝。

## Requirement: 自测覆盖核心逻辑
`npm test`(tsx 跑 `src/__tests__/selftest.ts`)覆盖 windowOps(范围/校验/祖先读/后代读/批量读/增量编辑/快照回退)、offload(大结果外存三态)、vfs、todos/skills/permissions/memory 中间件、middleware 执行器(正序/逆序)、retry/pool/subagent/mcp extractText、verify(runBeforeReturn + createWriteBackCheck + isAdversarialClean)、toolsets(selectBuiltinTools 筛选 + fetchTools/defineWindowToolset 结构)、usageHints(能力用法提示注入),157 项断言全过。

## Requirement: 循环 beforeReturn 钩子(可拦截 return 并回灌自纠)

agent 主循环在「模型本轮无工具调用、即将返回最终结果」的收口点执行已注册中间件的 `beforeReturn` 钩子(正序)。钩子返回 `null`/放行则正常 return;返回反馈字符串时,系统将该反馈作为新 user 消息注入对话历史并**继续循环**(非 return),驱动 agent 基于反馈自纠。该机制为**纯增量插入**,不改变 `while` 循环骨架、不破坏 abort 语义与 `maxToolRounds` 上限。

## Requirement: 自纠次数兜底

系统为 beforeReturn 自纠维护计数(`verifyAttempts`),受 `maxVerifyAttempts` 配置约束。预算检查**前置**(`verifyAttempts < maxVerifyAttempts` 在调用钩子前判定):耗尽则根本不跑钩子(避免无谓工作,尤其对抗验证烧 token);计数达上限(或配置为 0)时即使钩子仍有反馈也强制 return。`maxVerifyAttempts` 默认 0(关闭 = 纯放行 = 现状),启用时默认上限 2;自纠耗尽 rounds 预算时返回缓存的有效最终答(非误导性兜底)。

## Requirement: Verify 自检中间件

系统提供 `createVerifyMiddleware({ check, adversarial? })` 中间件模板,把领域校验函数(`check: ({ messages, state }) => { ok, feedback? }`)包装为 `beforeReturn` 钩子:`ok=true` 放行,`ok=false` 将 `feedback` 回灌驱动自纠。自纠上限 `maxAttempts` 经 `createChatSdk` 透传 `createAgent` 的 `maxVerifyAttempts`(非中间件字段,中间件不自己计数)。`createChatSdk({ capabilities:{verify:true}, verify:{ check?, maxAttempts?, adversarial? } })` 控制;verify **默认关**(烧 token),误用 warn(传 check 忘 caps.verify 等),`check` 省略时默认 `createWriteBackCheck`。

## Requirement: 写后读回验证(domain 辅助)

系统提供可选 `createWriteBackCheck()`:扫描会话**所有**写操作(`set/edit/delete_window_prop`,按 path 去重保留最后操作,覆盖「写→读→答」序列),读回被改属性校验写入生效 + 符合 schema。`delete` 读回空 = 删除成功(放行);写被 windowOps 合法拒绝(校验失败/范围拒绝,ToolMessage 命中)则**跳过不误报**。windowOps 写入(`setByPath`)同步,读回无需等待响应式 flush。集成方可完全自定义 `check` 覆盖。

## Requirement: 对抗式验证(可选)

`verify.adversarial: true` 时,verify 中间件在 check 通过后 spawn 一个**配只读工具**的「找茬」子 agent(refute 姿态,目标是证明回复有问题,突破自审 confirmation bias),审查 agent 最新回复。子 agent 配备只读工具(读 window 的 `get_window_prop`/`get_window_paths`/`list_window_props`/`describe_window_prop` + `fetch_document`,由 `createChatSdk` 从 `allTools` 白名单筛选注入)与多轮工具调用预算(`maxToolRounds` 提升至 4),可实证读回被改属性检查而非臆测;审查聚焦 window 修改的典型错误(属性路径 / 值类型 / 语义)。无只读工具可装时(如 `capabilities.windowOps:false`)退化为单轮文本审查。verdict 表明无问题则放行,否则作为反馈回灌。默认关闭(每次烧一个多轮子 agent token),`createChatSdk` 透传主 `llm` 与筛选后的只读工具构造子 agent。

## Requirement: 内置工具按需装载

`createChatSdk` 默认装配 window 操作工具集(`windowOps`)与文档抓取工具(`fetchDoc`)。两者可分别经 `capabilities.windowOps` / `capabilities.fetch` 关闭(默认均 `true`,保持零配置体验)。关闭后对应工具不进入主 agent 工具池,从而省 token 与上下文噪音(如纯调研场景)。子 agent 的只读工具白名单从主工具池筛选,故关闭某类工具时子 agent 同步不具备该类工具(符合「本 agent 不做此类操作」的语义)。子 agent 的隔离与递归切断机制本身不受影响。

## Requirement: 内置工具集可独立导出与注入

`createWindowOps` 与 `fetchDocTools` 从 SDK 入口导出;另提供 `fetchTools` 静态 toolset 预设(`defineToolset('fetch', fetchDocTools)`)与 `defineWindowToolset(props)` 工厂。集成方可 `import { createWindowOps, fetchDocTools }` 手动构造工具集,经 `tools` 或 `toolsets` 注入(替代默认自动装配),支持「主要业务工具集单独引入、按需注入」的高级用法。window 工具集依赖集成方声明的 `windowProps`,故不预构造为静态预设,由集成方手动 `createWindowOps(props)` 构造。

## Requirement: 能力用法默认提示(克制注入)

各内置能力(planning / window 快照回退 / subagent)在**该能力开启**时,由 `createChatSdk` 统一经 `usageHints` 中间件向 system prompt 注入一行简短用法提示(如「多步任务先 `write_todos` 拆解」「误改可用 `restore_window_snapshot` 回退」「独立子任务可 `spawn_agent` 委派」)。提示仅在该能力开启时注入,全部关闭时不注入(返回 `undefined`,不增加上下文);绝不覆盖集成方自定义 `systemPrompt`(拼接在其后)。子 agent 的默认 systemPrompt 明示其只具备只读工具、应给出简洁结论。

## Requirement: Agent 信息含 MCP 与工具来源

`inspect()`(getInfo)返回已连接 MCP server 列表(`mcp.servers: [{name, url, toolCount}]`)与每个工具的来源标注(`source: 'builtin' | 'mcp:<name>' | 'user'`)。内置工具标 `builtin`,MCP 注入工具标 `mcp:<serverName>`,用户 `tools`/`toolsets` 标 `user`。DebugDrawer「Agent 信息」展示 MCP 区块与工具来源标签,使集成方能看清工具来源构成。

## Requirement: 对话 regenerate 与复制

正常(非错误)assistant 回复支持「复制」与「重新生成」:重新生成移除该回复,以当前对话历史(含最后一条 user)重发流式生成。错误时的「重试」、生成中的「停止」(abort)保留。loading 期间禁用复制/重新生成。

## Requirement: UI 模块可独立导出

`ChatDialog` / `MessageContent` / `CodePreview` 组件与 `useChat` composable 从 SDK 入口导出,支持 headless(`ui:false`)模式下集成方自建 UI 时复用对话框组件与流式/重试/停止/重生成逻辑,而不必重新实现。

## Requirement: UI 样式可配

`ChatDialog`/`DebugDrawer` 暴露 CSS 变量(主色 `--cs-primary`、背景、圆角等,提供默认值)与 props(头像显示 `showAvatar`、打字动画 `showTyping`);默认采用中性主题(去渐变;主色墨绿 `#1f4d3a`,去 AI 风格化 indigo)。集成方可经 CSS 变量覆盖主题或经 props 关闭装饰,无需改组件代码。

## Requirement: skill 文档源(doc)

`defineSkill` 的内容来源支持 `doc` 字段(与 `getContent` 二选一,`doc` 优先):`http(s)://` 远程 md → `load_skill` 时 fetch 读取(同源/CORS 约束);`vfs://path` 或裸路径 → 从 vfs 读取(由 `createChatSdk` 在 vfs 启用时注入 `readVfs`)。skill 内容与代码解耦,集成方可把 skill 指南放 md 文档维护。读取失败(跨域 / 未找到 / vfs 未启用)返回结构化错误提示;超长截断(默认 20000 字符)。`resolveDocKind` 判定来源、`readSkillDoc` 读取(纯函数 + vfs 分支自测覆盖)。

## Requirement: 执行流程视图(按轮次)

DebugDrawer 提供「流程」视图,把扁平 debugLog 按 `round` 分组成流水:「准备」区放无 round 的日志(context / middleware / error),每轮一个卡片(第 N 轮:LLM请求 → LLM响应 → 工具调用 → 结果),节点左侧色条按类型区分,显示摘要(消息数 / 工具数 / 工具名 / 结果状态)+ 时间戳。`createAgent` 给 `tool_call`/`tool_result` 日志补 `round` 字段(与 llm_request/response 对齐)以支持按轮分组。便于排查「走到哪个模块、结果如何」,确认执行过程是否符合预期;详情仍看「日志」视图。
