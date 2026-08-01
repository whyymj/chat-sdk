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
- `2026-07-31-evolve-default-toolset/`:默认(simple)数据工具集演进(合并原总纲 Change 11/12/13)—— ① 精简:`snapshot_data` + `list_data_snapshots` 从 simple 移 advanced(被自动快照 + restore_data + history_data 覆盖);② 补缺:新增 `history_data`(只读查看快照,填 list 元信息 / restore 破坏性之间的空档)进 simple、新增 `diff_data`(差异对比,verify/冲突诊断)进 advanced;③ 增强:`read` 多路径(`jsonPaths`)、`write` dryRun 预检。simple 从 8→7 工具(去低价值补高价值),advanced 全暴露。minor,向后兼容(advanced/minimal 不受影响;精简与补缺配套防 simple 丢"看历史"能力)。三期:精简+history_data(核心配套)→ read/write 增强 → diff_data。
- `2026-07-31-unify-error-model/`:错误处理三档模型(`recoverable` 回灌 LLM / `fatal` emit+中断 / `observable` 记 trace 不中断)+ 各层(工具/中间件/agent/emit)按 `routeError` 纯函数路由 + `onEvent('error')` payload 结构化(severity/code,向后兼容)。期一 patch(内部路由)/ 期二 minor(payload 扩展)。与 observability 协同。
- `2026-07-31-declarative-middleware-ordering/`:装配机制统一(B+E)—— ① 中间件 priority 声明式排序(`MIDDLEWARE_PRIORITY` 常量 + `composeMiddlewareStack` 纯函数 + 顺序约束断言),替代 `middlewares` 数组字面量硬编码;② 运行时重配置 setter 收敛为 `createReconfigurable` 注册表(消除散落的 `infoTick++ + 条件 setX` 重复,对外方法名保留)。patch(机制化,行为不变)。建议 refactor 之后。
- `2026-07-31-observability-structured-tracing/`:可观测性升级 —— `debugLogs` 扁平数组升级为结构化 `TraceSpan` 树(round/model/tool/compression,带 timing/status/attributes)+ `getTraceMetrics` 纯函数聚合(轮延迟/工具成功率/token/重试/压缩);`inspect().trace` + `onEvent('trace')` 外发;DebugDrawer 树形渲染。`debugLogs` 保留作兼容视图。minor(新增可观测,向后兼容)。建议 unify-error-model 之后(span status 复用 severity)。
- `2026-07-31-expose-schema-constraints/`:字段约束可见性(evolve 留的后续)—— `describeSchemaNode` 纯函数结构化提取 zod 约束(类型/min/max/enum/optional/default/嵌套 shape);三处消费:`extractSchemaHint` 升级(systemPrompt「可操作数据」段带约束)+ `read` 概览段带约束(子路径读值不带)+ `schema_data` 工具(advanced)查任意路径完整约束。让 LLM 写前即知规则,减试错轮次。minor(信息增强)。建议 evolve 之后。

## 最近完成的 change(已归档)
- `archive/2026-07-31-unify-context-compression/`:双摘要合并协议统一(patch,未发布)—— 抽 `SummarySegment` 协议 + `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 纯函数(single source of truth);`trimMemoryMessagesImpl`(`rounds.ts`)与 `useContextManager.compress` 的"提取头部旧摘要"改调共享 `parseSummarySegment`(消除两处逐字重复的提取补丁)。内部重构,行为不变(两套压缩保留各自触发时机与产出格式,只统一合并逻辑)。selftest 692→696。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-react-loop-budget/`:ReAct 循环预算语义加固(patch,未发布)—— `rounds` 回归"只计工具轮"(自纠不耗 rounds,有独立预算 formatRetries/verifyAttempts);新增 `iterations` 总循环计数 + `maxIterations` 硬上限(默认 max(maxToolRounds*3, 30),经纯函数 computeMaxIterations 推导)防自纠死循环;wrap-up 兜底文案改进展引导(不再让用户"简化问题")。向后兼容(语义修正,更符合直觉)。selftest 688→692。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-optimistic-lock/`:乐观锁加固(patch,未发布)—— `hashValue` djb2(32-bit)→ cyrb53(53-bit,碰撞空间 2^53,生日碰撞阈值从 ~65536 对象升到 ~9500 万);`lastReadHash` 并发语义文档化(`maxParallelTools>1` 下 autoLock 退化为"整体快照语义",建议并发下 LLM 显式传 `expectedHash` 精确控制)。hash 不持久化无兼容问题(语义不变,LLM 只比对相等)。selftest 683→688。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-harden-model-caps-matching/`:模型能力表匹配加固(patch,未发布)—— `resolveModelCaps` first-match → longest-match(按"实际匹配子串长度"`exec[0].length` 取最具体条目,非 `pattern.source.length` —— `|` 分支会虚高 source 长度,实测 `glm-4.5` 被 `glm-4|glm4` 误压)。消除"顺序依赖"脆弱性(新模型名是旧模型子串时不再匹配错条目拿错 contextWindow);补表驱动断言锁死"已知模型名 → 预期 caps"。行为不变(当前顺序下 longest=first 结果一致)。selftest 680→683。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-fix-introspection-consistency/`:inspect 展示口径修复(patch,未发布)—— `inspect().systemPrompt` 漏中间件 augmentPrompt 段(usageHints/todos/skills/memory/subagents,getInfo 只拼 base+data+augmentSystem 另起炉灶,与实际发给 LLM 的不符)→ `createAgent` 暴露 `getEffectiveSystemPrompt()`(复用权威 `buildSystemPrompt`),getInfo 代理(单一真相源,展示=运行时)。LLM 实际收到的 prompt 本就对(向后完全兼容)。e2e 217→221。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-add-complex-preset-and-vfs-json/`:体验平面改进(复杂任务 + 超大 JSON 演进 Phase 3,2.16.0 发布)—— ① complex 上下文预设(`contextPreset:'complex'`,比例制 `windowRatio=0.6`/`summaryThresholdRatio=0.7`/`recallTopK=5`/`enableLLMSummary=true`;`preserveLastToolResults` 按 preset 取,complex 扩 `query_data`/`search_data`;映射在 `sdk/contextPreset.ts`);② vfs JSON 感知工具(`vfs_json_read` 按 jsonPath 读子树 / `vfs_json_patch` 原子 patch / `vfs_write` 增 `jsonString` 校验);③ vfs 三池分池(`large_results` 4MB / `drafts` 2MB / `userFiles` 2MB 独立 LRU,`vfs.maxBytes` 默认 8MB,`poolBytes` 可配;`drafts` 池依赖前序 change 的 `draft_write`);④ offload 结构化元数据(`OffloadResult` + 大结果 `suggestedReadPlan`)。顺带修正 vfs 工具族 source 标记 `user`→`builtin`(`VFS_TOOL_NAMES`)。minor(新增能力,向后兼容)。selftest 642→680、e2e 212→217。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-31-fix-dataops-write-correctness/`:dataOps 写路径正确性/安全修复(两缺陷合并,2.15.1 发布)—— ① 数组子项删除稀疏(`deleteByPath` 对数组元素用 `delete arr[i]` 产生 empty 槽,length 不减、序列化渲染 null 污染 hashValue/持久化/Vue reactive,四入口 delete_data/write del/edit remove/eval patches remove 全踩)→ 父为数组且末段数字索引时改 splice 移除,对象属性仍 delete(语义不变);② 白名单绕过(set_data/write(set) 在 safeMerge 后把 LLM 原始 parsed 的未声明字段无校验写回 bind)→ 删两处逐字相同的写回块,bind 严格只收 schema 声明字段(interceptors.write 转换/审计/拒绝已声明字段值不变,不再能绕白名单塞字段)。纯逻辑 patch,安全/正确性收紧。selftest 630→642、e2e 210→212。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-refactor-module-extraction/`:模块抽离重构(可维护性,纯重构零行为变化,2.14.0 发布)—— `dataOps.ts` 纯函数 → `tools/jsonUtils.ts` + `tools/schemaUtils.ts`;`useContextManager.ts` 纯函数 → `composables/contextIndex.ts`;`createChatSdk.ts` 高频改动点 → `sdk/{promptBuilder,llmResolver,conflictManager,optionsResolver,events}.ts`;开放 subpath `./storage` / `./query` / `./llm`。createChatSdk 1751→1613、dataOps 969→670、useContextManager 321→235;sec-30/31/32 白盒单测,selftest 537→630、e2e 210 全过。skillStore 桥接延后(闭包依赖深,留独立 change)。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-dynamic-reconfiguration/`:运行时资源动态加载/卸载 —— `sdk.setTools/addTool/removeTool`(用户工具动态,核心基础设施)/ `sdk.setSubagents/addSubagent/removeSubagent`(复用 tools 机制)/ `sdk.setLlm`(模型切换 + 重解析能力)/ `sdk.setMemory`(memory 动态)。复用 `let + rebind + infoTick` 模式(类比 setData/setSkills),全程向后兼容。自测 524/524,e2e 210/210。规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-30-add-augment-system-hook/`:动态 system prompt 注入钩子 `augmentSystem(ctx)`(集成方按运行时状态注入部分 schema / 组件说明)+ A4「可操作数据」段改为每轮随 data 动态(修 `setData()` 不同步 Bug,经 `dataHint` 中间件)。复用 augmentPrompt 中间件机制,不污染 `HarnessState`。规范已合入 `openspec/specs/page-agent-core.md`。自测 495/495,e2e 189/189。
- `archive/2026-07-24-add-verify-middleware/`:Verify 自检中间件(`beforeReturn` 钩子点 + `createVerifyMiddleware` + `createWriteBackCheck` 写后读回 + 对抗验证)。对应 `doc/evolution-roadmap.md` #5。自测 146/146,规范已合入 `openspec/specs/page-agent-core.md`。
- `archive/2026-07-23-generalize-chat-sdk/`:通用化(provider 抽离 / headless / capabilities / MCP / presets)。
- `archive/refactor-to-chat-sdk-sdk/`:重构为框架无关页面内 Agent SDK(规范已合入 `openspec/specs/page-agent-core.md`)。
