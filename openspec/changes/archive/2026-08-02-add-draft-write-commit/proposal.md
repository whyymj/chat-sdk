# Change: add-draft-write-commit (Phase 2)

> 分块构建超大 JSON(`draft_write` 累积 → `draft_commit` 原子提交)。Phase 2 opt-in 高级能力。
> **状态:已实施(2.19)**。旧 proposal `add-data-paging-and-chunked-write` §3 draft 部分(已归档);read 分页/eval 子树已并入 2.17,本 change 只做 draft。

## Why
几百 K JSON(如 50+ 组件页面)逼近 LLM `max_tokens`,单次 `write({value})` 装不下 → LLM 输出截断 / JSON 不完整 / 校验失败。`write` 的 patch/patches 适合小改,但**从零生成大 JSON** 无分块协议。vfs `drafts` 池(2.16 已分,2MB)就绪待用(空池占位)。

## What Changes
1. **`draft_write({draftId, chunk, mode?})`**:mode:`start` 新建/覆盖 / `append` 追加(拼 JSON 片段字符串到 `drafts/{draftId}.json`)。返回 `{draftId, bytes, mode}` 看累计进度
2. **`draft_commit({draftId})`**:读草稿 → `JSON.parse`(失败 `JSON_INVALID`)→ schema 校验(失败 `SCHEMA_INVALID`,草稿保留可修后重试)→ 原子写 bind + 快照(成功清草稿)。**复用 `commitSetToBind` 纯函数**(与 write(set)/set_data 共用校验+快照+乐观锁链)
3. **抽 `commitSetToBind` 纯函数**:把 writeSlot set 分支的 7 步(schema.safeParse→pushSnapshot→safeMerge/restoreInPlace→audit→hash)抽成纯函数,`set_data`/`writeSlot`/`draft_commit` 共用(单一真相源,**零行为变化**)
4. **`capabilities.draftWrite` 默认关**(opt-in;需 dataOps + vfs;toolMode advanced 暴露,simple/minimal 隐藏)

## Impact
- **改造**:`dataOps.ts`(抽 `commitSetToBind` + draft 工具放 `createDataOps` 数组共享闭包 + `DataOpsOptions.vfsStore` + `SIMPLE_HIDDEN` 加 draft)+ `createChatSdk.ts`(capabilities.draftWrite + vfsStore 条件传 dataOps)+ `types/index.d.ts` + `index.ts`(导出 commitSetToBind)+ `usageHints.ts`
- **新增导出**:`commitSetToBind`
- **影响规范**:ADD Requirement(draft 分块写)
- **向后兼容**:`draftWrite` 默认关(不传=现状);`commitSetToBind` 抽取零行为变化(set_data/writeSlot message 略简但功能同,selftest 937 全过验证)
- **测试**:selftest `sec-41`(24 项)+ e2e `inspect.mjs`(draft 反映)+ filterByToolMode 筛选

## 决策(design 要点)
1. **draft 是 JSON 字符串拼接**(非结构化 append):LLM 控制 JSON 结构,灵活;`draft_commit` parse 校验完整 JSON。失败 LLM 重试(草稿保留)
2. **原子性**:draft_commit 在内存 parse + schema 校验(不碰 bind)→ 通过才 `commitSetToBind` 写 bind + 快照。失败 bind 不变,草稿保留
3. **共享 dataOps 闭包**(不放单独工厂):draft_commit 与 write 共享 `snapshots` 栈 + `lastReadHash` → restore_data/乐观锁一致。代价:createDataOps 文件膨胀 ~100 行(可接受,draft 与 dataOps 强相关)
4. **默认关 + advanced 暴露**:`capabilities.draftWrite` 默认关(opt-in);`toolMode: 'advanced'` 暴露(simple/minimal 隐藏)。双控:draftWrite:true + advanced 可见

## Non-goals
- 不做 LLM 自动续写(分块由 LLM 决定,框架只提供 draft_write 原语)
- 不做 draft 跨会话持久化(会话级,刷新清)
- 不替代 write(小改仍用 write/patch;draft 只在大 JSON 从零生成)
