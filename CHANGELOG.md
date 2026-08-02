# Changelog

本变更日志基于 git commit 历史整理,遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 风格,版本号对应 npm 发布版本。

## [Unreleased]

### Added
- **自适应规划(add-adaptive-planning)**:① todos 增量更新 —— 新增 `update_todo({ id, content?, status? })` 工具(按 id 改单项,不必重传整个清单);`Todo` 增稳定 `id`(`write_todos` 时框架按 index 生成 `t-1/t-2...`,LLM 也可显式传;hydrate 旧数据按 index 补,向后兼容);`augmentPrompt` 渲染带 id 供 LLM 引用。② 规划阶段防死循环 —— 新增 `maxPlanRevisions` 配置(默认 5,**规划阶段总轮次**预算,与 `maxIterations` 总闸正交):首次 `write_todos` 进入 planning → 每轮 `beforeModel` 计数(含 read/query/search 调研轮)→ 主数据写工具(write/set_data/edit_data/delete_data)成功退出 → 超限回灌「停止调研/修订,基于当前清单执行」(不强制终止,总闸兜底);支持重入(退出后再 write_todos 重新进入,单阶段计数重置)。③ 自适应 prompt 引导 —— `usageHints` planning 段升级(简单直接做/复杂先规划/update_todo 增量/方案确认 + 轮次预算提示)+ humanConfirm 补「规划方案确认」第 4 类。④ 内置 skill `adaptive-planning`(判断复杂度→规划→可选用户确认→执行→动态增量修订,入 npm 包 `skills/` 分发)。⑤ `inspect().planPhase` 反映 `{ inPlanning, rounds, limit }`;`createChatSdk({ maxPlanRevisions })`。选型见 `openspec/changes/2026-08-01-add-adaptive-planning/decision-record.md`(A 框架深度 / B 计数语义各三方案 + 升级路径 + 暂缓提案关系)。**范围:轻量版**(框架只加 update_todo + maxPlanRevisions;复杂度判断/方案确认/标准流程在 prompt 层)。能力边界见 `doc/capability-boundaries.md`
- **任务目标锚定 mission(revive-mission-anchor Phase 1)**:会话级 Mission 状态(`{ goal, acceptanceCriteria?, sourceMessageIdx, capturedAt, explicit }`)。① capture:首条「任务型」user 启发式(非空/非问候/含任务动词,不调 LLM)+ `send({mission})`/`setMission` 显式覆盖;② augmentPrompt 每轮注入「## 当前主线目标」pin 段(**天然跨压缩保留** —— mission 在 state 不在 messages,compressInput 不碰);③ SDK API:`getMission()` / `setMission({goal?,criteria?})`(合并;`{}` 清空)/ `send(text,{mission?})` / `inspect().mission`;④ `capabilities.missionAnchor`(分层默认核心,**默认开**;`false` 关)。长任务防跑偏 + 压缩丢主线。定位升级重启(complex-agent-roadmap Phase 1,见 `doc/complex-agent-roadmap.md`)
- **跨压缩工作记忆 workingMemory(revive-cross-round-working-memory Phase 1)**:① 自动捕获(`wrapToolCall` after,**不调 LLM**):`read`/`query_data`/`search_data` 结果 → `locatedPaths`(LRU ≤10 去重);`read` 结果的 `hash=` → `lastHashes[path]`(LRU ≤10);其他工具不捕获;② pin 段天然跨压缩:`augmentPrompt` 每轮注入「## 工作记忆(跨压缩保留)」(workingMemory 在 state → `compressInput` 不碰;**无需改 summarization**,同 mission 机制);③ `capabilities.workingMemory`(分层默认核心,**默认开**;`false` 关);④ `inspect().workingMemory` 反映 pin(locatedPaths/lastHashes)。解锁:几百 K 频繁压缩 → read/query 定位的 path + read 的 hash 随 older 轮次丢 → LLM 重复检索(浪费 token)+ 凭记忆写致 `autoLock` 误冲突。与 `preserveLastToolResults` 互补(preserve 保工具结果摘要防字段描述丢,workingMemory 保 path/hash 结构化防定位丢);与 mission 正交。定位升级重启(complex-agent-roadmap Phase 1)
- **大 schema 分层披露(add-schema-tiered-disclosure Phase 1)**:`extractSchemaHint(schema, opts?)` 阈值触发(默认 maxKeys=15/maxChars=4000,集成方经 `schemaHint` 配置可调)→ 大 schema 自动转「顶层概览」(`renderSchemaShallow`:key+type+一句描述,**不带**约束/不递归 shape)+ 尾部提示(深层约束查 `schema_data`);小 schema(≤阈值)仍全量(现状不变,无感)。新增导出 `renderSchemaShallow`/`SchemaHintOptions`。直击:50+ 组件深嵌套 schema 全量注入 systemPrompt 撑爆上下文 + LLM 认知负担(本轮只改 1 个组件却看到全部约束)。在 expose-schema(2.17)之上加分层;`schema_data` 工具已有(advanced)。定位升级重启(complex-agent-roadmap Phase 1)

### Changed
- planning 中间件工具(write_todos / update_todo)`source` 标 `'builtin'`(此前落 `'user'`,语义错;与 vfs/checkpoint/humanConfirm 一致)

### Tests
- selftest 新增 `sec-34`(update_todo 增量 / id 生成 / TODO_NOT_FOUND / maxPlanRevisions 阶段计数 / 超限回灌 / 写工具退出 / 重入 / hydrate 补 id / 同轮冲突拒)。断言计数 782→800
- e2e `inspect.mjs` + `systemprompt.mjs` 补(update_todo + source=builtin + planPhase + maxPlanRevisions 配置反映 + 自适应规划引导)。断言计数 228→238
- browser `page-demo.spec.ts` 加「write_todos→update_todo→write 自适应规划端到端」。断言计数 15→16
- selftest 新增 `sec-35`(mission capture 启发式 / 保守(问候/超短/超长/无动词)/ setMission 显式覆盖·合并·清空 / getMission / augmentPrompt pin 段)。断言计数 800→817
- e2e `inspect.mjs` 补 mission(getMission/setMission/inspect().mission/capabilities.missionAnchor:false → getMission undefined + setMission warn 不抛)。断言计数 238→247

## [2.17.0] - 2026-08-01

### Added
- **字段约束可见性(expose-schema-constraints)**:新增 `describeSchemaNode(schema)` 纯函数结构化提取 zod 字段约束(类型/min/max/enum/必填/默认/嵌套 shape,针对 zod 4 `_def`/`_zod.def`),三处消费:① `extractSchemaHint` 升级 → systemPrompt「可操作数据」段带 `key (Type)[约束]: desc`;② 新增 `schema_data({ jsonPath? })` 工具(advanced)查任意路径完整约束。LLM 写前即知规则,减少"写错→校验失败→重试"轮次。`describeSchemaNode` 是 zod 4.4+ adapter(结构探测失败返 type-only 兜底 + dev warn)。新增导出 `describeSchemaNode`/`renderSchemaHint`/`renderSchemaOverview`/`formatConstraints` + 类型 `SchemaNodeDesc`
- **默认工具集演进(evolve-default-toolset)**:① 精简 —— `snapshot_data`/`list_data_snapshots` 从 simple 移到 advanced(被自动快照 + restore_data + history_data 覆盖),simple 8→7 工具;② 补缺 —— 新增 `history_data({ id?, jsonPath? })`(simple,只读查看快照,填 list 元信息 / restore 破坏性之间的空档);③ 增强 —— `read` 增 `jsonPaths`(多路径一次读,非法路径单项标错不整批失败)+ `offset`/`limit`(数组分页,返回切片 + total/hasMore),`write` 增 `dryRun`(四意图预检:走完整校验链但不落盘/入快照,乐观锁冲突照常检测不挂起),`eval_script` 增 `jsonPath`(子树模式,降低大 JSON 深拷贝/执行成本;transform 返回值作为子树新值);④ 新增 `diff_data({ snapshotId?, against? })`(advanced,差异对比,纯函数 `diffObjects` 顶层导出)
- **三档错误模型(unify-error-model)**:显式化已有的隐式三档 —— `AgentError.severity`(recoverable 回灌 LLM 自纠 / fatal emit+中断 / observable 记录不中断)+ `routeError`/`asAgentError` 纯函数(普通 Error 默认 fatal,保守暴露问题)。内置 catch 点用简化硬编码路由(coreExecTool recoverable / afterAgent observable / emit observable / invoke fatal)经 `asAgentError` 归一化;`routeError` 作为公共工具导出(供集成方自定义 catch + 为未来 `wrapToolCall` 自动路由预留扩展口,框架内置 catch 当前未消费)。`onEvent('error')` payload 扩展 `{ severity?, code?, context? }`(向后兼容,旧监听器读 message 不破)。新增导出 `ErrorSeverity`/`AgentError`/`ErrorRouting`/`routeError`/`asAgentError`/`agentError`

### Fixed
- **`inspect().systemPrompt` 残缺(漏中间件段)**:`getInfo` 另起炉灶拼 systemPrompt(只 `base + data + augmentSystem`),漏掉 `usageHints` / `todos` / `skills` / `memory` / `subagents` 等中间件 `augmentPrompt` 段,集成方 / DebugDrawer 看到的"系统提示词"残缺,排查 prompt 问题(如"LLM 为何不知道有这些 skill / 工具用法")时被误导。修复:`createAgent` 暴露 `getEffectiveSystemPrompt()`(复用内部权威 `buildSystemPrompt`,即实际发给 LLM 的内容),`getInfo.systemPrompt` 代理到它 —— prompt 拼装收敛为单一真相源。展示一致性修复,**LLM 实际收到的 prompt 本就对**(向后完全兼容)。

### Changed
- **模型能力表匹配 first-match → longest-match**:`resolveModelCaps` 对 `MODEL_TABLE` 的匹配从 first-match 改为按"实际匹配子串长度"(`RegExp.exec(model)[0].length`)降序取最具体条目,消除顺序依赖(未来新模型名是旧模型子串时不再被宽泛条目抢先匹配,拿到错的 `contextWindow`/`maxOutputTokens` 连锁影响 offload 阈值/压缩触发/maxTokens 缺省)。不用 `pattern.source.length` —— `|` 分支会虚高 source 长度(实测 `glm-4.5` 被 `glm-4|glm4` 误压)。**行为不变**(当前顺序下 longest=first 结果一致,向后兼容)
- **乐观锁 hashValue 升级 cyrb53(53-bit)**:`hashValue`(整体 bind 值的 hash,乐观锁用)从 djb2(32-bit,~65536 对象 50% 碰撞)升级为 cyrb53(53-bit,碰撞空间 2^53,生日碰撞阈值升至 ~9500 万对象),大幅降"误判无冲突 → 静默覆盖外部修改"概率。同时明确并发语义:`autoLock` 在 `maxParallelTools>1` 下退化为"整体快照语义"(最后完成的 read 的整体 hash),并发场景建议 LLM 显式传 `expectedHash` 精确控制。hash 不持久化/不跨会话,**无兼容性问题**(语义不变,LLM 只比对相等)
- **ReAct 循环预算语义加固(工具轮 vs 总迭代)**:`rounds` 回归"只计工具轮"(有 tool_calls 执行才 +1);格式自纠 / verify 自纠不再消耗 `rounds`(它们有独立预算 `formatRetries`/`verifyAttempts`)。新增 `iterations` 总循环计数 + `maxIterations` 硬上限(默认 `max(maxToolRounds*3, 30)`,经纯函数 `computeMaxIterations` 推导,防自纠死循环的总闸)。同等 `maxToolRounds` 下 agent 可用工具轮更多(自纠不再挤占工具预算,更符合直觉)。循环耗尽兜底文案改为进展引导(不再让用户"简化问题");`round_start` 事件的 round 字段改用迭代号(`iterations`,自纠轮新号,避免 UI 按工具轮号显示时同号卡顿)。**向后兼容**(语义修正)
- **双摘要合并协议统一(unify-context-compression)**:抽 `SummarySegment` 协议 + `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 纯函数;`trimMemoryMessagesImpl`(`rounds.ts`)与 `useContextManager.compress` 的"提取头部旧摘要"改调共享 `parseSummarySegment`(消除两处逐字重复的提取补丁)。**内部重构,行为不变**(统一"提取";"合并"格式保留各自 —— summarization 新在前 / trim 旧在前,不强行统一)
- **中间件声明式 priority 排序(declarative-middleware-ordering 期一)**:`createChatSdk` 中间件装载序从"数组字面量位置硬编码"改为声明式 `MIDDLEWARE_PRIORITY` 常量 + `composeMiddlewareStack` 纯函数稳定排序 + selftest 断言锁死已知约束(dataHint 最前 / sdk-events 最末 / verify 在用户前 / humanConfirm 在 approval 前);修了初版 `sdk-events=9999` bug(用户中间件 Infinity 会排到其后,破坏"最后观察"语义)。**行为不变**(排序结果与原硬编码一致)。期二(`createReconfigurable` setter 收敛)**DEFERRED** —— 纯内部重构量大收益低,推迟
- **精修:能力可达性 + 去冗余 + 半成品诚实化(refine-dataops-reachability / fix-unify-error-half-done)**:① `read` 概览去约束(与 systemPrompt 去重复,约束靠 systemPrompt + `schema_data`);② `usageHints` 补分页/多路径/dryRun 用法提示(让 evolve 加的能力 LLM 可达);③ `describeSchemaNode` zod 版本防御(adapter 集中声明 + dev 模式 console.warn 去重);④ unify-error 缩水诚实化(`routeError` 降级为导出工具 + 扩展口注释,middleware 删空头契约承诺,零行为变化,为未来 `wrapToolCall` 补全留低改动面)
- **真 LLM 审计收口(followup-from-live-llm-audit)**:4 agent 真 LLM 全覆盖审计(6 demo × 多场景)后 —— ① 修 `isPathAllowed`/`getSchemaAtPath` discriminatedUnion **pre-existing bug**(误当 ZodArray 致 `components.N.props.X` 深层路径误 PATH_DENIED;ZodArray 严格判 + union 降级开放交 safeParse 兜底;complex-demo 嵌套 schema 下 evolve patches 增量改单字段恢复可用);② browser 全跑 flaky 修(`_helpers` clearChat 含 `clearStorage` 清 indexedDB/cookies 防跨 spec 污染 + waitForAgentIdle timeout 30→60s);③ `usageHints` 补 `history_data`(simple)/`diff_data`(advanced)提示(真测:LLM 绕过 diff);④ `planner-demo` systemPrompt 加"收到方案必须 write 落地"(真测:主 agent 停在委派完)

### Tests
- e2e `systemprompt.mjs` 补 `inspect().systemPrompt` 完整性断言(配 skills/memory/dataOps 后含 usageHints `## 能力使用提示` / skills `## 可用 Skills` 段,修复前漏)。断言计数 217→221
- selftest `sec-20` 补 longest-match 表驱动断言(glm-4.6 命中 `glm-4.[6-9]` / qwen2.5-1m 命中 1m 条目 / 未知模型走 DEFAULT_CAPS)。断言计数 680→683
- selftest `sec-30` 补 cyrb53/hashValue 白盒断言(确定性 + 雪崩 + 碰撞抽样)。断言计数 683→688
- selftest `sec-21` 补 `computeMaxIterations` 白盒断言(默认 / 小 / 大 maxToolRounds / 显式覆盖)。断言计数 688→692
- selftest `sec-21` 补 `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 白盒断言。断言计数 692→696
- selftest `sec-21` 补 `composeMiddlewareStack` 排序白盒断言(含 sdk-events 最末,锁死 9999 bug 不回归)。断言计数 696→699
- selftest `sec-19`/`sec-21`/`sec-24`/`sec-31` 补 expose-schema(`describeSchemaNode`/`extractSchemaHint`/`schema_data`)+ evolve(`history_data`/`read` 多路径+分页/`write` dryRun/`eval` 子树/`diffObjects`+`diff_data`)+ unify-error(`routeError`/`asAgentError`)断言;工具数 13→16。断言计数 699→768
- e2e `systemprompt.mjs` 补「可操作数据」段字段约束标注;`inspect.mjs` 补 simple 7 工具集 + advanced 16(含 `schema_data`/`history_data`/`diff_data`)计数 221→228
- selftest `sec-19`/`sec-31` 补 usageHints 分页提示 + read 概览去约束 + zod 兜底断言(refine);routeError 断言补扩展口注释(fix)。断言计数 768→772
- **browser E2E 修复**:`playwright.config.ts` webServer.env 注入假 `VITE_AI_API_KEY`/`VITE_AI_MODEL`,让 browser test 自包含(不依赖 .env;ChatOpenAI 构造需 apiKey 非空才发请求被 mock 拦截)。7/7 全过
- selftest `sec-31` 补 `isPathAllowed`/`getSchemaAtPath` discriminatedUnion 深层路径回归(8 断言)+ tags.0.name 严格 false(旧 bug 放行)。断言计数 780→782
- browser 新增 `nested-demo.spec.ts`(嵌套子路径写 + 确认 gating + checkpoint 回滚)+ `error-recovery.spec.ts`(SCHEMA_INVALID 回灌自纠)+ `rag-demo.spec.ts`(memory 异步注入 + 切库替换)+ page-demo offset·limit 翻页用例;`_helpers` clearStorage 入 clearChat。browser 7→15(连跑 2 次稳)

## [2.16.0] - 2026-07-31

### Added
- **complex 上下文预设**:新增 `contextPreset: 'complex'`(与 auto/conservative/aggressive 并列),面向多步复杂任务 / 大 JSON 操作 / 长流程编排 —— 最大保留窗口(`windowRatio=0.6`)+ 最晚触发压缩(`summaryThresholdRatio=0.7`)+ 最多召回(`recallTopK=5`)+ LLM 摘要;`preserveLastToolResults` 默认扩为 `['describe_data','read','query_data','search_data']`(跨轮保留更多工具结果)。预设机制为比例制(complex 按比例字段配置)
- **vfs JSON 感知工具**:新增 `vfs_json_read({ path, jsonPath? })`(vfs 文件内按 jsonPath 读 JSON 子树,文件非合法 JSON 返 `VFS_JSON_INVALID`)与 `vfs_json_patch({ path, patches })`(vfs 文件内原子 jsonPath patch:set/remove/merge/append 在 clone 上应用,任一失败整体不写回,原文件不污染);`vfs_write` 增 `jsonString?` 参数(true 时校验 content 合法 JSON,非法 `VFS_JSON_INVALID`)。适合在 vfs 内结构化读写大 JSON
- **vfs 三池分池**:vfs 内部按 path 前缀分三池独立 LRU —— `large_results/*`(offload 自动,4MB)/ `drafts/*`(draft_write 自动,2MB,前序 change 未实现,池空占位)/ userFiles(vfs_write 显式,2MB)。三池互不挤占(防 offload 大结果挤掉进行中草稿);`vfs.maxBytes` 默认 8MB(三池之和),`vfs.poolBytes` 可单独配置每池。读写跨池透明(API 不变)
- **offload 结构化元数据**:`offloadLargeResult` 返回 `OffloadResult`(`{ offloaded, content, path?, totalChars?, preview?, suggestedReadPlan? }`);大结果(>10000 字符)附 `suggestedReadPlan` 引导 LLM 分页 `vfs_read` 回读而非盲读
- **inspect().contextPreset**:`AgentInfo` 新增 `contextPreset` 字段,inspect 反映当前预设档位

### Changed
- vfs 工具族(`vfs_read`/`vfs_write`/`vfs_edit`/`vfs_ls`/`vfs_glob`/`vfs_grep`/`vfs_json_read`/`vfs_json_patch`)source 标记由 `'user'` 修正为 `'builtin'`(vfs 是内置中间件,此前经 middleware.tools 注入,inspect().tools 里误标 'user')

### Tests
- selftest 新增 `sec-33`(vfs JSON 工具 + 三池分池独立 LRU + offload 结构化元数据);`sec-21` 补 complex 预设 + `PRESET_PRESERVE`;`sec-02` offload 断言适配 `OffloadResult`。断言计数 642→680
- e2e inspect().tools 含 vfs_json_read/vfs_json_patch(source=builtin)+ inspect().contextPreset(auto/complex)。计数 212→217

## [2.15.1] - 2026-07-31

### Fixed
- **数组子项删除产生稀疏数组**:`delete_data` / `write(del)` / `edit(remove)` / `eval(patches remove)` 删数组元素(如 `components.0`)时,底层 `deleteByPath` 对数组元素用 `delete arr[i]`,留下 empty 槽(length 不减、元素不前移、`JSON.stringify` 渲染成 null,污染序列化 / `hashValue` / 持久化与 Vue reactive 渲染,LLM 删后 read 见 length 不符)。修复:父为数组且末段为数字索引时改用 `splice` 移除,一处改四入口自动修正;对象属性删除仍走 `delete`(语义不变)。schema `.min(n)` 约束此前因 length 不减形同虚设,修复后能正确拦截删过头
- **白名单绕过(set_data / write(set) 未声明字段写回)**:schema 为 `ZodObject` 子集时顶层声明 key 是读写白名单(2.4+ 安全卖点),但 `set_data` / `write(set)` 在 `safeMerge`(只写声明字段)后,额外把 LLM 原始 `parsed` 里未声明字段直接赋值回 bind(无 schema 校验、无 `UNSAFE_KEYS` 过滤)—— LLM 在 value 里塞任意未声明字段就能写进 bind。修复:删除两处逐字相同的"未声明字段写回"块,bind 严格只接受 schema 声明字段;`interceptors.write` 转换/审计/拒绝已声明字段值的能力不变,但不再能绕白名单塞字段(可写字段请在 schema 声明)。安全默认收紧,属补漏校验(非破坏)

### Tests
- selftest:`sec-30.ts` 补 `deleteByPath` 数组 splice 白盒(length 递减 / 元素前移 / 无 empty 槽 + applyPatchToClone/Live remove 数组分支 + 对象 delete 语义不变);`sec-21.ts` 原白名单写回断言反转(未声明字段被挡,2.15.0 的"修复2"收窄)+ 三入口(delete_data / write del / edit remove)数组删除黑盒 + 连续删到 0 无空位。断言计数 630→642
- e2e:`tests/e2e/data-slots.mjs` 补"数组子项删除 length 递减、连续删到 0 无空位"(dist 层)。断言计数 210→212

## [2.15.0] - 2026-07-31

### Added
- **浏览器 E2E 测试层(Playwright + mock LLM)**:新增 `tests/browser/` 目录,7 项确定性浏览器测试,覆盖 page-demo(read→write→read)/ human-confirm-demo(两层确认:主动征询→选方案→写前确认→允许/拒绝)/ complex-demo(列组件+edit patch 改 style+子路径读+fields 裁剪)。核心:`_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 OpenAI 兼容 SSE 流(tool_calls + 文本),使 agent ReAct 循环确定性走完,不依赖真 LLM,可进 CI。`playwright.config.ts` 已内置 `PLAYWRIGHT_BROWSERS_PATH`,零配置。新增 `npm run test:browser` / `test:browser:ui` 脚本
- **`.claude/` 项目级 AI 工具链**:新增 12 个 skill(review-bugbot/review-security/create-skill/create-rule/create-hook/split-to-prs/babysit/webapp-testing/frontend-design/everything-claude-code/mcp-builder/check-res-urls/mermaid-to-png)+ 3 个 command(`/review` `/test-all` `/browser-test`)+ 更新 `browser-tester` agent(双模式:交互式探索 + 自动化回归)+ `.mcp.json` 新增 `fetch` MCP server(网页抓取,查文档用)
- **`doc/refactor-selftest.md`**:refactor-module-extraction 自测记录文档(Step 1 自动化门禁 + Step 2 浏览器探索 + Step 3 高风险项验证,全部通过)

### Fixed
- **write 工具单 patch edit + 透传拦截器 → SCHEMA_INVALID**:`write({ value, patch })` 时,拦截器收到 `{ op, jsonPath, value }` 对象,若原样返回(透传),`payload = intercepted` 把整个对象当 value 写入 → schema 校验失败。修复:拦截器返回 `{ op, jsonPath, value }` 时取 `.value` 并同步 `patch.op/jsonPath`;返回纯值时直接用。新增 selftest 断言(sec-21.ts,631 项,原 630 +1)

### Changed
- **CLAUDE.md**:新增 §2.5 浏览器 E2E 测试层 + 测试矩阵加 `npm run test:browser` 列 + 发布前必跑顺序加 browser + Skills/Commands 表更新(含 browser-e2e-testing skill 和 /browser-test 命令)

## [2.14.0] - 2026-07-31

### Added
- **按需引入 subpath exports**:`package.json` `exports` 新增三个 subpath 入口 —— `./storage`(持久化层:`createSessionStore`/`createMemoryBackend`/`createWebStorageBackend`/`isQuotaError`)、`./query`(JSON 查询/沙箱:`jpEval`/`searchJson`/`runSandboxedScript` + jsonUtils/schemaUtils 全部纯函数)、`./llm`(代理连接:`createProxyLlm` 防 apiKey 泄露)。三个 subpath 指向同一 dist + types(不动构建),实际体积靠 bundler tree-shaking(已设 `sideEffects`)。语义清晰 + CDN 可按需入口;顶层 `.` 入口不变(向后兼容),未来切多入口构建时 import 路径零迁移
- **新增顶层导出**:`jsonUtils` 16 个纯函数(`getByPath`/`setByPath`/`deleteByPath`/`deepClone`/`safeStringify`/`hashValue`/`applyPatchToClone`/`applyPatchToLive`/`restoreLive` 等)+ `EditOp` 类型;`schemaUtils` 6 个 schema 白名单函数(`getSchemaTopKeys`/`isPathAllowed`/`unwrapSchema`/`getSchemaAtPath`/`projectBySchemaDeep`/`projectBySchema`);`promptBuilder` 的 `buildSystemPrompt`/`buildDataPrompt`/`DEFAULT_SYSTEM_PROMPT`;期二补充:`contextIndex` 纯函数(`tokenize`/`estimateMessageTokens`/`estimateRoundTokens`/`indexSummarize`/`recallRounds` + `STOP_WORDS`)、`llmResolver`(`isChatModel`/`resolveLlm`)、`conflictManager`(`createConflictManager` + `ConflictManager` 类型);期三:`optionsResolver`(`resolveStorage`/`resolveDialogConfig`)、`events`(`createSdkEvents` + `SdkEvents`)

### Changed
- **模块抽离(refactor-module-extraction 期一,纯重构零行为变化)**:`dataOps.ts` 的 16 个零依赖纯函数抽离至 `tools/jsonUtils.ts`、6 个 schema 白名单投影函数抽离至 `tools/schemaUtils.ts`;`createChatSdk.ts` 的 `DEFAULT_SYSTEM_PROMPT`/`buildDataPrompt` + 新增 `buildSystemPrompt` 统一入口(处理 `appendReliableWriteRules` 分支 + `---` 分割线,纯函数结构化参数)抽离至 `sdk/promptBuilder.ts`。为后续 change(cyrb53/diffObjects → jsonUtils;describeSchemaNode → schemaUtils;getEffectiveSystemPrompt 复用 buildSystemPrompt)建好骨架
- **模块抽离(refactor-module-extraction 期二,纯重构零行为变化)**:`useContextManager.ts` 的 6 个纯函数(分词/估算/摘要/召回)抽离至 `composables/contextIndex.ts`;`createChatSdk.ts` 的 `isChatModel`/`extractText`/`buildSummaryLlmInvoke` + 新增 `resolveLlm`(封装 modelCaps + summaryLlmInvoke 解析)抽离至 `sdk/llmResolver.ts`;`pendingConflict`/`setPendingConflict`/`resolveConflict` 冲突状态机抽离为 `sdk/conflictManager.ts` 的 `createConflictManager` 工厂(emit getter 延迟求值,适配 emit 晚于工厂定义的闭包时序)。`createChatSdk.ts` 1724→1631 行、`useContextManager.ts` 321→235 行。**skillStore 桥接评估延后**(`userSkills` 被 12+ 处引用 + skillsMw/core.infoTick 闭包时序交错,完整抽离风险 > 收益,留期三/独立 change)
- **模块抽离(refactor-module-extraction 期三,纯重构零行为变化)**:`resolveStorage`/`resolveDialogConfig` 抽离至 `sdk/optionsResolver.ts`;`listeners`/`emit`/`hook` 事件系统抽离为 `sdk/events.ts` 的 `createSdkEvents` 工厂(`createSdkEventMiddleware`/`matchDataOp` 仍留 createChatSdk,依赖 messages/liveData/usage 闭包)。`createChatSdk.ts` 1631→1613 行

### Tests
- 新增 `sec-30.ts`(jsonUtils 白盒 ~46 断言:路径/克隆/序列化/投影/patch/还原 + 原型污染防护)+ `sec-31.ts`(schemaUtils + promptBuilder 白盒 ~26 断言)+ `sec-32.ts`(contextIndex + conflictManager 工厂白盒 ~21 断言:set/resolve 状态机 + 并发覆盖兜底 + conflict 事件外发)
- `tests/exports-consistency.mjs` 加 subpath 配置断言(1→6)
- selftest 断言计数 537→630(期一 sec-30/31 + 期二 sec-32;期三 events/optionsResolver 纯重构经 e2e events/storage 模块覆盖,无新增白盒)

## [2.13.0] - 2026-07-31

### Added
- **`memory` 支持异步函数 source(RAG)**:`options.memory` 与 `sdk.setMemory(source)` 现支持三种形态 —— `string`(静态文本)/ `() => string`(同步求值)/ `() => Promise<string>`(异步求值,适合加载 RAG 文档)。异步函数在首次 `beforeAgent` 后台求值并缓存,`sdk.refreshMemory()` 可强制重新求值(文档更新后刷新)。求值失败降级空串(不阻塞 agent)。函数 source 不可序列化,落盘的是已解析文本;reload 时 `options.memory` 仍是函数会重新求值
- **`sdk.refreshMemory()`**:重新求值当前 memory 函数 source,返回最新文本;字符串 source 直接返回当前值
- **`createMemoryMiddleware` / `MemorySource` 类型从入口导出**:供自定义中间件场景复用
- **`rag-demo` 示例**:`examples/rag-demo/` 演示 memory 异步加载知识库 + 切换知识库 + 强制刷新

### Changed
- `minimal-demo` / `headless-demo` / `rag-demo` 导入改为 `../../src/core`(源码直连,避免 dev 模式预打包 dist 旧版缓存问题);mount 改用 CSS 选择器字符串(`'#chat-root'`)
- `demo/npm-local/node_modules/page-agent-sdk/dist` 同步到最新构建(供 `demo/plain.html` CDN 集成示例使用)

### Docs
- `doc/usage-guide.md` §6.4 Memory 章节补充异步函数 source 说明 + 三种形态对比表 + 缓存策略
- `doc/usage-guide.md` §6.11 便捷 API 表 `setMemory` 行更新 + 新增 `refreshMemory` 行 + 场景 3.5 RAG 代码示例
- `README.md` / `README.zh-CN.md`:便捷 API 注释更新 + Examples 表新增 `rag-demo` + 测试徽章 537
- `skills/page-agent-sdk-integrate`:`api.md` 表与 `advanced.md` §3.5 同步异步 memory + RAG 示例
- `CLAUDE.md`:setMemory 描述更新 + 测试计数 537

### Tests
- `sec-29.ts` 新增 memory 异步函数 source 单元断言(同步求值/缓存/refresh/异步求值/缓存/reset 切换/求值失败降级)
- `sec-07.ts` `beforeAgent` 调用改为 `await`(适配异步 beforeAgent)

## [2.12.2] - 2026-07-30

### Added
- **`mount()` 支持传参(异步绑定容器)**:`mount(overrideContainer?: HTMLElement | string)` —— 创建 `createChatSdk` 时可省略 `container`,在 `mount()` 时才指定(传 DOM 元素或选择器字符串),覆盖 `options.container`。适合「先初始化 agent(预加载/恢复持久化),稍后再挂载到 UI」场景。向后兼容(不传参 = 用 `options.container`)
- **LLM 特殊传参透传(`#8`)**:`LLMConfig` 新增 `extraBody`(透传 ChatOpenAI `modelKwargs`,合并到请求 body,如 deepseek thinking: `{ thinking: { type: 'enabled' } }`)+ `extraConfig`(透传 `configuration` 额外字段,如 headers/timeout/customFetch,与 baseUrl 合并)。三处构造 ChatOpenAI 全部透传:主 LLM / 摘要 LLM / `setLlm` 运行时切换。`CreateAgentOptions` 同步加两字段

### Changed
- `examples/dynamic-demo/App.vue`:示范 `mount(root.value!)` 异步绑定容器(创建时不传 container,mount 时传 DOM 元素)

### Docs
- `doc/问题.md` #8 状态更新为「2.12.2 做」+ 实现说明

## [2.12.0] - 2026-07-30

### Added
- **运行时动态重配置(`add-dynamic-reconfiguration`)**:运行时增删工具 / 切换 LLM / 更新 memory / 增删预声明子 agent,无需重建 agent(保留对话历史与中间件状态),全程零破坏(不调用 = 现状行为)
  - `sdk.setTools(tools)` / `addTool(tool)` / `removeTool(name)`:运行时增删**用户工具**(内置工具由 `capabilities` 控制,不动);内部 `rebindTools` 重新绑定到 LLM,下一轮即生效。支持按权限/业务阶段/A-B 实验动态切换工具组
  - `sdk.setLlm(llm)`:运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider);参数 `BaseChatModel` 或 `LLMConfig`(内部构造 `ChatOpenAI`);rebind + 重解析模型能力(`contextWindow`/`maxOutputTokens`);`summaryLlm` 不受影响;新模型不支持 `bindTools` 则工具调用失效(agent 不崩)
  - `sdk.setMemory(text)`:运行时更新持久指令 memory(下一轮 `augmentPrompt` 注入最新;`setMemory('')` 清空)
  - `sdk.setSubagents(configs)` / `addSubagent(config)` / `removeSubagent(id)`:运行时增删预声明子 agent(经 `SubagentsController` 重新生成 `use_<id>` 委派工具 + 触发 rebind);需创建时配 `subagents:[]`(空数组也启用 controller,支持「初始无子 agent,运行时动态 add」)
  - 所有 setter 触发 `infoTick++` → DebugDrawer 实时刷新;`inspect()` 的 tools/model/memory/subagent.subagents 经 getter/`controller.get()` 动态取最新
  - 详见 `doc/usage-guide.md` §6.11、`skills/page-agent-sdk-integrate/references/advanced.md` §6、`openspec/changes/archive/2026-07-30-add-dynamic-reconfiguration/`
- **`complex-demo` 动态重配置演示面板(`examples/complex-demo/DynamicReconfigPanel.vue`)**:一次性展示 4 类新增 API 的使用场景与说明文档(工具/LLM/memory/子 agent 动态化),含实时 `inspect()` 快照 + 操作日志(before→after);demo 顺带配 `subagents:[]` 占位启用 controller

### Changed
- **`subagentsMw` 创建条件**:`options.subagents?.length`(空数组 falsy)→ `useSubagent && options.subagents !== undefined`,使 `subagents:[]` 也能创建 `SubagentsController`(支持「初始无子 agent,运行时动态 add」场景)
- **`createAgent` 内部**:`allTools`/`llmWithTools`/`llm` 改 `let` + 新增 `rebindTools()`;返回对象 `allTools` 改 getter(setTools/setLlm 重赋值后 inspect 取最新);新增 `setTools`/`setLlm` 方法 + `onLlmChange` 回调选项
- **`memory` 中间件**:新增 `get()` 方法(供 `inspect().memory` 反映运行时 `setMemory` 后的最新)
- **`SubagentInfo` 类型**:新增 `subagents?` 字段(预声明子 agent 列表,动态反映 setSubagents/addSubagent/removeSubagent)
- **导出**:新增 `SubagentsController` 类型导出

### Docs
- `doc/usage-guide.md` 新增 §6.11「运行时动态重配置」(API 表 + 4 个场景代码示例)
- `doc/architecture.md` ⑨ 子 agent 小节补「运行时动态重配置」机制说明
- `doc/system-prompt.md` B4 memory 段标注「运行时可经 `sdk.setMemory` 更新」
- `doc/roadmap.md` #5 标记「✅ 已完成(归档)」并简化为指引(详情在 openspec archive)
- `doc/问题.md` #5 移除(已完成),决策汇总表同步
- `README.md` / `README.zh-CN.md` 便捷 API 注释补 8 个 set*/add*/remove* 方法;测试徽章计数修正(→ 524);e2e 覆盖描述补「运行时动态重配置」
- `skills/page-agent-sdk-integrate/references/api.md` API 表补 8 个动态方法 + 「Runtime dynamic reconfiguration」章节
- `skills/page-agent-sdk-integrate/references/advanced.md` 新增 §6「Runtime dynamic reconfiguration」(代码示例 + 缺失项说明)
- `skills/page-agent-sdk-integrate/references/options.md` `subagents` 选项补注「传 [] 启用 controller 支持运行时动态 add」
- `CLAUDE.md` 测试计数 495→524 / 189→210;新增「运行时动态重配置」API 说明;SDK 用法示例补 setTools/setLlm/setMemory/setSubagents + subagents:[];Agent 身份职责分工提及「运行时资源动态加载/卸载」

### Tests
- selftest 495→524(+29,新增 `sec-29` 模块:tools/subagents/llm/memory 动态化单元断言)
- e2e 189→210(+21,`inspect.mjs` 增 setTools/addTool/removeTool/setSubagents/addSubagent/removeSubagent/setLlm/setMemory 反映断言 + 未配 subagents 时 setter warn 不抛错)

## [2.11.0] - 2026-07-28

### Added
- **代理连接模块(`createProxyLlm`)**:统一管理 LLM 接入,支持两种模式,dev/prod 切换不改代码结构
  - `proxy` 模式(上线用):浏览器只持 `userToken`,服务端注入真实 `apiKey` 转发到 LLM API,防 apiKey 泄露;支持 `refreshToken`(401 自动刷新重试一次)、自定义 `headers`
  - `direct` 模式(开发用):浏览器持真实 `apiKey` 直连 LLM API(仅开发环境,生产环境 warn 提醒)
  - 返回 `BaseChatModel` 实例,直接传 `createChatSdk({ llm })`;`summaryLlm` 也可用同工厂走代理
  - 兼容性:自定义 fetch 经 `configuration.fetch` 透传 OpenAI client(已验证 @langchain/openai 1.5.x);兼容 `string|URL|Request` 入参;401 重试仅对可重复发送的 body(string/ArrayBuffer/Blob/FormData/URLSearchParams),ReadableStream 跳过避免已消费;token 刷新单例锁防并发重复刷新
  - 详见 `doc/usage-guide*.md` §8.6
- **代理示例(`examples/proxy-demo/`)+ mock 代理 server(`scripts/proxy-mock-server.ts`)**:完整可运行演示,浏览器只持 userToken,代理注入真实 key 转发;含 token 过期自动刷新演示;`npm run proxy:mock` 启动

## [2.10.3] - 2026-07-28

### Fixed
- **README 链接 404**:`README.md`/`README.zh-CN.md` 中相对链接(`./README.zh-CN.md`、`./CLAUDE.md`、`./LICENSE`、`./doc/*.md`)在 npm 站点解析为 `npmjs.com/package/...` → 404;改为 GitHub 绝对 URL(`https://github.com/whyymj/page-agent-sdk/blob/master/...`),npm 与 GitHub 均可正确跳转

## [2.10.2] - 2026-07-28

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复
- **输入框可拖拽**:`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);`inputRows` 默认 2 行
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

## [2.10.0] - 2026-07-28

### Added
- **`dialog` 归组配置**:对话框 UI 配置(`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose`)归组到 `dialog` 字段,API 更整洁;**扁平写法已移除**(不再支持顶层 `title`/`placeholder`/`drawer`/...)
- **`inputRows` 默认改 2 + 可拖拽**:输入框默认 2 行初始高度(原 1 行),更易输入多行内容;`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);仍自动扩展
- **`drawerWidth` 选项**:抽屉模式自定义聊天框宽度(像素或 CSS 字符串,如 `500` / `'500px'` / `'40vw'`);默认 420px;仅 `dialog.drawer: true` 生效
- **`drawerHidden` 选项**:抽屉模式默认隐藏(`mount` 后不显示,需 `sdk.show()` 才出现):适合「点击按钮才出现聊天框」场景;仅 `dialog.drawer: true` 生效
- **Skill 独立持久化(SkillStore)**:用户创建的 skill 不再随 `SessionSnapshot` 持久化,改由独立 `SkillStore` 管理(`backends/skillStore.ts`)
  - **默认 indexedDB**:即使 `storage:false`(会话持久化关闭),用户 skill 仍持久化,跨刷新恢复
  - **跨页面/跨 agent 复用**:新增 `skillStorage` 选项,手动指定同一 `id` 即可让多个 `createChatSdk` 实例(不同 agentId)共享同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离
  - `skillStorage: false` 关闭持久化(仅当前会话内存有效)
- **`sdk.getUserSkill(name)`**:读取用户创建的 skill 详情(返回 `{name, description, content}` 或 `undefined`),供 SkillPanel 编辑
- **SkillPanel 编辑能力**:点击已创建 skill 加载到表单编辑(名称锁定不可改,描述/内容可改),保存调 `sdk.addSkill`(同名覆盖 = 编辑)
- **`SkillStoreConfig` 类型 + `createSkillStore` 导出**:集成方可独立构造 SkillStore 自定义 UI/管理
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

### Changed
- **`SessionSnapshot` 移除 `skills` 字段**:用户创建 skill 不再随会话快照持久化(改由独立 SkillStore);`SNAPSHOT_KINDS` 由 5 项减为 4 项(messages/vfs/todos/memory)
- `PersistedSkill` 接口标记 `@deprecated`(保留仅为类型兼容,不再写入 SessionSnapshot)
- `applySnapshot` 不再恢复 skills(由 `loadUserSkillsFromStore` 在 init 时从 SkillStore 加载)
- **移除扁平写法(破坏性)**:`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose` 不再支持顶层传入,统一改用 `dialog: { ... }` 归组(减少历史包袱)
- IIFE 体积阈值 1.6MB → 1.7MB(SkillPanel/skillStore 新增代码致全量包略增)

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复

## [2.9.1] - 2026-07-27

### Docs
- **对接提示词通用模板**:新增 `skills/page-agent-sdk-integrate/references/integration-prompt.md`(进 npm 包,英文),供集成方复制给对接项目的 AI(Cursor/Claude Code)按流程集成;README 中英 + SKILL.md + CLAUDE.md 补充"对接提示词推荐"段
- 新增 `doc/集成提示词-Vue2-低代码页面-抽屉.md`(中文特定场景示例,仓库内)

## [2.9.0] - 2026-07-27

### Fixed
- **schema 白名单子路径投影**:`read components.0` 等子路径读现按该位置的子 schema 递归投影(隐藏 child 未声明字段);原仅顶层投影,子路径泄露 child 不可见字段
- **`isPathAllowed` 逐段校验**:`jsonPath` 逐级检查每段在 schema 声明内(防子路径绕过顶层白名单);`unwrapSchema` 支持 ZodLazy 解包(递归 schema)
- **`set`/`write(set)` 整对象 + `interceptors.write` 补充不可见字段写回 bind**:原 schema strip + safeMerge 丢失补充字段;现从原始 parsed 取不在 allowKeys 的字段写回(信任集成方拦截器/用户显式传值)

### Added
- **ChatDialog 抽屉模式**(`drawer: true`):右侧滑出 + 遮罩 + 关闭按钮(替代折叠箭头);关闭默认 `hide()` 保留历史与生成进程
- **`sdk.hide()` / `sdk.show()`**:不卸载 Vue 应用与 agent,仅加 `cs-hidden` 类隐藏;`mount()` 对已挂载隐藏实例幂等调 `show()`
- **动画**:展开/收起、卸载退出、挂载进入(抽屉滑入)三类 CSS 过渡
- **`onClose` 选项**:自定义关闭行为;抽屉模式默认 `hide()`,非抽屉默认 `unmount()`
- `animation-demo`(动画 + hide/show)、`multi-agent-demo`(多 agent 并行 + 互斥切换)
- `EditableBanner` 标识 AI 可编辑区、`DevNav` 折叠下拉

## [2.8.0] - 2026-07-27

### Added
- **`sdk.setSkills(skills)`**:运行时替换整个 skill 列表(同名覆盖);下轮 system prompt skill 索引段重渲染,清 skill 全文缓存,下次 `load_skill` 取最新全文(含 vfs doc)
- **`sdk.invalidateSkillCache(name?)`**:动态 skill 内容变化时主动失效缓存(不传清全部,传 name 清指定)
- **`sdk.exportData()` / `sdk.importData(data)`**:导出/导入主数据 `bind` 的深拷贝
- **`sdk.usage`**:累计 token 用量 `{prompt_tokens, completion_tokens, total_tokens}`
- **`onAudit` 选项**:结构化审计回调(set/edit/delete/restore)
- **`session_restored` 事件**:会话恢复时触发
- **skill 全文缓存**:`SkillsController` + `contentCache`,跨轮不重复 load 同一 skill;`offloadLargeResult` 内容寻址去重(VFS 不重复存同一内容)
- **`infoTick`**:DebugDrawer 实时刷新(动态 skill/data 变化反映)

## [2.7.1] - 2026-07-27

### Docs
- README 中英补充「schema / systemPrompt / skill 三层配合」设计思路章节

## [2.7.0] - 2026-07-27

### Changed
- **`appendReliableWriteRules` 默认改 `true`**:自定义 `systemPrompt` 时自动追加 `reliableWriteRules`(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch),用 `\n\n---\n\n` 分隔线明确区分用户内容与 SDK 追加

## [2.6.1] - 2026-07-26

### Docs
- 所有 demo 展示 `appendReliableWriteRules: true` + 注释说明

## [2.6.0] - 2026-07-26

### Added
- **`appendReliableWriteRules` 选项**:自定义 `systemPrompt` 时自动追加 `systemPromptHelpers.reliableWriteRules`(默认 false,2.7.0 改 true)

## [2.5.1] - 2026-07-26

### Fixed
- **verify/checkpoint 支持单对象 data 模型**:`createWriteBackCheck` 加 `root` 选项、`createCheckpointManager` 加 `getData` 选项,`createChatSdk` 传 `root: () => liveData()?.bind` / `getData: () => liveData()?.bind`(原误读 `globalThis.window` 致单对象 data 校验/回滚失效)
- skills 重写 + 文档同步

## [2.5.0] - 2026-07-26

### Added
- **schema 形状自动白名单**:`data.schema` 为 `ZodObject` 时,顶层声明 key 自动作为可读写白名单(`read` 整体按 schema 投影隐藏未声明字段;`write`/`edit`/`delete` jsonPath 顶层段必须在白名单内否则 `PATH_DENIED`;整体 set 转 merge 语义防误删)
- **`write` 批量 `patches`**:一次原子应用多个 patch,任一失败整体回滚
- **`read` 字段裁剪 + 深度截断**:`read({ jsonPath, fields, depth })` 支持字段投影 + 深度截断瘦身大返回
- **`eval_script` 增量 transform**:沙箱脚本返回 transform 函数增量改 bind
- **`allowPaths` 选项**:细粒度 per-path 权限

### Fixed
- 记忆系统:`trimToolResults` 死代码移除;`summarization` 与 `trimMemoryMessages` 双摘要合并;`getRegisteredSlots` 术语更新为 `getRegisteredData`

## [2.4.1] - 2026-07-26

### Fixed
- 修复代码层旧名残留(window* → dataSlot*/slot* 重命名遗漏)
- examples 非 Vue 场景改造(普通对象 bind + onEvent tick 重渲染)

## [2.4.0] - 2026-07-26

### Breaking(统一配置:删 `io`/`bind` 顶层选项,并入 `dataSlots`;按 minor 发布,不升 major)
- **删除 `io` 顶层 IO 契约选项**:不再支持 `io.input`/`io.output`。原能力(从 zod schema 自动提取字段说明注入 systemPrompt)由 `dataSlots[].schema` 的 `.describe()` 自动承担 —— SDK 现扫描所有 `dataSlots` 的 schema,经 `extractSchemaHint` 提取字段说明,注入 systemPrompt「可操作属性」段(取代原「输入/输出契约」段)
- **删除 `bind` 顶层响应式直连选项**:不再支持 `bind: { key: obj }`。原能力(reactive/普通对象直连 + 自动挂 window + 注册 dataSlot)由 `DataSlotSpec.bind` 字段承担 —— `dataSlots: [{ path, schema, bind: obj }]`,SDK 自动 `window[path] = bind`(支持点号 path) + 注册为 dataSlot
- **`DataSlotSpec.description` 改为可选**:传了 `bind` 且未传 `description` 时,自动生成 `${path}(bind 直连)`;不传 `bind` 时建议仍写 `description`(否则用 `path` 兜底)
- **`DataSlotSpec` 新增 `bind?: any` 字段**:可选,传 reactive/普通对象 → 自动挂 `window[path] = bind` + 注册为 dataSlot;reactive 写后响应式刷新(推荐 UI),普通对象可写但不响应(适合 headless,集成方用 `onEvent`/`hook` 的 `data_slot_change` 通知)

### Migration(2.x → 3.0)
- `bind: { page: pageObj }` + `io: { output: PageSchema }` → `dataSlots: [{ path: 'page', schema: PageSchema, bind: pageObj }]`
- `io: { input: InSchema, output: OutSchema }`(无 bind)→ 把 OutSchema 放到对应 `dataSlots` 项的 `schema`(字段说明自动注入);`io.input` 的输入契约段无对应替代,需自行在 `systemPrompt` 用 `extractSchemaHint(InSchema)` 拼入(罕见场景)
- 仅用 `dataSlots` 不用 `io`/`bind` 的集成方 → 无需改动

### Fixed
- **`write` 高层工具不触发 `data_slot_change` 事件**(L2 遗漏):`matchWindowOp` 原只映射底层 `set`/`edit`/`delete`/`restore_data_snapshot`,未匹配 `write`(simple 默认主入口)→ 集成方 `onEvent`/`sdk.hook` 订阅 `data_slot_change` 收不到通知。现 `matchWindowOp` 加 `write` 分支,按 args 推断 operation(`del`→delete,`patch`→edit,否则 set),`wrapToolCall` 传 `ctx.args`。simple 默认模式下 `write` 改数据槽现能正确触发 `data_slot_change`。

### Docs
- `doc/usage-guide.md` / `doc/usage-guide.en.md`:删 `io`+`bind` 段,新增 `dataSlots` 统一配置段(3.0+,含 `bind` 字段 + schema `.describe()` 自动注入 + 不强制 reactive + 通知外界机制)
- `README.md` / `README.zh-CN.md`:配置示例删 `io`/`bind` 行,`dataSlots` 行补 `bind` 字段说明
- `skills/page-agent-sdk-integrate/references/api.md`:删 `io`+`bind` 段,新增 `dataSlots` unified config 段
- `CLAUDE.md`:删 `io`/`bind` 架构要点,合并为 `dataSlots` 统一配置段;examples 段各 demo 配置方式标注更新(3.0 dataSlots bind / dataSlots 细粒度 / 手动 toolset);e2e 描述更新
- `types/index.d.ts`:`DataSlotSpec` 加 `bind?`、`description?` 改可选;删 `ChatSdkOptions.io`/`ChatSdkOptions.bind`

## [2.3.0] - 2026-07-26

### Added(L3:顶层 IO 契约 + 响应式绑定 + input/output 拦截器,纯新增,不 breaking)
- **`io` 顶层 IO 契约**:声明 agent 的输入/输出 JSON 形状(zod schema),SDK 自动提取字段说明注入 systemPrompt(输入/输出契约段),集成方不用手写 description
  - `io.input`:agent 能读的明文 JSON 形状 → 注入 systemPrompt「输入契约」段
  - `io.output`:agent 能写的明文 JSON 形状 → 注入 systemPrompt「输出契约」段;兼作 `bind` 主对象 schema
  - 与 `dataSlots` 并存:`io` 是单主对象声明式快捷方式,`dataSlots` 是多 slot + 动态注册复杂场景
- **`bind` 响应式对象直连**:集成方直接把响应式对象绑给 sdk,每个 key 自动注册为 dataSlot(path=key, schema 从 io.output 推断或 z.any),底层挂到 window[key]
  - LLM write → 响应式对象自动更新;集成方改对象 → LLM read 可见
  - 底层仍走注册表 + schema 校验 + 乐观锁,不绕过安全边界
- **`interceptors.input`/`interceptors.output`**:agent 级 IO 预处理/后处理
  - `input(input)`:send 入口预处理 user message(可改写/审计)
  - `output(json)`:agent 返回前 postprocess(可改写最终回复)
- 新导出:`extractSchemaHint(schema)` 纯函数(从 zod schema 提取字段说明,供集成方预览 io 契约将注入的提示)

### Changed
- `inspect().systemPrompt` 现反映 io 契约拼接后的最终 systemPrompt(含输入/输出契约段)

### Migration
- 旧代码不传 `io`/`bind`/`interceptors.input`/`interceptors.output` → 行为不变
- 推荐新代码用 `io` + `bind` 声明式用法(单主对象场景),免手写 dataSlots description + 手动同步

## [2.2.0] - 2026-07-26

### Added(L2:分层工具呈现 read/write + toolMode + 拦截器,向后兼容)
- **高层读写工具 `read`/`write`**:合并 list/describe/get 与 set/edit/delete + 自动乐观锁 + 自动快照,降低 LLM 认知负担
  - `read({path?})`:不传 path 列出所有可操作槽;传 path 返回当前值 + hash + 格式说明
  - `write({path, value?, patch?, del?})`:三种意图——整体 set(value 直传 JSON 对象,如 `{title:"x"}`)/ 增量 patch(`{op,jsonPath}`,op=set/remove/merge/append)/ 删除(`del:true`)。写入自动经 schema 校验 + 自动存快照 + 自动乐观锁(autoLock)
- **`toolMode` 选项**(`simple` 默认 / `advanced` / `minimal`):控制数据槽工具呈现面
  - `simple`(默认):主推 `read`/`write`,隐藏底层 `get`/`set`/`edit`/`delete`/`list`/`describe`(6 个),保留 `query`/`search`/`eval`/`snapshot` 等高级能力(共 9 个数据槽工具)
  - `advanced`:全暴露(15 个数据槽工具,等价旧 13 + read/write)
  - `minimal`:只 `read`/`write`(2 个数据槽工具)
- **`interceptors` 选项**(读写拦截器):集成方可脱敏/转换/审计/拒绝 LLM 的读写
  - `read(path, value)`:LLM 读时拦截,可脱敏/派生(只改 LLM 看到的值,不改实际存储)
  - `write(path, payload, current)`:LLM 写时拦截,可转换/审计,返回 `{error}` 拒绝
- 新导出:`filterByToolMode(tools, mode)` 纯函数 + 类型 `ToolMode`/`DataSlotInterceptors`
- `usageHints` 中间件按 `toolMode` 注入提示(simple 主推 read/write,advanced 保留底层 get/set 提示)

### Changed
- `createDataSlotOps` 返回工具数 13 → 15(新增 `read`/`write`);`defineDataSlotToolset` 同
- `createUsageHintsMiddleware` 新增第三参数 `toolMode`(默认 `simple`,向后兼容)

### Migration
- 旧代码不传 `toolMode` → 默认 `simple`,inspect().tools 不再含底层 `get_data_slot`/`set_data_slot` 等(被 read/write 合并);若依赖底层工具名,显式传 `toolMode:'advanced'`
- 旧代码不传 `interceptors` → 行为不变
- 推荐新代码用 `read`/`write` + `toolMode:'simple'` + `interceptors`(脱敏/审计),LLM 认知负担最低

## [2.1.0] - 2026-07-26

### Added(L1:JSON 直传 + 自动乐观锁,零缩水,向后兼容)
- **JSON 直传**:`set_data_slot`/`edit_data_slot` 的 `value` 现接受 JSON 对象直传(推荐,如 `{title:"x"}`),无需 stringify;仍兼容 JSON 字符串(向后兼容)。LLM 出错率显著下降
- **自动乐观锁 `autoLock`**(默认 `true`):写入时若 LLM 未显式传 `expectedHash`,自动用「LLM 最后一次 `get_data_slot` 读到的 hash」作基准比对,冲突走 `onConflict`(无则返回 `VERSION_CONFLICT`)。LLM 无需手动传 hash 即享乐观锁保护;设 `autoLock:false` 回退「不传 = 不校验」旧行为
- `DataSlotOpsOptions`/`ChatSdkOptions` 新增 `autoLock?: boolean` 字段

### Changed
- `get_data_slot` 内部记录 LLM 最后读到的 hash(供 autoLock 比对),返回格式不变

### Migration
- 旧调用传 JSON 字符串仍工作(向后兼容)
- 若依赖「不传 expectedHash = 不校验」的旧行为,显式设 `autoLock:false`
- 推荐新代码直接传 object + 依赖 autoLock,不再手动管理 hash

## [2.0.0] - 2026-07-26

### Changed (breaking — major)
- 全局命名去 `window` 化,改为 `dataSlot`/`slot`,体现「规范化 JSON 操作 Agent、前后端通用」定位(原 `window` 前缀暗示浏览器 window 对象,在 Node/服务端场景误导):
  - 配置项 `windowProps` → `dataSlots`;类型 `WindowPropInfo`/`WindowPropSpec`/`WindowOpsOptions`/`WindowOpsController`/`WindowAuditEntry`/`WindowSnapshotEntry` → `DataSlotInfo`/`DataSlotSpec`/`DataSlotOpsOptions`/`DataSlotOpsController`/`DataSlotAuditEntry`/`DataSlotSnapshotEntry`
  - 能力开关 `capabilities.windowOps` → `capabilities.dataSlotOps`
  - 工具名:`list_window_props`/`describe_window_prop`/`get_window_prop`/`set_window_prop`/`edit_window_prop`/`delete_window_prop`/`snapshot_window_prop`/`list_window_snapshots`/`restore_window_snapshot`/`get_window_paths`/`query_window_prop`/`search_window_prop`/`eval_window_script` → `list_data_slots`/`describe_data_slot`/`get_data_slot`/`set_data_slot`/`edit_data_slot`/`delete_data_slot`/`snapshot_data_slot`/`list_data_snapshots`/`restore_data_snapshot`/`get_slot_paths`/`query_data_slot`/`search_data_slot`/`eval_script`
  - 实例 API `addWindowProp`/`removeWindowProp`/`listWindowProps` → `addDataSlot`/`removeDataSlot`/`listDataSlots`;工厂 `createWindowOps`/`defineWindowToolset` → `createDataSlotOps`/`defineDataSlotToolset`
  - 事件 `window_prop_change` → `data_slot_change`
  - 文件 `src/core/tools/windowOps.ts`/`windowQuery.ts` → `dataSlotOps.ts`/`dataSlotQuery.ts`;`tests/e2e/window-props.mjs` → `data-slots.mjs`
  - 注:`getByPath(window, ...)` 等工具函数体内裸 `window` 仍指宿主浏览器 window(零桥接设计,不变);`contextWindow`(LLM 上下文窗口)不变
  - 迁移:集成方需把 `windowProps:` 改 `dataSlots:`、`capabilities.windowOps` 改 `capabilities.dataSlotOps`、`sdk.addWindowProp` 改 `sdk.addDataSlot` 等;工具名变更影响 LLM 调用,旧 systemPrompt 若硬编码旧工具名需同步

## [1.4.2] - 2026-07-25

### Fixed
- 剪贴板复制在非 secure context(HTTP / 非 localhost)失效:`navigator.clipboard` 为 undefined 或 `writeText` reject 时无降级 + 未 catch 致 unhandled rejection + 仍显示「已复制 ✓」误导。新增 `copyText` helper(Clipboard API 优先,失败降级 `document.execCommand('copy')`,失败返回 false 不误导),`MessageContent`/`CodePreview`/`ChatDialog`/`DebugDrawer` 四处改用
- shareContext 多实例并发冲突覆盖:`setPendingConflict` 直接覆盖 `pendingConflict.value`,后者覆盖前者致前者 `resolve` 丢失 → 前者工具调用永久挂起。覆盖前自动按 `keep_external` 收口旧冲突兜底
- `ChatSdk` 接口缺 `pendingConflict` / `resolveConflict` 声明(tsc 报错)
- `types/index.d.ts` 与 src 不同步:`pendingConflict` 裸值 → 同步为 `Ref<PendingConflict | null>`;补 `copyText` 导出声明

### Added
- 导出 `copyText` 工具函数(供集成方自建 UI 复制按钮复用,自动降级兼容非 secure context)

## [1.3.8] - 2026-07-25

### Added
- 导出一致性检查(`tests/exports-consistency.mjs`):静态分析对比 `src/core/index.ts` 与 `types/index.d.ts` 导出名集合,防 d.ts 脱节
- 类型测试基线(`tests/types.test-d.ts` + `tsconfig.test.json` + `test:types`):tsc --noEmit 验证 types 导出齐全 + 关键类型正确
- 补全 `types/index.d.ts` 缺失的 27 个导出(resolveContextOptions/ContextPreset/CONTEXT_PRESETS、connectMcp/extractText/McpTransport/McpConnection、Middleware/ModelRequest/ModelResponse/ToolCallContext/StateUpdate、createSubagentsMiddleware/SubagentOptions/SubagentLlmConfig、createVfs、ContextManagerOptions/CompressionStats、resolveModelCaps/estimateTokens/offloadThresholdChars/offloadPassThroughChars/ModelCaps 等)

### Fixed
- `types/index.d.ts` AgentInfo 后多余 `}` 致 tsc 报 TS1128(由类型测试基线首次跑发现)

## [1.3.7] - 2026-07-25

### Changed
- e2e 测试按模块拆分:单文件 `tests/e2e-integration.mjs` → `tests/e2e/*.mjs` 11 个主题模块 + runner 汇总
- 修正 `createAssert` 解构 bug(解构 pass/fail 取当时值不随 assert 递增,改用 ctx 引用末尾读 getter)

## [1.3.6] - 2026-07-25

### Added
- e2e 扩充至 120 项,覆盖各 API/配置项/功能模块/场景:导出项完整(39+ 函数/组件)、inspect 初始状态、storage 对象配置、presets 三预设、dataSlots 8 种 schema + 嵌套、动态注册与 inspect 同步、shareContext 开关、工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson)、source=builtin、mount 边界、hook 多监听器、llm 配置

## [1.3.5] - 2026-07-25

### Added
- e2e 扩充至 86 项:自定义 tools/middleware/skills/memory 注入、inspect 反映配置(id/model/subagent/verify/mcp)、switchSession(开/未开)、restoreLastCheckpoint/listCheckpoints、导出项可用、配置项可传、shareContext 共享、storage 后端、presets

## [1.3.4] - 2026-07-25

### Added
- e2e 扩充至 48 项:inspect().tools 反映 dataSlotOps 开关 + 工具集完整性、inspect().middleware 反映 capabilities、预声明 subagents、默认 systemPrompt 含能力概述、自定义 + reliableWriteRules 拼接、onEvent + hook 联动

## [1.3.3] - 2026-07-24

### Fixed
- 修复 `createChatSdk` 顶层 `addDataSlot`/`removeDataSlot`/`listDataSlots` 作用域 bug(引用 buildCore 内部变量致运行时 ReferenceError)

## [1.3.2] - 2026-07-24

### Added
- e2e 集成测试(`tests/e2e-integration.mjs`):14 项,验证 createChatSdk 顶层 API(默认 systemPrompt/动态注册/inspect/hook)

## [1.3.1] - 2026-07-24

### Added
- `inspect().systemPrompt` 字段(供调试/验证默认提示词)
- `DEFAULT_SYSTEM_PROMPT`:未传 systemPrompt 时使用内置默认(含身份/能力概述/reliableWriteRules)

## [1.3.0] - 2026-07-24

### Added
- 运行时动态注册 `dataSlots`:`sdk.addDataSlot`/`removeDataSlot`/`listDataSlots`(懒加载组件场景)
- 压缩不丢信息保障(A/B/C/D):压缩注入注册表快照、写工具结果附 path 列表、preserveLastToolResults 可配、导出 `systemPromptHelpers.reliableWriteRules`
- `usageHints` 补 `list_data_slots`/`describe_data_slot`/`get_data_slot` 用法提示
- `examples/dynamic-demo/`:懒加载组件 + 动态注册 + onEvent 示例

## [1.2.0] - 2026-07-23

### Added
- `onEvent` 事件回调:订阅常用时机替代轮询(data_slot_change/message_update/tool_call/tool_result/text/round_start/done/error)
- `sdk.hook()` 实例方法:运行时动态订阅 SDK 事件(可多个监听器、可取消),与构造时 onEvent 互补
- 服务端(Node.js)兼容:mount/unmount 的 window/document 访问加 typeof 守卫

## [1.1.1] - 2026-07-22

### Changed
- skills 含入 npm 包 files(使用者可从 `node_modules/page-agent-sdk/skills/` 安装)

### Fixed
- release skill 改为维护者私有 —— 从公开 npm 包移除,仅留仓库 `.claude/skills/`

## [1.1.0] - 2026-07-22

### Added
- 两个项目 skill:`page-agent-sdk-integrate`(公开分发,集成 SDK)、`page-agent-sdk-release`(维护者自用,发布流程)
- 项目结构规范化:根目录 demo html 整理进各 `examples/<demo>/index.html`
- CLAUDE.md 补充完整发布流程 checklist(改代码→中英文文档→bump→build/test→推 gitee→推 github→发 npm→验证)
