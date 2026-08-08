# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。

## 项目概述

`page-agent-sdk`(npm 包名,仓库目录仍名 `zhuanti-agent`)是**框架无关的 JS SDK**:对话框形态挂载到任意网页,内置 ReAct 模式 Tool-Calling Agent,通过自定义 tool 读写宿主页面 `window` 属性(属性注册表 + schema 校验)、GET 抓取文档,具备 planning / skills / 内存工作区 / context 管理能力。

**定位:规范化的 JSON 操作 Agent** —— 给 AI 一个结构化、安全的 JSON 操作通道(范围控制 + schema 校验 + jsonPath 增量 patch + 快照回退),区别于「让 AI 直接输出 JSON 字符串」的不可控方式。

采用**自研 Deep Agents 风格 harness**(规避 `deepagentsjs#292` 浏览器打包阻塞,不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent-sdk.{js,umd.cjs,iife.js,css}`;类型声明 `types/index.d.ts`(手动维护);入口 `src/index.ts`

## Agent 身份

通用「JSON 操作助手」(规范化 JSON 操作 agent)。systemPrompt 由 `createChatSdk({ systemPrompt })` 注入,不硬编码业务身份。
**默认 systemPrompt**:用户不传时,`createChatSdk` 内置 `DEFAULT_SYSTEM_PROMPT`(身份 + 能力概述 + `systemPromptHelpers.reliableWriteRules`,用 `---` 分隔线区分身份段与规则段);用户传了则完全覆盖。`appendReliableWriteRules` 默认 `true`:自定义 systemPrompt 末尾用 `---` 分隔线自动追加 reliableWriteRules(避免集成方忘写写入规则);设 `false` 关闭。不传 systemPrompt 用默认 prompt 时此项无效(默认已含)。`createAgent` 层另有兜底 `'你是一个智能助手。'`(直接用 createAgent 且不传时)。
**职责分工(重要)**:内置工具用法(read/write/get/set/patch/autoLock/snapshot/query/search/eval 等)由 `usageHints` 中间件按 `toolMode` 自动注入到运行时 prompt,**集成方 systemPrompt 只写业务知识**(身份、可改字段含义、业务流程、技能引用),不要重复声明工具语法 —— 升级工具时 examples 不用改、避免与 usageHints 不同步。**动态组件说明 / 按运行时状态注入部分 schema 描述**走 `augmentSystem({ state, data })` 钩子(每轮调,setData 后 data 自动同步),见 `doc/system-prompt.md` B6 段。

## 技术栈

- **框架**:Vue 3.5(打包进 SDK,对外框架无关;非 peer)
- **构建**:Vite 8(库模式 `build.lib`);**语言**:TypeScript 7
- **AI**:LangChain **浏览器子包**(`@langchain/openai` + `@langchain/core` + `@langchain/anthropic` optional),兼容 OpenAI 协议(默认接 DeepSeek)+ Anthropic 协议(`LLMConfig.provider:'anthropic'` 动态 import `@langchain/anthropic` 走 Claude 原生协议);`llm` 可传 `BaseChatModel` 实例或 `LLMConfig`。**不引 langchain 整包/LangGraph**
- **MCP**:`@modelcontextprotocol/sdk`(optional peerDep,动态 import;浏览器仅 http/sse/websocket 远程 transport)
- **校验**:zod 4;**Markdown**:`marked` + `highlight.js`(打包进库)

## 常用命令

```bash
npm run dev       # 本地开发(端口 3000;被占则自动换)
npm run build     # 库模式构建到 dist/
npm run preview   # 预览构建产物
npm run test          # 自测(tsx 跑 src/__tests__/selftest.ts,1358 项断言)
npm run test:e2e      # 集成层 e2e(node 跑 tests/e2e-integration.mjs,用构建产物 dist,362 项;覆盖各 API/配置项/功能模块/简单与复杂场景:默认 systemPrompt(含能力概述) / 动态注册与 inspect 同步 / inspect(tools/middleware/subagent/verify/mcp/todos/lastCompression/checkpoints 反映配置,含 toolMode simple/advanced/minimal) / 自定义 tools/middleware/skills/memory 注入 / switchSession(开/未开) / shareContext 开/关共享独立 / storage 后端+对象配置 / presets 三预设 / checkpoint / 导出项完整(39+ 函数/组件,含 filterByToolMode/extractSchemaHint) / 工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson) / source=builtin / mount 边界 / hook 多监听器 / llm 配置 / 乐观锁冲突人工介入(pendingConflict/resolveConflict) / read/write 高层工具 + 拦截器 / data bind 字段直连 + schema .describe() 自动注入 + input/output 拦截器 / 错误场景)
npm run test:browser  # 浏览器 E2E(Playwright + mock LLM,跑 tests/browser/*.spec.ts;自动启 dev server,拦截 LLM API 返回确定性 SSE 响应;覆盖 page-demo read→write→read / human-confirm-demo 两层确认 / complex-demo 列组件+edit patch+子路径读+mission+深嵌套+配置面板+actions(save_draft/publish)+get_dom;不依赖真 LLM,可进 CI)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS` / `VITE_AI_SYSTEM_PROMPT`(必须单行)。

上下文压缩策略不经 `.env`,由 `createChatSdk({ contextOptions, summaryLlm, maxMemoryRounds, contextPreset })` 显式配置。

## 目录结构

```
src/core/                       # 通用 SDK 核心(框架无关)
├── harness/                    # 自研 agent harness(createAgent + 中间件)
│   ├── createAgent.ts          # ReAct 循环 + 中间件驱动核心
│   ├── middleware.ts           # Middleware 契约 + 执行器
│   ├── todos.ts/skills.ts/memory.ts/permissions.ts/summarization.ts/retry.ts
│   ├── subagent.ts/verify.ts/usageHints.ts/focus.ts
├── sdk/                        # createChatSdk(命令式入口)/ defineTool / promptBuilder / llmResolver / conflictManager / optionsResolver / events / contextPreset(预设比例映射)(模块抽离,见 architecture ⑫)
├── tools/                      # dataOps / fetchDoc / dataSlotQuery / jsonUtils / schemaUtils(纯函数抽离)
├── toolsets.ts                 # 内置工具集预设
├── backends/{vfs,storage,skillStore}.ts # 内存工作区 / 持久化存储 / skill 独立持久化
├── mcp/client.ts               # MCP client
├── llm/proxyLlm.ts              # 代理连接模块(防 apiKey 泄露:proxy 代理 / direct 直连)
├── composables/                # useChat / useContextManager / useMarkdown / contextIndex(压缩索引纯函数)
├── components/                 # ChatDialog / MessageContent / CodePreview / DebugDrawer
├── presets.ts / types/index.ts / index.ts
examples/                       # 各 demo(page-demo/complex-demo/subagent-demo/mcp-demo/nested-demo/planner-demo/toolsets-demo/human-confirm-demo/animation-demo/multi-agent-demo/proxy-demo/anthropic-demo)
                                # 每个 demo 目录自带 index.html(dev 入口)+ main.ts;根目录仅 index.html(主入口→page-demo)
doc/                            # architecture.md + README.md(索引)
demo/plain.html                 # 框架无关集成示例
skills/                         # 分发给使用者的 Agent Skill(integrate/release),含入 npm 包 files
```

## 架构要点

### 自研 harness
- `createAgent`:ReAct 循环 + 可插拔中间件,不绑定具体工具/能力
- **中间件契约**(`Middleware`):`beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent`/`beforeReturn` + `augmentPrompt`/`compressInput`/`tools`。before 类正序、after 类逆序、wrap 类洋葱
- 内置中间件装载序:`usageHints → todos → skills → vfs → summarization → memory → permissions → verify → subagent → 用户自定义`
- `createChatSdk` 组装:harness + 内置工具(`dataOps`/`fetchDoc` 默认装,经 `capabilities` 关闭)+ 用户 `tools`/`skills`/`memory`/`data`/`middleware`

### 数据槽操作
- 集成方声明 `data: { schema, bind, description? }`(单主对象;bind 直连 reactive/普通对象,工具直接读写 bind,不挂 window);工具:`describe/get/set/edit/delete_data` + `snapshot/list/restore_data` + `query/search_data` + `eval_script` + 高层 `read/write`
- **运行时替换 data**(懒加载/动态 schema 场景):`sdk.setData({ schema, bind, description? })` 替换整个主数据配置,`sdk.getData()` 读取当前;`createDataOps` 返回的工具数组上挂不可枚举 `controller`(操作同一闭包,工具运行时即时生效,无需重 bind);`inspect()`/`verify`(`createWriteBackCheck` 的 `schemas` + `root` 均改 getter 实时取最新 bind/schema)反映替换。替换后旧快照清空、乐观锁 hash 重置
- `set/edit/delete` 仅限 schema 声明字段(白名单内);`set/edit` 按 schema 校验,不合法返回结构化错误(不写入)
- `edit_data` 按 `jsonPath` 发 patch(set/remove/merge/append),避免 LLM 重传整个大 JSON;就地写回改子属性不替换根引用 → 兼容 Vue reactive
- 快照回退:`set/edit/delete` 前自动存快照(per-path 栈);`restore_data` 一键回退
- **乐观锁(`expectedHash`)+ 冲突人工介入**:`get_data` 返回值附 `hash=xxx`;`set/edit/delete` 传 `expectedHash` 启用乐观锁——若属性在 agent get 之后被外部代码/其他 agent/用户手动改过(hash 不匹配)则触发冲突。集成方传 `createChatSdk({ ... })` 时默认开启人工介入:工具挂起,`sdk.pendingConflict`(响应式 ref)置为冲突信息,内置 ChatDialog 渲染冲突条让用户三选一 → `sdk.resolveConflict('keep_external'|'overwrite'|'restore')` 收口,工具继续。headless 集成方可 watch `pendingConflict` 自建 UI。不传 `expectedHash` → 向后兼容直接写(不校验)。`DataOpsOptions.onConflict` 可独立用于 `createDataOps`(不接 ChatDialog 时自行处理)
- **高层读写工具 `read`/`write`(2.2+)**:合并 list/describe/get 与 set/edit/delete + 自动乐观锁(`autoLock` 默认 true,用 LLM 最后 read 的 hash)+ 自动快照。`read({jsonPath?, fields?, depth?})` 列出/读取(支持 `fields` 字段裁剪 + `depth` 深度截断减体积);`write({value?, patch?, patches?, del?})` 四意图(整体 set 直传 object / 单 patch 增量 / **批量 `patches` 原子应用多 patch 任一失败回滚** / 删除)。降低 LLM 认知负担。`eval_script` transform 支持返回 `{patches:[...]}` 增量模式(避免大对象整体重传)
- **schema 形状自动白名单(2.4+)**:`data.schema` 为 `ZodObject` 时,顶层声明的 key 自动作为可读写白名单 —— `read` 整体读按 schema 投影隐藏未声明字段,**子路径读也按该位置的子 schema 递归投影**(如 `read components.0` 按 elements schema 隐藏 child 未声明字段);`write`/`edit`/`delete` 的 `jsonPath` **逐段校验**必须在 schema 声明内否则 `PATH_DENIED`;整体 set / set_data / eval transform 自动转 **merge 语义**(只更新声明字段,未声明字段保留防误删);**`interceptors.write` 补充的不可见字段(不在 schema 声明)在 schema 校验 + merge 后写回 bind,不丢失**。非 ZodObject(discriminatedUnion/record/lazy)全开放向后兼容。零新增配置,集成方用 `z.pick` 子集 schema 即生效
- **isPathAllowed 逐段校验:ZodArray 严格判 + discriminatedUnion 降级(2.17.1 bug 修)**:`isPathAllowed`/`getSchemaAtPath` 遍历 jsonPath 时,ZodArray 用 `_def.type==='array'` 字符串相等严格识别(防误判);遇 `discriminatedUnion`/`ZodUnion` 静态无 bind 不知具体 option → **降级开放**(`isPathAllowed` 返 true / `getSchemaAtPath` 返 null,后续段交 `schema.safeParse` 兜底校验)。修 pre-existing bug:旧 `_def.type` 真值判断把 union 误当 array,致 `components.N.props.X`(穿过 union 选项的嵌套 object 子字段)深层路径误 `PATH_DENIED`,complex-demo 嵌套 schema 下 evolve patches 增量改单字段几乎废掉(只能退化 merge 整体)
- **read/write/eval 增强(evolve 2.17+)**:`read` 增 `jsonPaths`(多路径一次读,非法路径单项标错不整批失败)+ `offset`/`limit`(仅数组目标分页,返回切片 + total/hasMore,默认 limit=50 上限 200);`write` 增 `dryRun`(四意图预检:走完整校验链 schema+白名单+patch 应用到 clone,但**不落盘/入快照/写 bind**,乐观锁冲突照常检测返回 VERSION_CONFLICT 不挂起);`eval_script` 增 `jsonPath`(子树模式:仅 clone/执行子树降大 JSON 成本,子树>100KB 超时自适应延至 8s;transform 返回值作为子树新值 set 到子路径 + 整体校验)
- **分块写 draft_write/draft_commit(Phase 2,opt-in)**:几百 K JSON 逼近 LLM `max_tokens` 单次 write 装不下 → 分块构建(类 git add→commit)。`draft_write({draftId, chunk, mode})` mode:start 新建/append 追加(拼 JSON 片段到 vfs drafts 池);`draft_commit({draftId})` 合并+`JSON.parse`(失败 JSON_INVALID)+ schema 校验(失败 SCHEMA_INVALID,草稿保留可修后重试)+ 原子写 bind + 快照(成功清草稿)。draft_commit 走乐观锁(`expectedHash`/`autoLock`;draft 跨多轮累积期间 bind 被外部改过 → 触发冲突人工介入,不静默覆盖,A1)。**复用 `commitSetToBind` 纯函数**(抽自 write(set) 的校验+快照+merge+audit 链,与 set_data/writeSlot 共用,单一真相源)。`capabilities.draftWrite` 默认关(opt-in;需 dataOps+vfs;toolMode advanced 暴露,simple/minimal 隐藏)。小改仍用 write/patch,draft 只在大 JSON 从零生成。**分块构建是多轮**(draft_write×N + draft_commit + read 确认),默认 `maxToolRounds=10` 可能触顶被截断,大 JSON 场景建议集成方调到 20-30(A5)。其余加固项(A4 子路径 hash / A2 快照字节 / A3 惰性 hash / B1 中间校验 / B2 池淘汰显式化 / C1 多草稿合并 / C2 eval 子树 patches)评估推后,见 `openspec/changes/archive/2026-08-04-harden-large-json-write/`。新增导出 `commitSetToBind`
- **历史与差异工具(evolve 2.17+)**:`history_data({id?,jsonPath?})`(归 simple,只读查看快照默认最近,填 list_data_snapshots 仅元信息 / restore_data 破坏性之间的空档,**不改当前 bind**);`diff_data({snapshotId?,against?})`(归 advanced,对比当前与快照/一段 JSON 返结构化 `{path,from,to}[]`,纯函数 `diffObjects` 顶层导出);`snapshot_data`/`list_data_snapshots` **已彻底移除**(simplify-toolset,被 `history_data({list:true})` 吸收列出快照时间线;手动检查点靠 set/edit/delete 自动快照)。`toolMode` simple=7 / advanced=14 / minimal=2
- **字段约束可见性(expose-schema 2.17+)**:`describeSchemaNode(schema)` 纯函数结构化提取 zod 约束(返回 `{type,constraints?,optional?,nullable?,default?,description?}`,**zod 4.4+ adapter**:集中 `readCheckDefs`/`describeSchemaNode` 的 switch,结构探测失败返 type-only 兜底 + dev 模式 console.warn 去重;未来 zod5/别的库只改 adapter,接口与消费不变);两处消费:`extractSchemaHint` 注入 systemPrompt「可操作数据」段带 `key (Type)[约束]: desc` + `schema_data({jsonPath?})` 工具(advanced)查任意路径完整约束(含嵌套 shape)。read 概览段**不带**约束(去 systemPrompt 重复)。新增导出 `describeSchemaNode`/`renderSchemaHint`/`renderSchemaOverview`/`formatConstraints` + `SchemaNodeDesc`。**大 schema 分层披露(add-schema-tiered-disclosure)**:`extractSchemaHint(schema, opts?)` 阈值触发(默认 maxKeys=15/maxChars=4000,集成方经 `schemaHint` 配置可调)→ 大 schema 自动转「顶层概览」(`renderSchemaShallow`:key+type+一句描述,**不带**约束/不递归 shape)+ 尾部提示(深层约束查 `schema_data`);小 schema(≤阈值)仍全量(现状不变,无感)。新增 `renderSchemaShallow`/`SchemaHintOptions` 导出
- **`toolMode` 工具呈现模式**(`simple` 默认 / `advanced` / `minimal`):simple 主推 read/write,隐藏底层 7 个(describe/get/set/edit/delete/schema_data/diff_data;snapshot_data/list_data_snapshots 已移除),共 **7 个**数据工具(read/write/query_data/search_data/eval_script/restore_data/history_data);advanced 全暴露(**14**);minimal 只 read/write(2)。`filterByToolMode(tools, mode)` 纯函数筛选(已导出);`usageHints` 按 toolMode 注入提示
- **`interceptors` 读写拦截器**:`read(value)` 脱敏/派生(只改 LLM 看到的值,无 path 参数),`write(payload, current)` 转换/审计/拒绝(返回 `{error}`)。透传给 `createDataOps`。`input(input)`/`output(json)` 在 agent IO 入口/出口预处理/后处理(send 入口改写 user message / 返回前改写 reply)
- **`data` 单主对象配置**:`data: { schema, bind, description? }`。`bind` 必填,直连 reactive/普通对象(工具直接读写 bind,响应式刷新;SDK 不再自动挂 window,集成方按需自己挂)。`schema` 字段的 `.describe()` 经 `extractSchemaHint`(已导出)提取注入 systemPrompt「可操作数据」段。底层走 schema 校验 + 乐观锁(整体 bind hash)+ 快照栈,不绕过安全边界。LLM write → 响应式自动更新;集成方改对象 → LLM read 可见。运行时替换:`sdk.setData(config)` / `sdk.getData()`(替代旧 add/remove/listDataSlots)
- 大结果外存:工具结果 > 6000 字符转存 vfs,只留预览 + `vfs_read`/`vfs_grep` 引用;`offloadLargeResult`(`src/core/utils/offload.ts`)返回结构化 `OffloadResult`(`{offloaded, content, path, totalChars, preview, suggestedReadPlan}`,`createAgent.ts` 调用处取 `.content`,未转存时 `offloaded=false` 直传原文)
- **vfs JSON 感知工具(2.16+)**:`vfs_json_read({path, jsonPath?})` 按 JSONPath 读 vfs 中 JSON 子树(避免整文件读);`vfs_json_patch({path, patches})` 增量改 vfs 中 JSON(原子应用);`vfs_write` 增 `jsonString` 参数(直传 JSON 字符串写入,自动 parse 校验)。区别于 `vfs_read`/`vfs_grep` 的纯文本语义
- **vfs 三池分池(2.16+)**:`large_results`(默认 4MB)/`drafts`(2MB)/`userFiles`(2MB) 三池独立 LRU;`vfs.maxBytes` 默认 8MB,`poolBytes` 可单池配置(如 `{largeResults: 8MB}`)。`store.files` 接口不变(单 `Record<string, VfsFile>` + 内部按池 LRU 淘汰)。`drafts` 池依赖前序 change 的 `draft_write`(未实现,池空占位)
- **零桥接**:工具直接读写 `bind`(reactive 对象,响应式刷新);审计:set/edit/delete/restore 记日志
- 详细工具语义/JSONPath 子集/sandbox 禁用列表/错误码见 `src/core/tools/dataOps.ts` 与 `dataSlotQuery.ts`

### 记忆管理
- 上下文压缩(纯内存、会话级):`summarization` 中间件复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回);`contextPreset`:`auto`(默认)/`conservative`(省成本)/`aggressive`(省上下文)/`complex`(2.16+,长任务/大 JSON,比例制:`windowRatio=0.6`/`summaryThresholdRatio=0.7`/`recallTopK=5`/`enableLLMSummary=true`;`preserveLastToolResults` 按 preset 取——complex 扩 `query_data`/`search_data`;预设比例映射在 `src/core/sdk/contextPreset.ts`,非 `useContextManager.ts`)
- **压缩后不丢关键信息(内置保障)**:① `summarization` 压缩时自动注入当前主数据 description 快照进摘要 system 消息(`getRegisteredData` 由 createChatSdk 内部注入,防 LLM 基于过时记忆操作已卸载的动态组件);② `contextOptions.preserveLastToolResults`(默认 `['describe_data','read']`)跨轮摘要时保留这些工具的 result 摘要片段(防字段描述被摘要掉,设 `[]` 关);③ `set`/`edit`/`delete` 成功返回附「当前可操作 path 列表」(超 8 项或过长只报数量);④ 导出 `systemPromptHelpers.reliableWriteRules`(改前先 get、动态先 list、字段以 describe 为准、写错看校验错误重试、优先 edit 增量)建议拼进 systemPrompt
- **双摘要协同(2.4+)**:`summarization`(compressInput,上下文窗口压缩,不改 messages 原数组)与 `trimMemoryMessages`(afterRound,内存 OOM 裁剪,splice 进 messages)独立运行。为防 `groupRounds` 跳过头部 system 导致 trimMemoryMessages 累积的【更早对话摘要】被 summarization 静默丢失,`compress` 现提取头部旧摘要正文并入新摘要的【更早累积摘要】段。配置建议:`maxMemoryRounds >= summaryThresholdRounds`(否则 trimMemoryMessages 先裁,summarization 永不触发)
- **跨轮召回纳入工具结果 + trim 异步 LLM 增强(recall-and-trim-llm)**:① 关键词召回(`recallRounds`)匹配串纳入 `steps.result`(`plainSummary` 截断 120 字),跨轮工具结果可被关键词命中(解「之前 read 出来的 X 搜不到」);② trim(`trimMemoryMessagesImpl`)触发后**同步模板占位 + 异步 LLM 增强**:若 `enableLLMSummary`(默认 true,conservative 关)+ `summaryLlmInvoke`,fire-and-forget 用 LLM 重摘要 older 轮次替换模板(照 `titleLlmInvoke` 模式),`messages.indexOf(summaryMsg)` 竞态守卫(未被动过才替换),失败/无 invoke 保留模板(优雅降级)。`trimMemoryMessagesImpl` 返回值增 `older`/`prevSeg`(纯函数不变);新增纯函数 `composeTrimSummary`。afterRound 保持同步 void 契约
- **上下文持久化韧性(context-persist-resilience)**:① **mission/workingMemory 跨刷新持久化**:`SessionSnapshot` 增 `mission?`/`workingMemory?` 字段(`SnapshotKind`/`SNAPSHOT_KINDS` 同步增),`persistRuntime` 存 / `applySnapshot` 读(useMission/useWorkingMemory 门 + 非空守卫);workingMemory 补 `restore(wm)` 写回闭包(mission 复用 setMission);**switchSession 切走前补 persist**(防 setMission/积累后未发消息即切会话丢)。② **trim 收口**:`trimMemoryMessages` 删 older 前 emit `context_trimmed` 事件(dropped 完整原文 + `vfsResults` 被删轮引用的 vfs 大结果原文 + summary,集成方可归档),删后**可达性 GC**(`extractVfsRefs` 扫剩余 messages 提 `large_results/` 引用 → `gcVfsLargeResults` 删不可达;纯函数 `utils/vfsGc.ts`);GC 触发三处:trim 后 / clear(resetSession 已 `vfsStore.clear`)/ 加载(applySnapshot 兜底清历史孤儿);只删不可达(被引用留),LRU 硬上限(被引用总量超 `large_results` 池默认 4MB)仍淘汰。**澄清**:vfs 在 storage 开时**已持久化**(persist 钩子 + hydrate 恢复,非「刷新即丢」—— context-history-resilience B3 修正)
- 纯内存上限:vfs `maxBytes`(默认 8MB,三池分池 LRU 淘汰,见上「vfs 三池分池」);对话历史 `maxMemoryRounds`(默认 50)超限压缩为摘要 system 消息

### 持久化存储
- **默认关闭,赋值开启**:`storage: 'indexed'|'session'|'local'|'memory'` 或配置对象
- 三层命名空间:`DB → agentId → sessionId`;`options.id` 必传稳定值(多 agent 隔离)
- 可注入后端(Idb/WebStorage/Memory),不可用自动降级内存;配额/LRU 淘汰;`switchSession` 切上下文
- `shareContext: true` 同 `id` 多实例复用同一 `AgentCore`(同页多对话框视图)

### 对话鲁棒性
- 模型调用自动重试(`harness/retry.ts`):网络/429/5xx 指数退避(默认 `maxRetries`=2);4xx 与 abort 不重试
- 停止生成(abort):signal 穿透到 `llm.stream`;abort 时保留已生成 partial
- 自定义中间件外接:`createChatSdk({ middleware: [...] })` 拼到内置栈末尾;`Middleware` 类型已导出
- **onEvent 事件回调**:`createChatSdk({ onEvent })` 订阅常用时机(`data_change`/`message_update`/`tool_call`/`tool_result`/`text`/`round_start`/`done`/`usage`/`session_restored`/`error`),供外部联动替代轮询;`approval_request` 不外发;流式事件仅 stream 模式(UI 默认 stream;`send` 走 invoke 无流式事件,但 window/message/error 仍发)。内部由 `sdk-events` 中间件 + `core.stream` 包装实现
- **sdk.hook() 实例方法**:`sdk.hook(handler) => () => void` —— 运行时动态订阅(可多个监听器、可取消),与构造时 `onEvent` 互补;`AgentCore.listeners` 集合,`shareContext` 时多实例共享;`sdk-events` 中间件始终装载(无监听器时 emit 为 no-op)
- **便捷 API**:`sdk.exportData()` 深拷贝主数据 bind(备份/迁移);`sdk.importData(json,{validate?,emit?})` 整体替换 bind(就地还原保留 reactive 引用,默认经 schema 校验);`sdk.setSkills(skills)` 运行时替换整个 skill 列表(同名覆盖,清 skill 全文缓存,下轮 system prompt 索引重渲染,下次 `load_skill` 取最新全文含 vfs doc);`sdk.invalidateSkillCache(name?)` 主动失效 skill 全文缓存(动态 skill 内容变化时,不传清全部);`sdk.addSkill(skill)`/`sdk.removeSkill(name)`/`sdk.listUserSkills()`/`sdk.getUserSkill(name)` 用户在 ChatDialog 创建/编辑/删除/列出/读取 skill(独立 SkillStore 持久化,默认 indexedDB,与 storage 选项分离,即使 storage:false 也持久化;跨刷新恢复;仅管用户创建的,不删集成方 initialSkills);`sdk.usage` 累计 token 用量(prompt/completion/total_tokens,每轮 LLM 调用累加);`onAudit` 选项独立于 debug 的结构化审计回调(set/edit/delete/restore 全程追溯)
- **运行时动态重配置(零破坏,不调用 = 现状)**:`sdk.setTools(tools)`/`sdk.addTool(tool)`/`sdk.removeTool(name)` 运行时增删用户工具集(内置不动,内部 rebindTools 重新绑定到 LLM,下一轮即生效;支持按权限/业务阶段/A-B 实验动态切换工具组,无需重建 agent);`sdk.setLlm(llm)` 运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider;参数为 BaseChatModel 或 LLMConfig;rebind + 重解析模型能力 contextWindow/maxOutputTokens;summaryLlm 不受影响;新模型不支持 bindTools 则工具调用失效但 agent 不崩);`sdk.setMemory(source)` 运行时更新持久指令 memory(支持 `string` 与同步/异步函数 source;异步函数后台求值,适合 RAG 加载文档,`sdk.refreshMemory()` 强制重新求值;下一轮 augmentPrompt 注入最新);`sdk.setSubagents(configs)`/`sdk.addSubagent(config)`/`sdk.removeSubagent(id)` 运行时增删预声明子 agent(经 SubagentsController 重新生成 use_<id> 委派工具 + 触发 rebind;需创建时配 `subagents:[]`,否则 controller 为 null,setter warn 不抛错)。所有 setter 触发 `infoTick++` → DebugDrawer 实时刷新;`inspect()` 的 tools/model/memory/subagent.subagents 均动态取最新
- **工具重名覆盖语义(2.23+)**:装配期 `dedupeTools`(`src/core/sdk/toolRegistry.ts`)跨最终工具集(内置 + 用户 + MCP + subagent 委派)按名去重,**重名 = 后注册者覆盖先者 + console.warn**(对齐 page-agent「重名 = 覆盖」,非静默 return);`sdk.addTool` 同名覆盖(含 builtin,带 warn);`sdk.removeTool` 仅删用户工具(builtin 不动 —— 禁用内置用 `capabilities` 开关而非 removeTool)
- **SkillPanel 组件**:ChatDialog 内置「🧩 Skill 管理」面板(顶部按钮触发),用户可创建/编辑(点击已创建 skill 加载到表单)/删除自定义 skill(name+description+content),提交调 `sdk.addSkill`(自动入 agent + 独立 SkillStore 持久化)。`SkillPanel` 已从入口导出供自建 UI 复用
- **SkillStore(独立持久化)**:`skillStorage` 选项配置用户创建 skill 的独立持久化(与 `storage` 选项分离)。默认 `{ backend: 'indexed' }`(即使 `storage:false` 也持久化);`false` 关闭(仅当前会话);`id` 手动指定同一 id → 跨页面/跨 agent 复用同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离。`backends/skillStore.ts` 实现,复用 `StorageBackend` 接口(Idb/WebStorage/Memory),后端不可用降级内存
- ⚠️ 错误判定**先排除 abort 再判 status**
- **三档错误模型(unify-error 2.17+)**:`AgentError.severity`(recoverable 回灌 LLM 自纠 / fatal emit+中断 / observable 记录不中断);**内置 catch 点用简化硬编码路由**(coreExecTool 工具错总 recoverable 转 ToolMessage 回灌 / afterAgent·emit 回调错 observable warn / invoke 致命错 fatal emit+中断)经 `asAgentError(err, defaultSeverity)` 归一化(默认未分类 Error=fatal,保守暴露问题);`routeError`/`asAgentError`/`agentError` 公共工具导出(**框架内置 catch 当前未消费 `routeError`** —— 供集成方自定义中间件 catch 按 severity 决策 + 为未来 `wrapToolCall` 实现 recoverable→feedback 自动路由预留扩展口,届时仅改执行器,catch 点/接口零改动);`onEvent('error')` payload 带 `{severity?,code?,context?}`(向后兼容,旧监听器读 message 不破)。重试判定(`isRetryable`)与 severity 正交。新增导出 `ErrorSeverity`/`AgentError`/`ErrorRouting`/`routeError`/`asAgentError`/`agentError`
- **上下文健壮性(harden-context-resilience)**:**窗口 ≥200K 硬约束**(`MIN_CONTEXT_WINDOW=200000`,`createChatSdk` 启动/`setLlm`/子 agent 解析后 <200K throw,排除 128K 档主流如 DeepSeek/GPT-4o,SDK 默认 GLM-5.2/Claude/Kimi/Qwen-1M/DeepSeek-v4)。**三闸阈值跟随窗口**(offload/trim/compress 经 `createAgent.setModelCaps` + 各中间件 `setContextWindow` controller,`setLlm` 后回灌新窗口,修原创建时固化)。**预防**:H1 逐轮 trim(token 口径,单轮 ≤60% 窗口)+ H2 compress over-window warn。**反应性兜底**:`coreModelCall` 双 catch(启动 + 迭代)识别 `isContextLengthError`(`harness/errors.ts`,复用 langchain `ContextOverflowError` + 兜底正则;不进 `isRetryable`,职责正交)→ 激进 trim(30% 窗口)→ 单次重试(`_ctxRetry` 防死循环)→ 仍超抛(不裸失败)。**vfs 引用保护**:`VfsStore.setProtectedRefs(extractVfsRefs(msgs))` stream 入口注入;LRU 跳过被引用 large_results(防 vfs_read 404);OOM 池 >1.5× 强制删兜底(防全池被保护不收敛)。**系统段预算**:`buildSystemPrompt` 超 25% 窗口 → 非 pin 段从大到小 drop(保 base/mission/workingMemory);systemPrompt 本身超预算 → stream fatal 早退(`SYSTEM_PROMPT_OVER_BUDGET`,不进 ReAct)。新增导出 `isContextLengthError`/`MIN_CONTEXT_WINDOW`

### 自适应规划(Planning,add-adaptive-planning)
- **两个互补工具**:`write_todos`(整表替换,拆解多步任务)+ `update_todo({id, content?, status?})`(按 id 增量改单项,执行中动态修订,不必重传整个清单)。`Todo` 含稳定 `id`(`write_todos` 时框架按 index 生成 `t-1/t-2...`,LLM 可显式传;hydrate 旧数据按 index 补)。一轮内两者不可混用(整表替换 vs 增量语义冲突);`update_todo` 找不到 id → `TODO_NOT_FOUND`。规划工具 source 标 builtin
- **规划阶段防死循环(`maxPlanRevisions`,默认 5,与 `maxIterations` 总闸正交)**:首次 `write_todos` 进入 planning → 每轮 `beforeModel` 计数(含 read/query/search 调研轮——调研也算规划成本)→ 主数据写工具(write/set_data/edit_data/delete_data)成功退出 → 超限回灌「停止调研/修订,基于当前清单执行」(不强制终止,`maxIterations` 兜底);退出后可重入(单阶段计数重置,允许多次「规划→执行→再规划」)。防「光规划不执行」死循环
- **自适应 prompt 引导(prompt 层软约束,非框架硬约束)**:`usageHints` planning 段按复杂度分流(简单直接 read/write;复杂先 write_todos 拆解)+ `update_todo` 增量修订引导 + 规划方案用 `request_human_confirmation` 确认;内置 skill `adaptive-planning`(入 npm `skills/` 分发)。**复杂度判断由 LLM 完成,框架不做启发式检测**(避免 mission-anchor 评估的 capture 误判争议)
- `inspect().planPhase` 反映 `{inPlanning, rounds, limit}`;`capabilities.planning:false` → 不装(两工具 + 防死循环均不生效,现状)。选型见 `openspec/changes/2026-08-01-add-adaptive-planning/decision-record.md`;能力边界见 `doc/archive/capability-boundaries.md`

### Mission 任务目标锚定(revive-mission-anchor Phase 1)
- 会话级 Mission 状态 `{goal, acceptanceCriteria?, sourceMessageIdx, capturedAt, explicit}`,长任务目标锚定(防跑偏 + 压缩丢主线)。与 adaptive-planning 正交(planning 管步骤,mission 管目标)
- **capture**:首条「任务型」user 启发式(非空/非问候/含任务动词,不调 LLM)+ `send({mission})`/`setMission` 显式覆盖;偏保守(宁漏不误,集成方 `setMission` 兜底)
- **pin 段天然跨压缩**:`augmentPrompt` 每轮注入「## 当前主线目标」(mission 在 state 不在 messages → `compressInput` 不碰 → 不随 older 丢;**无需改 summarization**)
- SDK API:`getMission()` / `setMission({goal?,criteria?})`(合并;`{}` 清空)/ `send(text,{mission?})` / `inspect().mission`
- `capabilities.missionAnchor`(分层默认核心,**默认开**;`false` 关 = getMission undefined + setMission warn 不抛)。定位升级重启,见 `doc/archive/complex-agent-roadmap.md` Phase 1

### 跨压缩工作记忆 workingMemory(revive-cross-round-working-memory Phase 1)
- 解锁:几百 K 频繁压缩 → read/query 定位的 path + read 的 hash 随 older 轮次丢 → LLM 重复检索(浪费 token)+ 凭记忆写致乐观锁 `autoLock` 误冲突
- **自动捕获**(`wrapToolCall` after next,不调 LLM):`read`/`query_data`/`search_data` 结果 → `locatedPaths`(LRU ≤10 去重);`read` 结果的 `hash=` → `lastHashes[path]`(LRU ≤10);其他工具不捕获
- **pin 段天然跨压缩**:`augmentPrompt` 每轮注入「## 工作记忆(跨压缩保留)」(workingMemory 在 state → `compressInput` 不碰;**无需改 summarization**,同 mission)
- 与 `preserveLastToolResults` 互补(preserve 保工具结果摘要防字段描述丢,workingMemory 保 path/hash 结构化防定位丢);与 mission 正交(mission 管目标,workingMemory 管中间态)
- `capabilities.workingMemory`(分层默认核心,**默认开**;`false` 关 = 不装);`inspect().workingMemory` 反映 pin(locatedPaths/lastHashes)

### 上下文聚焦 Focus(focus-context)
- 多组件页面精修其中一个:聚焦后 agent 的**目标/视野/范围三层收敛**到单组件子树(会话级焦点 `{ path, label? }`,path=jsonPath 锚点如 `components.3`),避免改到别处
- **三层收敛**:① 目标提示(augmentPrompt 注入「## 当前精修目标」);② 视野收敛(注入 `getSchemaAtPath(schema, path)` 子树 schema 描述,LLM 每轮只看该组件结构,不看其他组件);③ 范围收紧 **strict**(wrapToolCall 对写工具拦截,`jsonPath` 不以 `focus.path` 为前缀 → `PATH_DENIED` 越界回灌 LLM 自纠;读工具不限,用户仍需看全量上下文)
- **pin 段天然跨压缩**:focus 在中间件 state(不在 messages)→ augmentPrompt 每轮注入 → `compressInput` 不碰(同 mission/workingMemory,无需改 summarization)
- **三种触发**:① `sdk.setFocus(path,{label?})`/`clearFocus` API(集成方/宿主点击拾取);② agent 工具 `set_focus`/`clear_focus`(`toolMode:'advanced'` 暴露,simple/minimal 经 UI/宿主 API 触发);③ ChatDialog 焦点条(头部 chip:✕ 退出 · ▾ 编辑路径切换)
- `setFocus` 校验 path **类型合法**(`getSchemaAtPath` 命中才可聚焦;类型校验非数据存在性 —— 数组索引 `components.5` 类型合法可聚焦,即使数据不足 6 个);非法返回 `{ok:false,error}` 不抛。前缀边界:`components.10` 不误匹配 `components.1`(用 `.` 分隔判)
- `capabilities.focus`(分层默认核心,**默认开**;`false` 关 = 中间件/工具不装 + setFocus no-op);`inspect().focus` 反映焦点;`Focus` 类型导出
- 与 mission 正交(mission 管任务级目标,Focus 管对象级精修;共存不冲突);聚焦 opt-in(需主动 setFocus 才生效,默认不聚焦行为与现状完全一致,向后兼容)
- **focus-auto-switch(自动切换全局/局部 · 持久化 · 子 agent 继承)**:① **usageHints 引导**:advanced + `capabilities.focus` 开 → 注入「上下文聚焦」段(局部任务→`set_focus` / 全局任务→不聚焦 / 完成→`clear_focus` / 先 read 定位 path),门控 `rc.focus && !simple`(同 `set_focus` 工具 advanced-only 暴露)—— agent 自动判断任务范围切换;② **持久化**:focus 进 `SessionSnapshot`(照抄 mission 模式,`SnapshotKind` 加 `'focus'`),`persistRuntime` 每轮落盘 + `switchSession` 切走前补存,`applySnapshot` 恢复并经 `getSchemaAtPath` 校验 path(schema 变化失效丢弃,与 `sdk.setFocus` 单一真相),`clearFocus` 后存 `null` 覆盖清除(防旧值残留);③ **子 agent 继承**:主 agent 聚焦 → `spawn_agent`/`spawn_agents`/预声明 `use_<id>` 子 agent **默认继承同一焦点**(`createFocusMiddleware` `initialFocus` 构造参数,三层收敛);主未聚焦 → 子 agent 无 focus 中间件(零回归);`SubagentOptions.getFocus`/`getSchema` 透传主 `liveData` schema
- 点击拾取宿主契约:组件根绑 `data-path` → 点击调 `sdk.setFocus(path)`(见 `examples/complex-demo` PageRenderer/CompRenderer)
- 中间件 `harness/focus.ts`(`createFocusMiddleware`);装载在 workingMemory 后(mission/workingMemory/focus 同为 Infinity 靠声明序的 pin 段,不进 MIDDLEWARE_PRIORITY 表);wrapToolCall 拦截模式同 permissions(extractScopes 兼容 write 的 patch/patches 嵌套)

### 子 agent 与并行编排
- `spawn_agent`/`spawn_agents`(subagent 中间件,默认开启):委派独立子 agent 跑子任务,只把最终结论返回主上下文(省 token)
- 预声明子 agent:`subagents: [{ id, description, ... }]` 自动生成 `use_<id>` 委派工具(Claude Code 风格)
- `maxDepth`(默认 1)递归物理切断;子 agent 只读工具子集,排除 spawn 防递归
- 示例:`examples/subagent-demo/`

### MCP
- `createChatSdk({ mcp: [{ transport, url, name? }] })` 连远程 MCP server,动态注入 tools(`Promise.allSettled` 故障隔离)
- 动态 import `@modelcontextprotocol/sdk`(仅用时加载);MCP `inputSchema` 直传 LangChain `tool()`
- dev 预构建坑:`vite.config.ts` 的 `optimizeDeps.include` 已预声明 SDK 子路径,否则冷启动首次注入失败

### Verify 自检中间件
- `capabilities:{verify:true}` 开启(默认关,烧 token);agent 返回前跑 `check`,不通过则 feedback 回灌自纠(限 `maxAttempts`)
- 内置 `createWriteBackCheck()`:扫描写操作读回 + schema 校验;读回根对象优先用 `root` 选项(单对象 data 模型传 `bind`/getter,适配 `sdk.setData` 运行时替换),省略则回退 `window`(旧 windowProps 模式向后兼容);自定义 `verify:{ check: async ({messages,state}) => ({ok, feedback?}) }`
- adversarial 对抗验证(可选):check 通过后 spawn 只读子 agent 找茬

### DOM 读取与宿主动作(胜任自动化 agent 的"看"与"做")
- **`get_dom` 工具**(`capabilities.domInspect:true` 开启,**默认关** —— 读 DOM 有 token 成本,opt-in):agent 读渲染后 DOM,结构化返回 `{tag, attrs, text, children[]}`(`depth` 控制遍历深度默认 3 防爆炸;`attrs` 默认白名单 id/class/style/href + data-*,传了 = 严格白名单;深度截断处报 `childCount` 不展开)。区别于 `eval_script`(沙箱自由脚本返回文本):get_dom 结构化 JSON + 只读 + 深度可控 + 属性白名单(不暴露敏感 attr)。场景:改完数据回看渲染是否生效、定位元素、辅助 UI 设计问答。纯函数 `domToStructure(node, opts)` 可单测(与浏览器解耦);大结果自动外存 vfs。手动注入:`import { domTools } from 'page-agent-sdk'` 展开 tools
- **`inspect_env` 工具**(`capabilities.inspectEnv` 默认**开**):轻量环境探查(排查调试刚需)。无参返回 window 安全摘要(`location` URL/origin/path、`navigator` 浏览器/语言/在线、`viewport` 视口尺寸/DPR/滚动、`document` title/readyState);传 `key` 读指定 `window[key]`(集成方挂的调试变量,如 `inspect_env({key:"appConfig"})` 读 `window.appConfig`)。`safeSerialize` 跳过 function/DOM/循环引用 + 限深度/键数/长度截断防超大。区别于 `get_dom`(DOM 结构深度遍历,opt-in,有 token 成本):inspect_env 轻量只读环境摘要**默认开**,排查"当前 URL/浏览器/视口/调试变量值/为何没生效"。纯函数 `safeSerialize`/`getEnvSummary` 可单测(与浏览器解耦);`import { inspectTools } from 'page-agent-sdk'` 手动注入
- **`actions` 宿主动作**(类 `tools`,非 capabilities 开关):`createChatSdk({ actions: { name: { description, run, params? } } })`,SDK 自动把每个 action 包成**命名 tool**(save_draft/publish 等),LLM 直接看到命名 tool 调用(无需 trigger_action 中转)。`run(args)` 接收 `params`(ZodObject)解析的参数,返回值序列化回灌 LLM;**异常隔离**(run 抛错 → 错误字符串回灌 LLM 自纠,不崩 agent);非法动作名跳过 + warn。场景(自动化闭环):agent 改完数据 → 调 save_draft 保存 → publish 发布 → get_dom 看渲染。`inspect().actions` 反映元信息(name → {description, hasParams})

### Skill 脚本执行(exec)+ 附带工具(tools · skill-external-scripts)
- `SkillSpec` 扩展两可选字段:`exec`(加载时执行脚本注入实时数据)+ `tools`(附带可调工具,load_skill 后注入工具池)。全增量,现有 skill(无此二字段)行为零变
- **exec 钩子**:`{ code?, url?, context?, inject? }`,`load_skill(name)` 时执行 → 结果 append/prepend 拼进全文。`context:'sandbox'`(默认,复用 `createSandboxRunner` 三层防护:静态扫描 + `lockSandboxGlobal` defineProperty 锁网络层防 delete 逃逸 + 超时);`context:'host'` 需 `capabilities.skillHostScript:true`(宿主全权 `AsyncFunction`,不经静态扫描,**仅集成方内联 code**、非 LLM 生成非远程)。`url`+`host` 禁止(远程不可信不能全权跑)。**exec 失败不缓存**(标注 + 下次 load 重试,动态 skill 韧性);exec 大结果走 createAgent 通用 offload(>6000 转 vfs),「一次读全」仅限静态文本部分
- **tools 工厂**:`SkillToolFactory[]`,`load_skill` 后求值 → `onToolsReady` 回调 → createChatSdk 合并 `loadedSkillTools` + rebind(经 `dedupeTools`,重名后注册覆盖 + warn;建议命名空间前缀 `<skill>__<tool>`)。source 标 `skill:<name>`;`setSkills`/`invalidateSkillCache` 经 `core.unloadSkillTools` 卸载
- **沙箱引擎泛化**:抽出 `src/core/tools/sandbox.ts`(`createSandboxRunner` 柯里化 `(script, timeout) => (input?) => Promise<SandboxResult>`),eval_script 与 skill exec 共用单一真相源;`dataSlotQuery.ts` 的 `runSandboxedScript`/`lockSandboxGlobal`/`EvalResult` re-export 保外部 import 零破坏。新增导出 `createSandboxRunner`/`SandboxResult`/`runHostScript`
- **exec vs tools 语义**:exec=一次性上下文初始化(加载时拿快照注入文本);tools=反复查询能力(LLM 显式调)。正交,勿同数据双轨

### Approval 人工确认
- `approval:{ tools?, confirm?, ... }`:工具调用前 human-in-the-loop(被动白名单确认 + 主动 `request_human_confirmation` 工具)
- 默认关闭,传 `approval` 即启用;headless 集成方监听 `approval_request` 事件自建确认框

### Checkpoint 会话级回滚
- `checkpoint: true`:每轮自动存档(对话 + 主数据 bind + vfs + todos),异常/改坏时一键回退到上次正常态
- **脏标记增量(checkpoint-incremental-snapshot)**:save 从「每轮整体深 clone vfs(8MB)+bind(几百 K)」改为「脏标记增量」—— vfs 加 `_dirty`(Proxy set/delete 统一置脏,零遗漏;hydrate/clear 手动)+ `consumeDirty()`/`isDirty()`;dataOps controller 加 `markDataDirty`/`consumeDataDirty`(全写路径标脏,含 `commitSetToBind` 新增 `onWrite` 回调收敛 set 类,dryRun 不触发);save 脏或缓存空才 clone 否则复用上次 clone(闭包 `lastVfsClone`/`lastBindClone`);**restore/importStack 重置增量基线**(防 restore 后 save 复用旧基线静默错乱,跨轮 restore 测试驱动发现)。对外 API 零变(纯内部优化,长任务每轮省深拷贝)。messages 保持整体 clone(Phase B 单独评估)
- 单对象 data 模式:`CheckpointDeps.getData` 读 bind 快照,restore 时读当前 bind 就地还原(保留 reactive 引用);getter 适配 `sdk.setData` 运行时替换 bind。叶子 bind(原始类型)无法就地还原,集成方应用对象包裹
- 区别于 dataOps per-path 精细快照:checkpoint 整体回滚;API `restoreLastCheckpoint()` / LLM 工具 `restore_last_checkpoint` / UI 回退按钮

## 关键约定与坑

### LangChain 消息字段名
`ToolMessage` 构造参数用 snake_case `tool_call_id`(非 camelCase),否则 DeepSeek/OpenAI 报 `400 missing field tool_call_id`。`call.id` 可能 undefined,需生成兜底 id。

### ChatOpenAI 参数
用 `apiKey`(非 `openAIApiKey`)、`model`(非 `modelName`),`baseUrl` 通过 `configuration.baseURL` 传入。

### 库构建 external
`vite.config.ts`:`vue` 打包进 SDK;`zod` / `@langchain/*` external(peerDep);`marked`/`highlight.js` 打包进。**不引 langchain 整包/LangGraph**。

### 中间件生命周期
before 类正序、after 类逆序、wrap 类洋葱。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`。

### 数据槽工具零桥接
工具函数体 `window` = 宿主页面主 window。改 window 必经 `write`(simple 默认;advanced 模式底层 `set/edit/delete_data`),范围 + schema 校验 + 自动快照 + 自动乐观锁。

### 测试流程

#### 1. 单元/集成自测(必跑,无 LLM 依赖)
```bash
npm test            # tsx 跑 src/core/__tests__/selftest.ts(runner),1358 项断言
```
**按模块拆分**:测试代码在 `src/core/__tests__/modules/sec-NN.ts`(53 个模块),各导出 `run(ctx)` 返回 void,由 `selftest.ts` runner 依次调用并汇总计数。共享 `TestCtx`(assert/invoke/byName)在 `modules/_ctx.ts`。覆盖核心逻辑:dataOps(范围/schema/祖先读/序列化/动态注册 controller)/ vfs / 中间件(todos/skills/memory/permissions/summarization/retry/pool/subagent/mcp extractText/verify beforeReturn+createWriteBackCheck/approval/checkpoint/usageHints/压缩注入快照/preserve 工具结果)/ 存储配额淘汰降级 / selectBuiltinTools / proxyLlm(代理/直连两模式)。**改任何核心模块后必跑**。tsx 跑源码(不经构建),快但触不到 createChatSdk 顶层 API 作用域。新增功能时按「新增功能测试同步约定」在对应模块追加用例或新建模块并在 runner 注册。

#### 2. 集成层 e2e(改 createChatSdk 顶层 API 后必跑)
```bash
npm run build       # 先构建(e2e 用 dist 产物)
npm run test:e2e    # node 跑 tests/e2e-integration.mjs(runner),362 项断言
```
**按模块拆分**:测试代码在 `tests/e2e/<module>.mjs`,各导出 `run()` 返回 `{pass,fail}`,由 `tests/e2e-integration.mjs` runner 汇总。模块:
- `systemprompt.mjs`(默认/自定义/能力概述/拼接)、`dynamic-register.mjs`(add·remove·list + inspect 同步 + dataOps 关闭 no-op)
- `inspect.mjs`(tools/middleware/id/model/subagent/verify/mcp/初始状态 反映配置)、`subagents.mjs`(预声明 + 详细配置)
- `events.mjs`(hook/onEvent/多监听器)、`storage.mjs`(switchSession/后端/对象配置/shareContext 开关)
- `exports.mjs`(39+ 导出 + 工具函数可用 + source=builtin)、`data-slots.mjs`(8 种 schema + 嵌套/空/多/不传)
- `presets.mjs`(三预设)、`boundary.mjs`(checkpoint 空操作/messages 初始/id 不传/mount 边界)、`custom-injection.mjs`(自定义 tools/middleware/skills/memory/配置项/llm)
- 共享 stub/断言在 `tests/e2e/_helpers.mjs`(setupEnv/createAssert/FAKE_LLM/MIN_CAPS/makeStore)

覆盖 selftest 触不到的顶层 `return` 对象作用域(1.3.1 曾因顶层 return 引用 buildCore 内部变量致运行时 `ReferenceError`,由 e2e 捕获)。**改 createChatSdk 返回对象、AgentCore 接口、动态注册 API、默认提示词、新增导出/配置项后必跑**。新增功能时按「新增功能测试同步约定」在对应模块文件追加用例,或新建模块并在 runner 注册。

#### 2.5 浏览器 E2E(改 UI/ChatDialog/dataOps 后必跑)
```bash
npm run test:browser  # Playwright + mock LLM,自动启 dev server,确定性 SSE 响应
```
> Claude Code 里也可用 `/browser-test` 斜杠命令一键跑(见 `.claude/commands/browser-test.md`);写新测试的模板见 `.claude/skills/browser-e2e-testing/SKILL.md`。

**原理**:`tests/browser/_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 OpenAI 兼容 SSE 流(tool_calls + 文本),使 agent ReAct 循环确定性走完,不依赖真 LLM。`playwright.config.ts` 已内置 `PLAYWRIGHT_BROWSERS_PATH`,无需手动设 env。**与手动浏览器验证(下节 3)互补**:手动验体感,自动化验回归。
**按 demo 拆分**:测试代码在 `tests/browser/<demo>.spec.ts`(33 项断言):
- `page-demo.spec.ts`(4 项:read→write→read 标题 / theme 切换 / **offset·limit 数组分页翻页** / **write_todos→update_todo→write 自适应规划端到端**)
- `human-confirm-demo.spec.ts`(2 项:两层确认——主动征询→选方案→写前确认→允许/拒绝)
- `complex-demo.spec.ts`(11 项:read 全量改 navbar title / read 子路径改页面 title / read fields 裁剪 / **mission capture+深嵌套 patch** / read 大 JSON+深路径子树 / **配置面板渲染+publish action** / **配置面板 JSON 同步(deep watch)** / **save_draft→localStorage+get_dom** / **huge ?huge=1 read 分页+800 组件** / **focus 点组件拾取→chip→✕ 退出** / **focus 聚焦后写越界 PATH_DENIED→自纠放行**)
- `nested-demo.spec.ts`(3 项:嵌套子路径 write patch + 确认允许/拒绝 gating / 两轮 write + checkpoint ↩ 回退→数据 + 对话历史回滚)
- `error-recovery.spec.ts`(2 项:write 违反 schema→SCHEMA_INVALID 回灌不写 / 非法→修正→read 确认自纠)
- `rag-demo.spec.ts`(2 项:memory 异步注入→systemPrompt/preview 含文档 / 切知识库→memory 替换)
- `queue.spec.ts`(3 项:生成中 loading 回车入排队区 → 完成后依次执行 + 撤销/修改)
- `session-history-demo.spec.ts`(4 项:新建会话→列表+1+当前切换 / 多会话切换点历史项→active 迁移 / 删除历史→列表-1+当前不可删 / **清空对话→UI 清空 + 无 ReferenceError(P0-4 resetSession)**;验证 listSessions/switchSession/deleteSession/sessionId 对外 API 浏览器端到端,session-history-management)
- `xss-sanitize.spec.ts`(2 项:AI 回复 `<img onerror>` → sanitize 剥 onerror 不执行 / `<a href="javascript:">` → 拦危险协议;验证 P0-2 DOMPurify 真接入 v-html 渲染管线)
- 共享 mock/交互工具在 `tests/browser/_helpers.ts`(mockLlm SSE/fillInput/clickSend/clickByText/waitForAgentIdle/clearChat + clearStorage 清 indexedDB/cookies 防跨 spec 污染)

覆盖 selftest/e2e 触不到的「浏览器 + ChatDialog + 真实 DOM 渲染」层。**改 ChatDialog 组件、dataOps 工具行为、确认/冲突 UI 后必跑**。新增 demo 时按「新增功能测试同步约定」新建 spec 文件。

#### 3. 浏览器手动验证(改 UI/示例后跑)
```bash
npm run dev         # 启动(端口 3000;被占自动换)
```
逐个 demo 验证(`/examples/<demo>/`):
- `page-demo` 自举低代码(3.0:reactive 经 `data` `bind` 字段直连 + schema `.describe()` 自动注入 + write patch 增量)
- `complex-demo` 复杂页面(3.0:10 种组件 discriminated union + 统一 BaseProps + 各自 props;每组件一个 Vue 文件;PageRenderer 按 type 分发;演示大 schema + 多组件拼装)
- `nested-demo` 嵌套树(递归 schema + 人工确认 + checkpoint;nested key `Editor.PageInfo` 用 `data` 细粒度注册,不传 bind)
- `dynamic-demo` 动态注册(懒加载组件 + setData/ + onEvent;动态场景不用静态 bind)
- `subagent-demo` 子 agent 并行编排
- `mcp-demo` MCP 远程工具(需 `npm run mcp:mock`)
- `human-confirm-demo`(3.0:`data` bind + schema)/ `planner-demo`(3.0:`data` bind + schema + 预声明子 agent)/ `toolsets-demo`(手动 toolset,关 dataOps 自动装配,不用 bind)
- `animation-demo` 动画演示(ChatDialog 入场/收起/卸载动画 + inline/drawer 模式 + hide/show 保留历史)
- `multi-agent-demo` 多 Agent 并行(三独立 agent 不同 id 隔离 + 各管各 data + drawer 互斥切换 hide/show,历史各自保留)
- `proxy-demo` 代理连接演示(防 apiKey 泄露:浏览器只持 userToken,代理 server 注入真实 key 转发;含 token 过期自动刷新;需 `npm run proxy:mock`)
- `anthropic-demo` Anthropic Claude(`provider:'anthropic'` 走 Claude 原生协议;展示流式文本逐字 + extended thinking;需 `.env` 配 Anthropic key + `claude-*` model;不用 Anthropic 的项目零影响,optional peer)
- `demo/plain.html` 框架无关 CDN 集成(importmap + esm.sh)

#### 4. 运行时手动验证(依赖 LLM/server)
selftest/e2e 不调真 LLM,以下需配 `.env` API key 或 server 手动验证:
- 子 agent `spawn_agent`/`spawn_agents` 委派(过程隔离 + 进度转发)
- MCP 远程工具注入(`npm run mcp:mock` 起本地 server,`npm run mcp:probe` 验证连通)
- verify 自纠循环(`capabilities.verify:true` + `check` 反馈回灌)
- 真实 LLM 工具调用 + 流式输出 + 停止/重试
- **draft-write-commit 真 LLM 实测**:`npm run test:draft-real`(配 `.env` key;headless 让真 LLM 用 `draft_write` 分块生成 20+ 组件专题页 → `draft_commit` 提交,断言生成组件数 ≥10 + commit 成功;无 key 自动 skip 不阻塞 CI)

#### 5. CDN 可达性验证(发布后)
```bash
curl -sL "https://esm.sh/page-agent-sdk@<version>" | head -20              # 可达 + peer 自动解析
curl -sL "https://esm.sh/page-agent-sdk@<version>/es2022/page-agent-sdk.mjs" -o /tmp/sdk.mjs
rg -o "createChatSdk|setData|systemPromptHelpers|reliableWriteRules" /tmp/sdk.mjs | sort -u  # 导出齐全
```

#### 测试矩阵(改 X → 必跑 Y)
| 改动范围 | npm test | npm run test:e2e | npm run test:browser | 浏览器 demo | 真实 LLM |
|---|---|---|---|---|---|
| 核心模块(dataOps/vfs/中间件/存储) | ✅ | — | 改 dataOps/确认流程时 | 改对应 demo 时 | — |
| createChatSdk 顶层 API / AgentCore / 动态注册 / 默认提示词 | ✅ | ✅ | — | dynamic-demo | — |
| UI 组件(ChatDialog/DebugDrawer) | — | — | ✅ | ✅ | — |
| 子 agent / MCP / verify 自纠 | ✅(逻辑层) | — | — | 对应 demo | ✅ |
| 构建配置(vite/external) | — | ✅(用 dist) | — | plain.html(CDN) | — |

#### 发布前必跑顺序
`npm run build` → `npm test`(1358 全过) → `npm run test:e2e`(362 全过) → `npm run test:browser`(浏览器 E2E 全过) → `npm run test:exports`(types 与 src 导出对齐) → `npm run test:types`(tsconfig.test.json 只查对外 types/index.d.ts 类型对齐 + tests/types.test-d.ts;src 全量类型卫生用 `npx tsc -p tsconfig.json` 单独诊断,**非发布门禁** —— 勿把全量 tsc 报错当门禁阻塞;但 **src 真错门禁**:`npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'error TS' | grep -v __tests__ | grep -v examples/` 须为空,test/examples 的 unused-import 噪声豁免) → `npm run test:size`(dist 体积不超阈值) → `npm pack --dry-run`(核对 files 不含 `.env`/`src`/`examples`/笔记) → 版本号递增 → `npm publish` → CDN 可达性验证(上节 5)

#### 新增功能测试同步约定(强制)

**每新增一个功能/配置项/导出 API,必须同步补对应测试用例**,与功能代码同 commit。无测试的改动不予合并/发布。

**判定该补 selftest 还是 e2e(可都补)**

| 新增类型 | 补 selftest(`src/__tests__/selftest.ts`) | 补 e2e(`tests/e2e-integration.mjs`) |
|---|---|---|
| 底层纯函数/工具逻辑(dataOps/vfs/中间件/存储/retry/pool/压缩) | ✅ 必补 | — |
| `createChatSdk` 顶层返回对象方法 / `AgentCore` 接口 / 动态注册 API | — | ✅ 必补 |
| 新 `capabilities` 开关 / 新配置项 | — | ✅ 必补(`inspect()` 反映) |
| 新导出(`defineTool`/`presets`/`systemPromptHelpers`/中间件工厂等) | — | ✅ 必补(导出可用 + 基本行为) |
| 新中间件 | ✅(逻辑层:hooks 触发/state 变更) | ✅(`inspect().middleware` 含) |
| 新工具 | ✅(参数校验/返回/范围) | ✅(`inspect().tools` 含 + source) |
| UI 组件 / demo | — | 浏览器手动(上节 3) |
| 依赖 LLM/server 的运行时行为(spawn/MCP/verify 自纠) | ✅ 逻辑层可测部分 | 手动(上节 4) |

**命名约定**:测试用例描述以 `✓` 开头,写明「功能名 → 预期行为」,便于失败时定位。selftest 用中文描述,e2e 同。

**最低要求**:每个新功能至少 1 条断言,覆盖「能正常工作」+「边界/错误场景」(如非法入参被拒、关闭开关后 no-op、未开启时抛错等)至少 1 条。

**计数同步**:补测试后同步更新本文件「测试流程」小节的断言计数(1358/362)与 README 中英文计数,以及下方测试矩阵的「改动范围」行(若引入新模块)。

**自检命令**:提交前跑 `npm test && npm run build && npm run test:e2e`,三者全绿方可提交。

## SDK 用法
```ts
import { createChatSdk, defineTool, defineSkill, type Middleware } from 'page-agent-sdk'
createChatSdk({
  container: '#root', llm: { apiKey, baseUrl, model },
  systemPrompt: '...', data: { schema, bind, description? },
  augmentSystem: ({ state, data }) => '## 当前组件\n...', // 动态注入业务补充段(每轮调,setData 后 data 同步)
  tools: [...], skills: [...], memory: '...',
  maxRetries: 2, maxParallelTools: 1,
  contextPreset: 'auto',
  subagent: { allowedTools: [...] },
  subagents: [{ id, description, systemPrompt?, tools? }], // 预声明子 agent(生成 use_<id> 委派工具)
  capabilities: { verify: true }, verify: { maxAttempts: 2 },
  approval: { tools: ['write'] },
  checkpoint: true,
  middleware: [...],
}).mount()
// 运行时动态重配置(零破坏,不调用 = 现状):
// sdk.setTools/addTool/removeTool 增删用户工具(内置不动,rebind)
// sdk.setLlm(llm) 切换 LLM(配额耗尽/切强模型/切 provider)
// sdk.setMemory(source) 更新持久指令(支持 string / 同步/异步函数,适合 RAG 加载文档)
// sdk.setSubagents/addSubagent/removeSubagent 增删预声明子 agent(需创建时配 subagents:[])
```
**headless**(`ui: false`):不渲染内置对话框,用 `agent.messages` + `send`/`stream` 自建 UI。

**能力开关**(`capabilities`):关掉无用内置能力(`dataOps`/`fetch`/`planning`/`skills`/`vfs`/`summarization`/`memory`/`subagent`,默认全开)省 token/体积。`verify` 反向(默认关,需 `capabilities.verify:true`)。`domInspect` 同向默认关(agent 读渲染后 DOM 的 `get_dom` 工具,opt-in;有 token 成本)。`inspectEnv` **默认开**(`inspect_env` 轻量环境探查,读 window/location/调试变量,排查调试用;`false` 关)。`automation` **opt-in 默认关**(无人值守自动化:`tokenBudget`/`timeBudgetMs` 资源预算闸 + `maxAutoRetries` 错误自动恢复 + 断点续跑 + `sdk.batch` 批处理;最远,需 `capabilities.automation:true`)。**宿主动作 `actions`**(非 capabilities 开关,类 `tools`):集成方注册页面操作 `{ name: { description, run, params? } }`,SDK 自动包成命名 tool(save_draft/publish 等),agent 直接调用触发宿主保存/发布,配合 get_dom 形成"改数据→看 DOM→触发动作"闭环。**`focus` 默认开**(上下文聚焦·指定组件精修:`sdk.setFocus`/`getFocus`/`clearFocus` + agent 工具 `set_focus`/`clear_focus`(advanced 暴露)+ ChatDialog 焦点条;聚焦后目标/视野/范围三层收敛到单组件子树,写越界 `PATH_DENIED` 回灌自纠;`false` 关)。**`contextInspector` 默认开**(上下文构成诊断:`sdk.inspectContext()`/`inspect().context` 读每轮 wrapModelCall 的消息分类 token 占比,DebugDrawer「📊 上下文」tab 展示占用/分类/压缩;纯 estimateTokens 计算零 LLM 成本;`false` 关)。**`skillHostScript` opt-in 默认关**(skill `exec.context:'host'` 宿主全权执行,需 `capabilities.skillHostScript:true`;host 仅集成方内联 code,远程 `url`+`host` 禁止)。skill `exec`(sandbox 默认)/`tools` 是 `SkillSpec` 新增可选字段,无需 capability 开关(默认可用);沙箱防护见 `src/core/tools/sandbox.ts`。

**预设**(`presets`):`pageBuilder` / `researcher` / `minimal`,spread 进 `createChatSdk`。

**UI 模块可复用**:`ChatDialog` / `MessageContent` / `CodePreview` + `useChat` 均从入口导出。`inspect()` 的 `AgentInfo` 含 `mcp.servers`、每个工具 `source`、`contextPreset`(2.16+ 当前生效的预设名)。框架无关集成见 `demo/plain.html`。

## 编码规范
- `<script setup lang="ts">`,Composition API;注释用中文,只解释非显而易见处
- 新增 composable/组件/工具在 `src/index.ts` 导出并同步 `types/index.d.ts`
- 改构建依赖同步 `vite.config.ts` 的 external/globals
- `.env` 的 `VITE_AI_SYSTEM_PROMPT` 写单行
- **新增功能必须同步补对应测试用例**(见「测试流程 → 新增功能测试同步约定」),无测试的 PR 不予合并/发布

## 项目 Skills(分发给使用者 + 维护者自用)

本仓库提供多个 Agent Skill,供 Claude Code / Cursor 等 AI 工具加载使用。**注意公开范围不同**:

| Skill | 位置 | 公开范围 | 触发场景 |
|---|---|---|---|
| `page-agent-sdk-integrate` | `skills/`(含入 npm 包 `files`) | ✅ **公开分发**(使用者 `npm i` 即可得) | 集成 SDK 进网页(选引入方式/声明 data+schema/配 llm/挂载/订阅事件/headless/排坑);含 `references/integration-prompt.md` 通用对接提示词模板(不装 skill 时复制给对接项目 AI) |
| `page-agent-sdk-release` | `.claude/skills/`(不进 npm 包) | 🔒 **维护者自用**(仅仓库内) | 发布新版本(bump→build→test→推 gitee/github→npm publish→验证) |
| `browser-e2e-testing` | `.claude/skills/`(不进 npm 包) | 🔒 **维护者自用**(仅仓库内) | 跑 Playwright 浏览器 E2E 测试(mock LLM,确定性);改 dataOps/ChatDialog/确认流程后主动使用 |
| `openspec-*`(4 个) | `.claude/skills/`(不进 npm 包) | 🔒 **维护者自用**(仅仓库内) | OpenSpec 变更流程(propose/explore/apply/archive) |

- **integrate** 面向集成方:使用者 `cp -R node_modules/page-agent-sdk/skills/page-agent-sdk-integrate ~/.claude/skills/` 或从 github 下载安装
- **release** 面向维护者:含双远程职责/npm 2FA 凭据等内部信息,**不通过 npm 包分发**;留在仓库 `.claude/skills/` 供本项目 agent 工作时自用
- **browser-e2e-testing** 面向维护者:文档化 `tests/browser/*.spec.ts` 的运行方式、mock LLM 原理、写新测试的模板;配套 `/browser-test` 命令一键跑
- 二者均引用 `CLAUDE.md` / `doc/usage-guide*` / `examples/` / `demo/plain.html`,不重复正文,仅给操作流程
- ⚠️ 区分:本仓库 `.claude/skills/openspec-*` = 开发本项目自用;`.claude/skills/page-agent-sdk-release` = 维护者发布自用;`.claude/skills/browser-e2e-testing` = 维护者测试自用;`skills/page-agent-sdk-integrate` = 分发给使用者

### 项目 Commands(Claude Code 斜杠命令)

| 命令 | 位置 | 用途 |
|---|---|---|
| `/browser-e2e` | `.claude/commands/browser-e2e.md` | 交互式浏览器探索(真 LLM,委派 browser-tester subagent,Playwright MCP 驱动);探索新功能/复现 bug 用 |
| `/browser-test` | `.claude/commands/browser-test.md` | 自动化浏览器回归(mock LLM,跑 `tests/browser/*.spec.ts`);CI/发布前门禁用 |
| `/opsx:*` | `.claude/commands/opsx/` | OpenSpec 变更流程命令 |

## 发布与引入

包名 `page-agent-sdk`(`package.json` 已配 `exports`/`files`/`peerDependencies`/`unpkg`/`jsdelivr`)。`vue` 打包进库;`zod`/`@langchain/*` 为 peer。三种引入:npm / CDN·ESM(esm.sh) / CDN·IIFE 全量(`unpkg` 单文件)。

构建:`npm run build` = `build:lib`(ESM+UMD,peer 外置)+ `build:iife`(IIFE 全量)。发布前确保 `npm run build` + `npm test` 通过,`types/index.d.ts` 与 `src/core/index.ts` 导出一致。

## 发布流程 checklist(改代码 → 文档 → git → npm)

每次发布按此顺序,缺一不可:

> ⚠️ **发布触发约定**:不要在修 bug / 加功能后自动发布。每次 `git commit` 后**停下来询问用户「是否发布」**,由用户决定是否 bump + push + publish。仅在用户明确说「发布」/「publish」/「推上去」等时才执行本 checklist。

1. **切到 develop 开发 + 改代码**:新功能/修 bug 一律在 `develop` 分支开发(当前在 master 先 `git checkout develop`;日常可 `git push origin develop` 保留细粒度 commit)。改实现 `src/` → 同步 `types/index.d.ts`(手动维护)→ `src/core/index.ts` 导出
2. **更新中英文文档**(同步,勿漏单边):
   - `README.md`(英)/ `README.zh-CN.md`(中):特性、用法、场景、本地 npm 测试
   - `doc/README.md`(中)/ `doc/README.en.md`(英):文档索引
   - `doc/usage-guide.md`(中)/ `doc/usage-guide.en.md`(英):用法指南(含 onEvent/hook/服务端等)
   - `CLAUDE.md`:开发约定/架构要点(本项目内部指引,不外发)
   - 中英文**必须同步**,新增能力两侧都补;语言切换链接保持双向
3. **bump 版本**:`npm version patch|minor|major --no-git-tag-version`(semver;新增 API 用 minor,破坏性用 major,修复用 patch)
4. **构建+自测**:按「### 测试流程」末尾「发布前必跑顺序」执行(`npm run build` → `npm test` 1358 全过 → `npm run test:e2e` 362 全过 → `npm run test:exports` 导出对齐 → `npm run test:types` 类型正确 → `npm run test:size` 体积不超阈值 → `npm pack --dry-run` 核对不含 `.env`/`src`/`examples`/笔记)
5. **提交**:`git add -A && git commit -m "feat/fix/docs: ..."`
6. **发布(总结到 master + 推双远程)**:`git checkout master` → `./scripts/publish-github.sh "release x.x.x: 一句话总结"` —— 自动在 master 上 `merge --squash develop` 总结成一个发布 commit,再 fast-forward 推 Gitee + GitHub(两边 master 历史一致,零冲突;个人笔记 `doc/待确认问题.md` 不进)。完成后切回 develop 继续开发
7. **发 npm**:`npm publish`(`publishConfig.registry` 已锁官方 npm,不受本机默认私有源影响)
8. **验证**:`npm view page-agent-sdk version` 确认最新版 + 临时目录 `npm i page-agent-sdk` 验证可装可导入 + CDN 可达性验证(「### 测试流程」§5:esm.sh 拉取 + 导出齐全)

> 双远程职责分工、npm 凭据/2FA 细节见下两节。

## 双远程仓库与发布约定(重要)

本地有两个远程,**职责不同,切勿混推**:

| remote | URL | 定位 |
|---|---|---|
| `origin` | gitee.com/whyymj/**chat-agent**.git | 📦 日常存储(develop 细粒度 commit + master 发布 commit) |
| `github` | github.com/whyymj/**page-agent-sdk**.git | ✅ 正式开源(只收 master,即整理过的发布提交) |

**分支工作流(develop → master)**:
- **日常开发在 `develop`**:新功能/修 bug 一律先 commit 到 develop(细粒度自由提交),`git push origin develop`(gitee 保留全部细粒度)。**master 只在发布时动,不直接开发**。
- **发布时总结到 `master`**:`./scripts/publish-github.sh "release x.x.x: 总结"`(在 master 上 `merge --squash develop` 总结成一个发布 commit → push origin master → push github master)。master 永远只含发布总结 commit,github 公开历史保持干净。
- **个人笔记** `doc/待确认问题.md` 已在 `.gitignore`(未跟踪),仅存 Gitee,不进 GitHub。
- 历史:曾直接在 master 细粒度开发 + public/read-tree 整理推 github,每次发布必冲突;2026-08-03 改 develop 工作流(见 git 历史)。

## npm 发布约定(包名 `page-agent-sdk`)

- **账号**:`whyymj`(已开 2FA,**禁止在文档/仓库/聊天记录中留存密码或 token 明文**)。凭据只存本机 user 级 `~/.npmrc`,不进项目目录、不进 git。
- **registry 陷阱**:本机默认 registry 是公司私有源;`package.json` 的 `publishConfig.registry` 已锁定官方 npm,`npm publish` 不受影响;但 `npm login`/`whoami` 需显式 `--registry=https://registry.npmjs.org/`。
- **2FA**:用 **Automation Access Token**(npmjs.com → Access Tokens → Classic → Automation,绕过 OTP),写入 `~/.npmrc`:`npm config set //registry.npmjs.org/:_authToken <token> --location=user`。用完即吊销。
- **发布前检查**:①`npm run build` ②`npm test` ③`npm run test:e2e`(改 createChatSdk 顶层 API 后必跑)④版本号 semver 递增(`npm version patch|minor|major`,不得重复发布)⑤`npm pack --dry-run` 核对不含 `.env`/`src`/`examples`/笔记 ⑥`npm publish`。
- **发布后测试**:`npm view page-agent-sdk version` + 临时目录 `npm i page-agent-sdk` 验证可装。
