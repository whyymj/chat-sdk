# Specification Delta: page-agent-core

> 修正 change `expose-schema-constraints` 合入的"字段约束可见性"Requirement(read 概览去约束,去重复)。

## Requirement: 字段约束可见性(修正:read 概览不带约束,只 systemPrompt + schema_data)

系统通过纯函数 `describeSchemaNode(schema)` 结构化提取 zod 字段约束(返回 `{ type, constraints?, optional?, nullable?, default?, description? }`),针对 zod 4 `_def.type` 判别 + `check._zod.def` 提取 check 真值(adapter 集中,未来 zod5/别的库扩展于此,接口与消费不变)。约束经**两处**消费(非三处,去 read 概览重复):① `extractSchemaHint` 注入 systemPrompt「可操作数据」段(每轮在,带 `key (Type)[约束]: description`);② `schema_data({ jsonPath? })` 工具(advanced)查任意路径完整约束(含嵌套 shape 递归)。

`read` 不传 jsonPath 的概览段**不带约束**(恢复"说明+格式"短段),避免与 systemPrompt 重复注入冗余 token;约束提取(`describeSchemaNode`)与消费解耦,`renderSchemaOverview` 纯函数保留供未来扩展(如 read 子路径带约束 / 概览可选约束开关)。

**zod 版本防御**(adapter 健壮性):`describeSchemaNode` 顶部声明依赖 zod 4.4+;结构探测失败(schema 无 `_zod`/`_def`)→ 返 `{type}` 无约束(降级不崩);dev 模式 console.warn(去重)提醒版本不兼容,生产静默。

写路径校验不变(zod 仍强制)。
