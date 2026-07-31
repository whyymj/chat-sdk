# Tasks: expose-schema-constraints

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。minor(信息增强)。建议 evolve-default-toolset 之后。

## 期一 — describeSchemaNode + extractSchemaHint 升级 + read 概览

- [ ] `schemaUtils.ts`(或 dataOps)新增 `describeSchemaNode` / `renderSchemaHint` / `formatConstraints`(覆盖 string/number/boolean/enum/literal/array/object/optional/default)
- [ ] `src/core/presets.ts:67-81` `extractSchemaHint` 改调 `describeSchemaNode`,输出 `- key (Type)[约束]: desc`
- [ ] `dataOps.ts:806` read 概览段带约束(经 extractSchemaHint / renderSchemaHint);子路径读不带
- [ ] selftest:`describeSchemaNode` 各 zod 类型白盒 + extractSchemaHint 带约束断言

## 期二 — schema_data 工具(advanced)

- [ ] `dataOps.ts` 新增 `schema_data({ jsonPath? })` 工具(返回 `describeSchemaNode` 结构化约束);加入 `SIMPLE_HIDDEN`(只进 advanced)
- [ ] selftest:`schema_data` 工具(根 / 子路径 / 不存在路径)
- [ ] e2e `inspect().systemPrompt` 含类型 + 约束标注

## 期三 — 门禁 + 收口

- [ ] `src/core/index.ts` + `types/index.d.ts`:导出 `describeSchemaNode` / `SchemaNodeDesc`
- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] 断言计数同步
- [ ] `doc/usage-guide.md`:schema 约束可见性说明(read 概览 / systemPrompt / schema_data)+ 集成方写 zod 约束的最佳实践(中英同步)
- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:约束可见性文档 + 断言计数
- [ ] `CHANGELOG.md`:minor 条目
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
