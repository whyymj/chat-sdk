# Tasks: fix-dataops-write-correctness

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。
> 顺序:期一(数组 splice,影响面广改动局部)→ 期二(白名单严格,两处删写回)→ 期三(测试 + 门禁)→ 期四(文档/归档)。
> 建议 期一+期二 同 commit(同文件同测试模块)。两期都属 patch。

## 期一 — 数组子项删除改 splice

- [ ] `src/core/tools/dataOps.ts:115-127` `deleteByPath`:新增数组分支 —— `if (Array.isArray(cur) && /^\d+$/.test(last)) cur.splice(Number(last), 1); else delete cur[last]`
- [ ] 确认四条入口(`delete_data:591` / `write del:864` / `edit remove` 经 `applyPatchToLive:350` / `eval patches remove` 经 `applyPatchToClone:327`)均走修改后的 `deleteByPath`,无需逐个改
- [ ] 自测:对象属性删除仍走 delete(语义不变)

## 期二 — 严格白名单(删未声明字段写回)

- [ ] `src/core/tools/dataOps.ts:506-512` `set_data`:删除"从 parsed 取不在 allowKeys 的字段写回 bind"整段(保留 `safeMerge` / `restoreInPlace` 分支)
- [ ] `src/core/tools/dataOps.ts:924-930` `write` set 分支:删除同样的写回块
- [ ] 确认 `interceptors.write` 仍可在 write 入口拦截/转换/拒绝(契约不变,只是不能绕白名单塞字段)

## 期三 — 测试同步 + 门禁

### 3.1 selftest 白盒

- [ ] 在 dataOps 对应测试模块(`sec-02.ts` 或相邻)补:
  - `set_data` / `write(set)` 传含未声明字段 value → bind 不含该字段(被挡)
  - schema 声明字段正常写入不受影响
  - `deleteByPath` 数组:删 `components.0` → length 减 1、无 empty 槽、元素前移
  - 四入口(`delete_data` / `write del` / `edit remove` / `eval patches remove`)数组删除均 length 递减
  - 对象属性删除语义不变(走 delete)
  - schema `.min(n)` 时删过头被 `safeParse` 拦(期望行为)
- [ ] 更新断言计数

### 3.2 e2e

- [ ] `tests/e2e/data-slots.mjs`:补"数组主数据删除子项 length 递减、无空位"断言
- [ ] 更新断言计数

### 3.3 门禁

- [ ] `npm run test:types` 全过
- [ ] `npm test` 全过
- [ ] `npm run build && npm run test:e2e` 全过
- [ ] `npm run test:exports` 全过
- [ ] `npm run test:size` 全过

## 期四 — 收口(文档 / 归档)

- [ ] `README.md` / `README.zh-CN.md`:断言计数同步 + 行为变化说明(数组删除语义修正 / 白名单收紧)
- [ ] `CLAUDE.md`:测试矩阵 + 断言计数同步
- [ ] `CHANGELOG.md`:新增 patch 版本条目(数组删除 splice 修正 + 白名单严格化)
- [ ] `openspec/specs/page-agent-core.md`:合入 2 条 Requirement
- [ ] change 目录移入 `openspec/changes/archive/`
- [ ] `openspec/project.md`:更新「最近完成的 change」

> 发布触发约定:按 CLAUDE.md,commit 后停下询问用户是否发布,不自动 publish。
