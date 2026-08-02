# Specification Delta: page-agent-core

> 本文件为 change `expose-schema-constraints` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: schema 字段约束对 LLM 可见

系统通过纯函数 `describeSchemaNode(schema)` 结构化提取 zod 字段约束,返回 `{ type, constraints?, optional?, default?, description? }`,覆盖 ZodString(min/max/length/regex/email/url)、ZodNumber(min/max/int/positive)、ZodBoolean、ZodEnum(values)、ZodLiteral(value)、ZodArray(item + min/max,递归)、ZodObject(shape 递归)、ZodOptional/Default(optional/default 标注)。该约束信息经三处消费,使 LLM 在写之前即知字段规则,减少"写错 → 校验失败 → 重试"轮次:① `extractSchemaHint`(注入 systemPrompt「可操作数据」段)升级为带 `key (Type)[约束]: description`;② `read` 不传 `jsonPath` 的概览段同步带约束(子路径读值不带,保返回干净);③ `schema_data({ jsonPath? })` 工具(归入 advanced)返回任意路径的完整结构化约束(含嵌套 shape 递归)。simple 模式下 LLM 经 read 概览 + systemPrompt 段获得顶层约束;深入嵌套约束切 advanced 用 `schema_data`。写路径校验逻辑不变(zod 仍强制校验),本变更仅让约束提前可见。
