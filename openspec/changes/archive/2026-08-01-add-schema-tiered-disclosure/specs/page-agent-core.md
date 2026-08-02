# Specification Delta: page-agent-core

> add-schema-tiered-disclosure(Phase 1):大 schema 分层披露。

## Requirement: 字段约束可见性 —— 大 schema 分层披露(顶层概览 + 深层按需)

字段约束经纯函数 `describeSchemaNode(schema)` 结构化提取(zod 4 `_def`/`_zod.def`,2.17 expose-schema)。`extractSchemaHint` 注入 systemPrompt「可操作数据」段时,**按 schema 体积分层**:

- **小 schema**(顶层 key 数 ≤ `maxKeys` 默认 15 **且** 渲染字符 ≤ `maxChars` 默认 4000):**全量**注入(`key (Type)[约束]: desc`,带 min/max/enum 约束 + 嵌套 shape,2.17 现状)。
- **大 schema**(超阈值):**分层** —— 只渲染**顶层概览**(`key (Type): 一句描述`,不带约束细节、不递归嵌套)+ 尾部提示「深层约束/嵌套 shape 用 `schema_data({jsonPath})` 查(advanced);或 read 子路径见实际值」。

阈值可配(`schemaHint: { maxKeys?, maxChars? }`;极大值退化为全量,向后兼容)。`schema_data({jsonPath?})` 工具(advanced,2.17)查任意路径完整约束(含嵌套递归),供 LLM 改深层字段前按需查。`read` 概览不带约束(2.17 refine 现状)。simple 模式大 schema 靠顶层概览 + read 子路径见值 + write 校验反馈;集成方需精细深层约束切 `toolMode:'advanced'`。

分层自动触发(默认核心开),小 schema 无感(全量不变);大 schema(如 50+ 组件)systemPrompt 体积降一个数量级。
