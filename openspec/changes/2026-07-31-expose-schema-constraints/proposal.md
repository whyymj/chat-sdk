# Change: expose-schema-constraints

> 配套:本变更让 LLM 在写之前能精确感知字段约束(类型 / min / max / enum / 必填 / 默认值),减少"写错 → schema 校验失败 → 重试"的轮次浪费。当前 `read` 只返回值,不暴露 zod 约束,LLM 靠"写错被拒"被动感知。本变更是 `evolve-default-toolset` 明确列出的 Non-goal 后续(`evolve` 聚焦工具集构成,本变更聚焦 schema 约束可见性)。正交,可独立。

## Why

1. **字段约束对 LLM 不可见,靠试错感知**。`read` 返回当前值 + 整体 hash,但不告诉 LLM "这个字段是 `z.string().min(1).max(100)`" 还是 "这个数组 `.min(1)` 不能删空" 还是 "这个字段是 enum `['a','b','c']`"。LLM 只能写了被 schema 拒才知道约束,一次写错浪费一轮工具调用 + 一轮重试。

2. **`describe_data` / `extractSchemaHint` 现状信息量不足**。`describe_data`(simple 隐藏)只给"说明 + 格式提示";`extractSchemaHint`(注入 systemPrompt)只生成 `- key: description` —— 都不带类型与约束(min/max/enum)。集成方写了丰富的 zod 约束(`.min()/.max()/.enum()/.email()/.url()`),这些信息对 LLM 不可见,白写。

3. **evolve 留的后续**。`evolve-default-toolset` 的 Non-goals 明确:"不暴露 schema 约束为独立工具 —— 留后续 change(可能走 read 附带类型标注,需单独评估 verbose trade-off)"。本变更正是评估后的落地:read 概览段带约束(免轮次)+ `schema_data` 工具(advanced)查任意子路径完整约束。

## What Changes

### 1. `describeSchemaNode` 纯函数(结构化约束提取)

- 新增(随 `refactor-module-extraction` 进 `schemaUtils.ts`,或本变更先放):`describeSchemaNode(schema): { type, constraints?, description? }`。
- 从 zod `_def.typeName` 提取:ZodString(min/max/length/regex/email/url)、ZodNumber(min/max/int/positive)、ZodBoolean、ZodEnum(values)、ZodLiteral(value)、ZodArray(item + min/max)、ZodObject(shape 递归)、ZodOptional/Default(解包 + optional/default 标注)。
- 复用 `unwrapSchema`(`dataOps.ts:254`)解包可选/默认/lazy。

### 2. `read` 概览段带约束

- `read` 不传 `jsonPath` 的"格式说明"段(当前 `:806` 只给"格式: 写入值需为 JSON..."),增强为:基于 `describeSchemaNode` 生成每个顶层字段的 `- key (Type)[约束]: description`。
- 子路径 read(传 jsonPath)默认**不带**约束标注(避免值返回噪音);需要约束时用 `schema_data`(下)。
- 不新增 read 参数(概览段天然适合带约束,子路径读值不带)。

### 3. 新增 `schema_data` 工具(advanced)

- `schema_data({ jsonPath? })`:返回指定路径(默认根)的 `describeSchemaNode`(完整约束,含嵌套对象的 shape 递归描述)。归入 advanced(`SIMPLE_HIDDEN`)—— simple 下 LLM 靠 read 概览段已得顶层约束;深入约束时切 advanced。
- `extractSchemaHint`(`presets.ts`,注入 systemPrompt)升级为调 `describeSchemaNode`,使 systemPrompt 的"可操作数据"段也带约束(一次到位,LLM 启动即知约束)。

## Impact

- **改造**:`src/core/tools/dataOps.ts`(`read` 概览段增强)、`src/core/tools/schemaUtils.ts`(或 `dataOps.ts`,新增 `describeSchemaNode`)、新增 `schema_data` 工具(进 advanced `SIMPLE_HIDDEN`)、`src/core/presets.ts`(`extractSchemaHint` 升级)。
- **新增导出**:`describeSchemaNode` 纯函数(顶层导出,供集成方预览约束)。
- **行为变化**:`read` 概览段 + systemPrompt"可操作数据"段内容更丰富(带约束);`schema_data` 新工具(advanced)。LLM 写前知约束,减少试错轮次。向后兼容(信息增强,非破坏)。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(schema 约束可见性)。
- **测试**:selftest 补 `describeSchemaNode` 白盒(各 zod 类型约束提取)+ `schema_data` 工具;e2e `inspect().systemPrompt` 含约束标注。断言计数同步。

## Non-goals

- **不改** 写路径校验逻辑 —— 约束本就由 zod 强制;本变更只让 LLM 提前"看见"约束,不改校验。
- **不给** `read` 子路径读加类型标注 —— 避免 read 返回值噪音(值 + 标注混排 verbose);子路径约束经 `schema_data` 查。
- **不暴露** zod 的完整运行时对象 —— `describeSchemaNode` 是结构化摘要(type + 关键约束),非透传 `_def`(避免内部泄露 + verbose)。
- **不改** `toolMode` 档位 —— `schema_data` 归 advanced(`SIMPLE_HIDDEN`),simple 靠 read 概览段 + systemPrompt 段。
- **不自动** 校正相关 —— 暴露约束让 LLM 一次写对;真写错仍由 schema 校验兜底(返回结构化错误),不改自纠流程。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | `describeSchemaNode` + `extractSchemaHint` 升级 + read 概览段带约束 | 低 | ✅ minor |
| 期二 | `schema_data` 工具(advanced) | 低 | ✅ minor(叠加) |

期一核心(约束可见性主入口:systemPrompt + read 概览),期二补 advanced 深入查询。两期 minor(信息增强)。建议在 `evolve-default-toolset` 之后(SIMPLE_HIDDEN 已定义)。
