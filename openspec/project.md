# page-agent-sdk 项目

## 概述
`page-agent-sdk` 是一个**框架无关的 JS SDK**,以对话框形态挂载到任意网页,内置一个基于 ReAct 模式的 Tool-Calling Agent。Agent 通过自定义 tool 直接读写/调用宿主页面 `window` 对象上的属性(基于**属性注册表 + schema 校验**)、GET 抓取文档,并具备 planning / skills / 内存工作区 / context 管理能力。

本项目由 `zhuanti-agent`(Vue3 库模式、深度绑定"什么值得买专题"业务)重构而来,目标是剥离业务身份、补齐"操作所在页面"能力,并自研一套架构对齐 Deep Agents 的轻量 harness。

## 设计原则
- **纯浏览器运行**:无 Node 文件系统依赖;不引入 `langchain` 整包 / LangGraph(规避 [deepagentsjs#292](https://github.com/langchain-ai/deepagentsjs/issues/292) 浏览器打包阻塞)。
- **架构对齐 Deep Agents**:ReAct 循环 + 可插拔中间件 + 内存 backend,自研实现;仅依赖浏览器可用的 `@langchain/openai` + `@langchain/core`。
- **框架无关**:对外暴露命令式 API(`createChatSdk`),内部 Vue 打包进 SDK,使用者无需安装/了解 Vue。
- **安全边界在 tool 层**:数据槽操作经属性注册表 + schema 校验(无人工审批,但强约束范围与格式)。

## 技术栈
- Vue 3.5(**打包进 SDK**,非 peer)、Vite 8 库模式、TypeScript
- LangChain 浏览器子包:`@langchain/openai` + `@langchain/core`(external + peerDep)
- `marked` + `highlight.js`(打包进 SDK)
- `zod`(schema 校验,external + peerDep)

## OpenSpec 工作流
1. **提 change**:在 `openspec/changes/<id>/` 下写 `proposal.md`(Why/What/Impact)、`design.md`(技术决策)、`tasks.md`(实施清单)、`specs/<capability>.md`(增量 requirement)。
2. **实施**:按 `tasks.md` 勾选推进;实现须满足 `specs/` 的 requirement。
3. **归档**:实现完成后将 `specs/` 增量合入 `openspec/specs/`(系统真相源),change 移入 `openspec/changes/archive/`。

## 进行中的 change
- `2026-07-30-refactor-module-extraction/`:模块抽离重构(可维护性)—— ① 纯函数抽离(`dataOps.ts` 18 个纯函数 → `tools/jsonUtils.ts` + 6 个 schema 工具 → `tools/schemaUtils.ts`;`useContextManager.ts` 6 个纯函数 → `composables/contextIndex.ts`);② 高频改动点抽离(`createChatSdk.ts` → `sdk/promptBuilder.ts` / `sdk/llmResolver.ts` / `sdk/conflictManager.ts` / `sdk/skillStore.ts` 桥接层);③ 对外开放 subpath(`./storage` / `./query` / `./llm`)。纯重构,运行时行为零变化;顶层 `.` 入口导出不变。分期:期一(P0 纯函数 + subpath,可独立发布)→ 期二(P1 状态机/桥接层)→ 期三(P2 低频可选)→ 期四(测试同步)→ 期五(文档 + 门禁 + 归档)。**【期一+期二+期三已完成 2026-07-31】** 期一:jsonUtils/schemaUtils/promptBuilder + subpath;期二:contextIndex/llmResolver/conflictManager;期三:optionsResolver(resolveStorage/resolveDialogConfig)+ events(createSdkEvents)。createChatSdk 1751→1613、dataOps 969→670、useContextManager 321→235;sec-30/31/32 白盒单测,selftest 537→630 全过。skillStore 桥接评估延后(userSkills 闭包依赖深)。期四(测试已随期同步)/五(文档归档)待实施。
- `2026-07-31-fix-dataops-write-correctness/`:dataOps 写路径正确性/安全修复(两个缺陷合并)—— ① 白名单绕过(`set_data` / `write` set 把 LLM 传入的未声明字段无校验写回 bind,安全口子)→ 严格白名单(删两处重复的写回块);② 数组子项删除产生稀疏数组(`deleteByPath` 对数组元素用 `delete arr[i]` 而非 `splice`,四条入口 `delete_data`/`write del`/`edit remove`/`eval patches remove` 全踩)→ `deleteByPath` 区分数组用 splice。纯逻辑修复(不抽函数、不改契约),同文件三处。patch,向后兼容(安全/正确性收紧)。
- `2026-07-31-fix-introspection-consistency/`:inspect 一致性修复 —— `inspect().systemPrompt` 漏掉 usageHints / todos / skills / memory / subagents 段(只拼了 base + data + augmentSystem,与实际发给 LLM 的不符,误导调试);解法:`createAgent` 暴露 `getEffectiveSystemPrompt()`(复用内部 `buildSystemPrompt` 权威拼装),`getInfo` 代理到该出口(prompt 拼装收敛为单一真相源)。展示口径修复,patch,向后完全兼容(LLM 实际收到的 prompt 本就对)。
- `2026-07-31-evolve-default-toolset/`:默认(simple)数据工具集演进(合并原总纲 Change 11/12/13)—— ① 精简:`snapshot_data` + `list_data_snapshots` 从 simple 移 advanced(被自动快照 + restore_data + history_data 覆盖);② 补缺:新增 `history_data`(只读查看快照,填 list 元信息 / restore 破坏性之间的空档)进 simple、新增 `diff_data`(差异对比,verify/冲突诊断)进 advanced;③ 增强:`read` 多路径(`jsonPaths`)、`write` dryRun 预检。simple 从 8→7 工具(去低价值补高价值),advanced 全暴露。minor,向后兼容(advanced/minimal 不受影响;精简与补缺配套防 simple 丢"看历史"能力)。三期:精简+history_data(核心配套)→ read/write 增强 → diff_data。
- `2026-07-31-harden-react-loop-budget/`:ReAct 循环预算语义加固 —— ① `rounds` 只计真实工具轮(格式自纠/verify 自纠不再消耗 maxToolRounds,改用各自独立预算 formatRetries/verifyAttempts);② 新增 `iterations` 总迭代硬上限(防自纠死循环);③ wrap-up 兜底文案改为进展引导(不再让用户"简化问题")。patch,向后兼容(语义修正)。
- `2026-07-31-harden-optimistic-lock/`:乐观锁加固 —— ① `hashValue` 从 32-bit djb2 升级 cyrb53(53-bit,碰撞空间 2^53,大幅降"误判无冲突"概率);② `lastReadHash` 并发语义文档化(并发工具下退化为整体快照语义,建议显式 expectedHash)。hash 不持久化无兼容问题。patch。
- `2026-07-31-harden-model-caps-matching/`:模型能力表匹配策略 first-match → longest-match(filter 命中 + 按 pattern.source 长度降序),消除"顺序依赖"脆弱性;补表驱动断言锁死"已知模型名 → 预期 caps"。patch,行为不变(当前顺序下结果一致)。
- `2026-07-31-unify-context-compression/`:双摘要机制统一 —— 抽 `SummarySegment` 协议 + `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 纯函数作单一 source of truth,`trimMemoryMessagesImpl` 与 `summarization`/`useContextManager.compress` 共用,消除两处重复的"防头部旧摘要丢失"补丁。不合并两套压缩(维度不同),只统一摘要段格式与合并逻辑。patch(内部重构)。建议 refactor-module-extraction 之后。
- `2026-07-31-unify-error-model/`:错误处理三档模型(`recoverable` 回灌 LLM / `fatal` emit+中断 / `observable` 记 trace 不中断)+ 各层(工具/中间件/agent/emit)按 `routeError` 纯函数路由 + `onEvent('error')` payload 结构化(severity/code,向后兼容)。期一 patch(内部路由)/ 期二 minor(payload 扩展)。与 observability 协同。
- `2026-07-31-declarative-middleware-ordering/`:装配机制统一(B+E)—— ① 中间件 priority 声明式排序(`MIDDLEWARE_PRIORITY` 常量 + `composeMiddlewareStack` 纯函数 + 顺序约束断言),替代 `middlewares` 数组字面量硬编码;② 运行时重配置 setter 收敛为 `createReconfigurable` 注册表(消除散落的 `infoTick++ + 条件 setX` 重复,对外方法名保留)。patch(机制化,行为不变)。建议 refactor 之后。
- `2026-07-31-observability-structured-tracing/`:可观测性升级 —— `debugLogs` 扁平数组升级为结构化 `TraceSpan` 树(round/model/tool/compression,带 timing/status/attributes)+ `getTraceMetrics` 纯函数聚合(轮延迟/工具成功率/token/重试/压缩);`inspect().trace` + `onEvent('trace')` 外发;DebugDrawer 树形渲染。`debugLogs` 保留作兼容视图。minor(新增可观测,向后兼容)。建议 unify-error-model 之后(span status 复用 severity)。
- `2026-07-31-expose-schema-constraints/`:字段约束可见性(evolve 留的后续)—— `describeSchemaNode` 纯函数结构化提取 zod 约束(类型/min/max/enum/optional/default/嵌套 shape);三处消费:`extractSchemaHint` 升级(systemPrompt「可操作数据」段带约束)+ `read` 概览段带约束(子路径读值不带)+ `schema_data` 工具(advanced)查任意路径完整约束。让 LLM 写前即知规则,减试错轮次。minor(信息增强)。建议 evolve 之后。

## 最近完成的 change(已归档)
- `archive/2026-07-30-add-dynamic-reconfiguration/`:运行时资源动态加载/卸载 —— `sdk.setTools/addTool/removeTool`(用户工具动态,核心基础设施)/ `sdk.setSubagents/addSubagent/removeSubagent`(复用 tools 机制)/ `sdk.setLlm`(模型切换 + 重解析能力)/ `sdk.setMemory`(memory 动态)。复用 `let + rebind + infoTick` 模式(类比 setData/setSkills),全程向后兼容。自测 524/524,e2e 210/210。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-augment-system-hook/`:动态 system prompt 注入钩子 `augmentSystem(ctx)`(集成方按运行时状态注入部分 schema / 组件说明)+ A4「可操作数据」段改为每轮随 data 动态(修 `setData()` 不同步 Bug,经 `dataHint` 中间件)。复用 augmentPrompt 中间件机制,不污染 `HarnessState`。规范已合入 `openspec/specs/page-agent-core.md`。自测 495/495,e2e 189/189。
- `archive/2026-07-24-add-verify-middleware/`:Verify 自检中间件(`beforeReturn` 钩子点 + `createVerifyMiddleware` + `createWriteBackCheck` 写后读回 + 对抗验证)。对应 `doc/evolution-roadmap.md` #5。自测 146/146,规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-23-generalize-chat-sdk/`:通用化(provider 抽离 / headless / capabilities / MCP / presets)。
- `archive/refactor-to-chat-sdk-sdk/`:重构为框架无关页面内 Agent SDK(规范已合入 `openspec/specs/page-agent-core.md`)。
