# Tasks: unify-context-compression

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。patch(内部重构,行为不变)。建议在 `refactor-module-extraction` 之后。

## 期一 — 抽共享协议 + trim 改调

- [ ] `src/core/utils/rounds.ts` 新增 `SummarySegment` 类型 + `mergeSummarySegments` / `parseSummarySegment` / `renderSummarySegment` 纯函数
- [ ] `trimMemoryMessagesImpl`(:82-124)改调共享函数(替代 :93-116 手写 prevSummary 提取 + 并入)
- [ ] 确认 `MEMORY_SUMMARY_PREFIX` 导出供两套共用
- [ ] selftest:`mergeSummarySegments` / parse / render 白盒 + 现有 trim 断言不破坏

## 期二 — summarization 改调共享函数

- [ ] `useContextManager.ts` / `summarization.ts` 的"头部旧摘要合并"逻辑改调 `mergeSummarySegments`
- [ ] summarization 产出的摘要段统一用 `MEMORY_SUMMARY_PREFIX` 标记(若原为裸 SystemMessage)
- [ ] 验证 `groupRounds` 对统一标记的识别(头部摘要不进 round)
- [ ] e2e 压缩相关不破坏

## 期三 — 门禁 + 收口

- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] 断言计数同步
- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:断言计数 + 双摘要统一协议说明
- [ ] `CHANGELOG.md`:patch 条目(内部重构,行为不变)
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
