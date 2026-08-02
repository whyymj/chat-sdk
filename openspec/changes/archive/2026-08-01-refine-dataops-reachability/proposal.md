# Change: refine-dataops-reachability

> 三件 dataOps 精修:① read 概览去约束(与 systemPrompt 去重复);② usageHints 补分页/多路径/dryRun(让 evolve 加的能力可达);③ describeSchemaNode zod 版本防御(adapter 集中 + dev warn)。
> **考虑后续功能升级**:约束消费解耦(加消费点不改提取)/ usageHints 分支式扩展(加提示 push 一行)/ zod 探测集中成 adapter(未来 zod5/别的库只改 adapter,消费与接口不变)。

## Why

复盘 expose-schema + evolve 发现:

1. **约束三处重复**:`extractSchemaHint`(systemPrompt「可操作数据」段)与 `read` 不传 jsonPath 的概览段都调 `renderSchemaOverview` → 同样约束内容。systemPrompt 每轮已在,每次整体 read 又带一遍 = token 冗余。

2. **evolve 加的能力 LLM 不会用**:`read` offset/limit(分页)/`jsonPaths`(多路径)/`write` dryRun,usageHints **全没注入**用法。最严重是**分页**:`read` 大数组默认截断 50 + hasMore,LLM 不知用 offset 翻页 → 能力加了但不可达。

3. **describeSchemaNode 硬依赖 zod 4 内部 API**(`check._zod.def` / `_def.type` / `minValue`)——非公开,zod 升级 / 集成方 zod 版本不同时静默返空约束(降级不崩但无声,难诊断)。

## What Changes

### 1. read 概览去约束(去重复)

- `read` 不传 jsonPath 的概览段去掉 `renderSchemaOverview`,恢复"主数据说明 + 格式提示"短段(expose-schema 前的状态)。
- 约束由 systemPrompt(`extractSchemaHint`,每轮在)+ `schema_data`(按需深入)负责。read 保持"读值"干净语义。
- **扩展性**:约束提取(`describeSchemaNode`)与消费(systemPrompt/schema_data/read)解耦;未来若要让 read 子路径带约束、或概览带可选约束开关,`renderSchemaOverview` 纯函数仍在,read 概览调不调是 1 行改动。

### 2. usageHints 补分页/多路径/dryRun(让能力可达)

按"能力可达性"分层补(克制注入,避免 prompt 膨胀):
- **必补·分页**(LLM 最不可能自己发现):simple + advanced 段补"读大数组(`read` 返回 `hasMore=true`)用 `offset`/`limit` 翻页(`offset+=limit` 续读)"
- **建议补**:多路径(`read` `jsonPaths` 一次读多路径省轮次)、dryRun(`write` 复杂 `patches` 先 `dryRun:true` 预检不落盘)
- **不补**:`history_data`/`diff_data`/`schema_data` —— tool description 已说明,usageHints 不重复
- **扩展性**:`hints` 数组结构保留;未来加新能力提示,在对应 simple/advanced 分支 `push` 一行即可(design 注释写明扩展规约,不做数据驱动过度工程)。

### 3. describeSchemaNode zod 版本防御(adapter 集中 + dev warn)

- **adapter 集中**:zod 内部结构探测(`_zod.def` / `_def.type` / checks / minValue/maxValue / options / values / element / shape / innerType)集中在 `readCheckDefs` + `describeSchemaNode` 的 switch,已是单点;顶部注释声明"zod 4.4+ adapter,未来 zod 5 / 别的 schema 库新增 adapter 分支于此,`SchemaNodeDesc` 接口与三处消费不变"。
- **兜底明确**:结构探测失败(`_zod`/`_def` 不存在)→ 返 `{type}` 无约束(已实现);**新增 dev 模式 `console.warn`(去重)**:探测到 schema 无 `_zod`/`_def` 时提醒"zod 版本可能不兼容,约束提取降级为 type-only",生产静默。
- **扩展性**:adapter 模式——未来 zod 5 改结构,只改 `readCheckDefs`/`describeSchemaNode` 的读取分支,`SchemaNodeDesc` 接口 + 三处消费(systemPrompt/schema_data/未来 read)零改动。

## Impact

- **行为微调**:`read` 整体返回更短(去约束段);systemPrompt/schema_data 约束不变
- **prompt 略增**:usageHints +~3 行(simple/advanced 各补分页/多路径/dryRun),换 LLM 能力可达
- **健壮性**:zod 版本不兼容时 dev 可见(生产降级不崩)
- **测试**:selftest sec-31 read 概览断言更新(去约束)+ sec-19 usageHints 断言含分页 + zod 兜底断言(type-only);e2e systemprompt 约束断言不变(systemPrompt 仍带)
- **影响规范**:`page-agent-core.md` 的"字段约束可见性"Requirement 修正(read 概览不带约束,只 systemPrompt + schema_data)

## Non-goals

- **不重构** usageHints 成数据驱动(当前 if/else + push 对加提示已够扩展,过度工程)
- **不补** history/diff/schema 的 usageHints(tool description 已说明)
- **不做** write dryRun 4 处分支合并(纯内部重构,行为不变,独立 low-priority,不单独立项)
- **不硬阻断** zod 版本(peerDep 难强约束,用 dev warn 提醒)
