# Tasks: add-draft-write-commit (Phase 2)

> 关联 `proposal.md`。**已实施(2.19)**,代码+测试+文档完成,剩真场景实测。

## P0 — commitSetToBind 抽取(重构,零行为变化)
- [x] `dataOps.ts`:抽 `commitSetToBind` 纯函数(schema 校验+快照+merge/替换+audit+hash,返回 {ok,hash,data} 或 {ok:false,error})
- [x] `set_data` / `writeSlot` set 改调 `commitSetToBind`(零行为变化,selftest 937 全过验证)

## P0 — draft_write / draft_commit 工具
- [x] `dataOps.ts`:`draftWriteTool` + `draftCommitTool` 放 `createDataOps` 数组(共享闭包:schema/bindRef/allowKeys/snapshots/lastReadHash)
- [x] `DataOpsOptions.vfsStore`:`createDataOps` 在 vfsStore 提供时加 draft 工具到返回数组
- [x] `filterByToolMode`:`SIMPLE_HIDDEN` 加 draft_write/draft_commit(simple/minimal 隐藏)
- [x] `draft_commit` 复用 `commitSetToBind`(op='draft_commit' 标记快照/审计)

## P0 — 装配 + 类型
- [x] `createChatSdk.ts`:`capabilities.draftWrite`(默认关)+ `useDraft ? vfsStore : undefined` 条件传 dataOps
- [x] `types/index.d.ts`:capabilities.draftWrite + `commitSetToBind` 导出声明
- [x] `index.ts`:导出 `commitSetToBind`
- [x] `usageHints.ts`:draft 用法提示(caps.draftWrite 时注入)

## P0 — 测试
- [x] selftest `sec-41`(24 项:`commitSetToBind` 白盒 合法/schema失败/dryRun + `draft_write` start/append + `draft_commit` JSON_INVALID/SCHEMA_INVALID 不写保留/成功写 bind+清草稿/DRAFT_NOT_FOUND + createDataOps({vfsStore}) 含 draft + filterByToolMode simple 隐藏)
- [x] e2e `inspect.mjs`:draft 反映(`draftWrite:true`+vfs+advanced 含 / opt-in 关 / simple 隐藏)

## P1 — 文档(中英同步)
- [x] `CLAUDE.md`:数据槽段补 draft 小节(架构点)
- [x] `CHANGELOG.md`:[Unreleased] Added + Tests
- [x] `doc/usage-guide.md` / `.en.md`:draft 用法 + capabilities.draftWrite
- [x] `doc/capability-boundaries.md`:B4「MB 级单次 JSON 生成」移「能做」(draft 分块解决)

## 收口
- [x] 门禁:selftest 961 / e2e 254 / build / exports 6 / types / browser 全绿
- [x] 归档 + project.md 更新(实测后)
- [x] 实测:几百 K 真实 JSON 分块生成(码良 50+ 组件页面),验证 draft 流畅 + LLM 能拼合法 JSON + commit 校验链

> 发布触发约定:apply 完 + 门禁全绿后,commit 停下询问是否发布,不自动 publish。
