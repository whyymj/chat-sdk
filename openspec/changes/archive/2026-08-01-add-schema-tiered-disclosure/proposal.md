# Change: add-schema-tiered-disclosure(Phase 1)

> 🆕 新 change(`complex-agent-roadmap` Phase 1)。50+ 组件深嵌套 schema 全量注入 systemPrompt 撑爆上下文 → **分层披露**(顶层概览注入,深层约束按需 `schema_data` 查)。默认「**分层默认核心开**」。
> 在 `expose-schema-constraints`(2.17)之上加分层;`schema_data` 工具已有(advanced)。

## Why

1. **50+ 组件 schema 全量注入体积爆**:`extractSchemaHint` 全量渲染「可操作数据」段(每组件多字段 × 50+,带 min/max/enum 约束 + 嵌套 shape),systemPrompt 可达几十 K,**占/挤上下文**(码良场景实测会显著挤压 LLM 可用窗口)。
2. **LLM 认知负担**:大段约束描述,LLM 注意力分散在无关组件的字段细节上(本轮只改 1 个组件,却看到全部 50+ 的约束)。
3. **现状缺口**:expose-schema(2.17)全量注入 + `schema_data` 工具(advanced 按需查)已就绪,但 **systemPrompt 仍全量** —— 大 schema 场景没有「概览 + 按需」的分层机制。

## What Changes

1. **`extractSchemaHint` 分层渲染**:大 schema 触发时只渲染**顶层概览**(key + type + 一句话描述,**不带** min/max/enum 约束细节、**不递归**嵌套 shape)
2. **触发阈值**:顶层 key 数 > 阈值(默认 15)或渲染字符 > 阈值(默认 4000)→ 自动转分层;小 schema(≤阈值)仍全量(现状不变)
3. **尾部提示**:分层模式尾部加「深层约束/嵌套 shape 用 `schema_data({jsonPath})` 查(advanced);或 read 子路径见实际值」
4. **`usageHints` 引导**:大 schema 场景提示「改某组件深层字段前先 `schema_data({jsonPath})` 查约束」
5. **阈值可配**:`schemaHint: { maxKeys?, maxChars? }`(集成方调)
6. **默认核心开**(分层是自动的,小 schema 无感)

## Impact

- **改造**:`src/core/presets.ts`(`extractSchemaHint` / `renderSchemaOverview` 分层逻辑)+ `usageHints.ts`(大 schema 引导)+ `createChatSdk.ts`(schemaHint 配置)
- **新增**:分层渲染逻辑 + schemaHint 配置项
- **影响规范**:MODIFY「字段约束可见性」(分层:大 schema 顶层概览 + 深层按需)
- **向后兼容**:小 schema(≤阈值)全量(现状);大 schema 自动分层(体积降);`schema_data` 工具不变
- **测试**:selftest(分层触发/顶层概览不含深层约束/小schema全量/阈值可配)+ e2e(大 schema inspect systemPrompt 体积降 + 含提示)

## Non-goals

- **不改** `schema_data` 工具(已有,强化 usageHints 提示即可)
- **不改** `read` 概览(不带约束,现状)
- **不做** schema 版本/动态(静态 schema)
- **不做** simple 模式下的深层约束查询(simple 无 schema_data;靠 read 见值 + schema 校验反馈;集成方需精细深层约束切 advanced)
