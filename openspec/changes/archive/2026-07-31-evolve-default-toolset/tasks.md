# Tasks: evolve-default-toolset

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。
> 顺序:期一(精简 + history_data 配套,核心)→ 期二(read 多路径 + write dryRun)→ 期三(diff_data)。三期都属 minor,向后兼容。建议在 `fix-dataops-write-correctness` 之后(同文件,先修 bug 再演进)。

## 期一 — 精简 simple + history_data 补缺(核心,配套必同)

### 1.1 精简:snapshot_data / list_data_snapshots 移 advanced

- [ ] `src/core/tools/dataOps.ts:390` `SIMPLE_HIDDEN` 加入 `'snapshot_data'` + `'list_data_snapshots'`(diff_data 在期三加入)
- [ ] 确认 advanced / minimal 不受影响

### 1.2 新增 history_data(进 simple)

- [ ] `src/core/tools/dataOps.ts` 新增 `history_data({ id?, jsonPath? })` 工具:默认最近快照;可选 jsonPath 子路径(经 `isPathAllowed` + `getSchemaAtPath` + `projectBySchemaDeep` 投影);**只读不调 restoreLive**
- [ ] 空快照 / id 不存在 → `NO_SNAPSHOT` / `SNAPSHOT_NOT_FOUND` 错误码
- [ ] 加入 createDataOps 工具数组(不进 SIMPLE_HIDDEN → 默认进 simple)

### 1.3 测试(期一)

- [ ] selftest:`filterByToolMode('simple')` 不含 snapshot_data/list_data_snapshots、含 history_data;`history_data` 只读(查快照值且 bind 不变);id 不存在报错
- [ ] e2e `inspect.mjs`:simple 工具集构成断言(不含 2 个移走的、含 history_data)

## 期二 — read 多路径 + write dryRun(叠加期一)

### 2.1 read 多路径

- [ ] `dataOps.ts` `read` schema 加 `jsonPaths: z.array(z.string()).optional()`(与 jsonPath 互斥)
- [ ] 实现:jsonPaths 给定 → 逐路径 `getByPath` + 投影,返回 `[{path, value}]`(+ 整体 hash);非法路径单项标 error,不整批失败
- [ ] 单 jsonPath 行为不变

### 2.2 write dryRun

- [ ] `dataOps.ts` `write` schema 加 `dryRun: z.boolean().optional()`
- [ ] 实现:四意图(value/patch/patches/del)走完整校验链(schema + 白名单 + patch 应用到 clone),dryRun=true 时不 `pushSnapshot` / 不 `applyPatchToLive` / 不写 bind,返回 `{ok, preview, errors?}`
- [ ] dryRun 下乐观锁照常比对(dryRun 命中冲突返回信息,不调 onConflict 挂起)

### 2.3 测试(期二)

- [ ] selftest:`read` 多路径返回结构 + 非法路径单项 error;`write` dryRun ok 且 bind 未变、校验失败 bind 未变、dryRun ok 的改动去掉 dryRun 必成功
- [ ] 断言计数同步

## 期三 — diff_data(advanced 新增,叠加期二)

### 3.1 diffObjects 纯函数 + diff_data 工具

- [ ] `dataOps.ts` 新增 `diffObjects(a, b, prefix?): {path, from, to}[]` 纯函数(对象/数组递归按下标、叶子差异)
- [ ] 新增 `diff_data({ snapshotId?, against? })` 工具:对比当前 bind 与指定快照/JSON,返回 diff;加入 `SIMPLE_HIDDEN` → 只进 advanced
- [ ] 结果超阈值经 offload 兜底

### 3.2 导出 + 测试(期三)

- [ ] `src/core/index.ts` + `types/index.d.ts`:导出 `diffObjects` 纯函数
- [ ] selftest:`diffObjects` 纯函数白盒(对象/数组/叶子/类型不同);`diff_data` 工具对比快照 + against JSON
- [ ] e2e `inspect.mjs`:advanced 含 diff_data、simple 不含
- [ ] 断言计数同步

## 期四 — 门禁 + 收口

### 4.1 门禁

- [ ] `npm run test:types` 全过
- [ ] `npm test` 全过
- [ ] `npm run build && npm run test:e2e` 全过
- [ ] `npm run test:exports` 全过(`diffObjects` 导出对齐)
- [ ] `npm run test:size` 全过

### 4.2 文档 + 归档

- [ ] `README.md` / `README.zh-CN.md`:simple 工具集变化(去 snapshot/list、增 history)+ read 多路径 / write dryRun / diff_data 用法(中英同步)
- [ ] `CLAUDE.md`:目录结构(diffObjects)+ 测试矩阵 + 断言计数
- [ ] `doc/usage-guide.md`:工具集演进说明 + dryRun/多路径/diff 示例
- [ ] `CHANGELOG.md`:新增 minor 版本条目(默认工具集优化)
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement(simple 工具集构成 / history_data 只读快照 / read 多路径 + write dryRun / diff_data)
- [ ] change 目录移入 `openspec/changes/archive/`
- [ ] `openspec/project.md`:更新「最近完成的 change」

> 发布触发约定:按 CLAUDE.md,commit 后停下询问用户是否发布,不自动 publish。
