# Tasks: refine-dataops-reachability

> 状态:**待实施**。关联:本目录 `proposal.md`。三件精修:read 概览去约束 / usageHints 补提示 / zod 防御。

## 2.1 read 概览去约束

- [ ] `src/core/tools/dataOps.ts` `read` 概览段(`!jsonPath` 的 desc)去掉 `renderSchemaOverview`,恢复"主数据说明 + 格式提示"短段(约束靠 systemPrompt + schema_data)
- [ ] selftest `sec-31`:read 概览断言更新(去"可操作字段"约束,只保留说明+格式);read 子路径断言不变

## 2.2 usageHints 补分页/多路径/dryRun

- [ ] `src/core/harness/usageHints.ts` simple 段补:① 分页(读大数组 hasMore=true 用 offset/limit 翻页);② 多路径(jsonPaths 一次读多路径);③ dryRun(write 复杂 patches 先 dryRun:true 预检)
- [ ] advanced 段补同三条(措辞适配 advanced 的 get/set 语境,分页用 get_data、dryRun 用 set/edit)
- [ ] design 注释补扩展规约(新能力提示在对应分支 push 一行)
- [ ] selftest `sec-19`:usageHints augmentPrompt 含"分页/offset"断言(simple + advanced)

## 2.3 describeSchemaNode zod 防御

- [ ] `src/core/tools/schemaUtils.ts` `describeSchemaNode` 顶部注释:zod 4.4+ adapter 声明 + 兜底行为(无 _zod/_def 返 type-only)+ 未来 zod5/别的库扩展于此
- [ ] dev 模式 console.warn(去重):结构探测失败(schema 无 _zod 且无 _def)时提醒"zod 版本可能不兼容,约束降级 type-only"(用模块级 Set 去重,只 warn 一次/进程)
- [ ] selftest `sec-31`:zod 兜底断言(describeSchemaNode 对非 zod 对象返 type-only 不崩;可选:mock 无 _zod 触发 warn 但难测,只测返值)

## 收口

- [ ] `openspec/specs/page-agent-core.md`:修正"字段约束可见性"Requirement(read 概览不带约束)
- [ ] 门禁:`npm test` + `npm run build` + `npm run test:e2e` + `npm run test:types` + `npm run test:exports` + `npm run test:size` 全过
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问,不自动 publish。
