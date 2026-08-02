# Tasks: followup-from-live-llm-audit

> 状态:**待实施**(按优先级,非阻塞发布)。关联:本目录 `proposal.md`。真 LLM 审计发现的问题/建议。

## P0 — browser test 全跑 flaky 诊断 + 修

- [ ] 诊断:`npx playwright test tests/browser --retries=1` 看失败是否重试过;跑全 2-3 次看 flaky 率
- [ ] 查 `waitForAgentIdle` timeout（`tests/browser/_helpers.ts`,默认 30s）是否不够（全跑 dev server 负载时偶超时）;必要时加 timeout 或改等更稳的完成信号
- [ ] 查 spec 间 storage 隔离:page-demo spec 与 error-recovery spec 同用 `/`(page-demo demo,id `page-demo`)→ storage indexed 命名空间共享。修:error-recovery spec beforeEach 清 indexedDB(或用独立 demo/id)
- [ ] 通用:`_helpers.ts` 加 `clearStorage(page)`(eval delete indexedDB + 清 cookies),各 spec beforeEach 调,防跨 spec 污染
- [ ] 跑全 browser 3 次稳定全绿

## P1 — usageHints 补 diff_data / history_data 提示

- [ ] `src/core/harness/usageHints.ts`:simple/advanced 段补「对比快照差异用 `diff_data({snapshotId?,against?})` 得结构化 path→from/to;查历史快照值用 `history_data({id?,jsonPath?})`」(延续 refine push 一行可扩展)
- [ ] selftest sec-19:usageHints augmentPrompt 含 diff_data/history_data 断言

## P1 — offset 翻页 browser CI 用例

- [ ] `tests/browser/page-demo.spec.ts`(或 complex)加:bind 初始 60 元素数组(mock LLM 第 1 轮 read offset=0/limit=50 → hasMore=true → 第 2 轮 read offset=50 → hasMore=false)→ 断言翻页推进 + 末页
- [ ] 跑通

## P1 — rag-demo.spec.ts(D 真测固化)

- [ ] 读 `examples/rag-demo/App.vue` 了解 memory 异步 + skill 配置
- [ ] 场景1:mock memory 注入 → 断言 `inspect().systemPrompt` 含 memory 内容(memory 异步求值后)
- [ ] 场景2:mock LLM 调 `load_skill` → 断言加载全文(首次全文 + 重复加载提示)
- [ ] 跑通

## P2 — planner-demo systemPrompt 改进

- [ ] `examples/planner-demo/App.vue`:systemPrompt 加「收到 planner 方案后必须调 write 落地一套,不要只描述方案」
- [ ] (可选)browser 手动验证真 LLM 落地

## 收口

- [ ] 门禁:`npm test` + `npm run build` + `npm run test:e2e` + `npx playwright test tests/browser`(连跑 3 次稳)全过
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问,不自动 publish。
