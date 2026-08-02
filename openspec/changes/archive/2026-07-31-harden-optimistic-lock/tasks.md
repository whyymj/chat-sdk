# Tasks: harden-optimistic-lock

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。patch,改 dataOps hash + 注释。

## 期一 — hashValue 换 cyrb53

- [ ] `dataOps.ts` 新增 `cyrb53(str, seed=0): number` 纯函数(53-bit,Math.imul)
- [ ] `dataOps.ts:202-209` `hashValue` 改为 `cyrb53(safeStringify(value)).toString(36)`
- [ ] `dataOps.ts:408` `lastReadHash` 加并发语义注释(整体快照语义 + 建议并发下显式 expectedHash)
- [ ] 可选:`src/core/index.ts` + `types/index.d.ts` 导出 `cyrb53`

## 期二 — 文档化并发语义

- [ ] `doc/usage-guide.md` / `doc/usage-guide.en.md` 补"乐观锁与并发工具"章节(中英同步)
- [ ] `interceptors` / autoLock 相关说明补并发语义提示

## 期三 — 测试 + 门禁

- [ ] selftest:`cyrb53` 白盒(确定性 / 不同输入不同输出);`hashValue`(同值同 hash / 不同值不同 hash / 返回字符串)
- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过(现有乐观锁 e2e 不破坏)
- [ ] 断言计数同步

## 期四 — 收口

- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:断言计数 + hash 算法升级说明
- [ ] `CHANGELOG.md`:patch 条目(hashValue 升级 cyrb53 + 并发语义文档化)
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
