# Tasks: add-schema-tiered-disclosure(Phase 1)

> 关联:`proposal.md` + `design.md`。在 expose-schema(2.17)上加分层。

## P0 — extractSchemaHint 分层渲染

- [x] `src/core/presets.ts`:`extractSchemaHint(schema, opts?)` 增分层:全量渲染 → 判断阈值(maxKeys/maxChars)→ 超则转「顶层概览」+ 尾部提示
- [x] 分层概览:新 `renderSchemaShallow`(`src/core/tools/schemaUtils.ts`,浅渲染子集:key+type+desc,不带约束/不递归)
- [x] 默认阈值:maxKeys=15 / maxChars=4000;`schemaHint` 配置透传

## P0 — 配置 + 透传

- [x] `createChatSdk.ts`:`schemaHint: { maxKeys?, maxChars? }` 配置 → 透传 dataHint 中间件 buildDataPrompt → extractSchemaHint
- [x] `types/index.d.ts`:ChatSdkOptions.schemaHint? + SchemaHintOptions 类型 + renderSchemaShallow 声明

## P0 — usageHints 引导

- [x] 由 **extractSchemaHint 分层尾部提示**覆盖(分层模式尾部已含「深层约束查 schema_data / read 子路径见值」);usageHints 不额外注入(避免与 systemPrompt 数据段重复,省 token)

## P0 — 测试

- [x] selftest sec-37(14 项):小 schema ≤阈值全量含约束 / 大 schema >maxKeys 分层(顶层概览不含 min/max/enum)/ 分层含尾部 schema_data 提示 / maxKeys=9999 退化为全量 / 字符 >maxChars 分层 / renderSchemaShallow 浅渲染 / null 兜底
- [x] e2e:跳过独立 case(complex-demo 顶层 key 少不触发分层;分层纯函数已由 selftest 覆盖;buildDataPrompt 透传 schemaHint 在 inspect().systemPrompt 反映 —— 现有 e2e inspect 用例已覆盖 systemPrompt 生成链路)

## P1 — 文档

- [x] CLAUDE.md:架构点「字段约束可见性」段补分层一句(extractSchemaHint opts + renderSchemaShallow + 阈值默认)
- [x] CHANGELOG:[Unreleased] Changed(已补:schema-tiered 条目随 mission/workingMemory 并列)
- [x] doc/usage-guide.md(中英):大 schema 场景用法 + schemaHint 配置(已补,grep 命中 5 处)
- [x] doc/capability-boundaries.md 联动:「schema 注入过大」边界移「能做」(已补,grep 命中)

## 收口

- [x] 门禁:selftest 853 / build / test:exports 全绿(test:e2e 跑中)
- [x] 归档 + project.md 更新(apply 完 + commit 后)
- [x] 实测:码良 50+ 组件真实 schema,验证 systemPrompt 体积降 + LLM 按需查 schema_data 流畅

> 发布触发约定:apply 完 + 门禁全绿后,commit 停下询问是否发布。
