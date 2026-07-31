# Tasks: harden-react-loop-budget

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。patch,改 createAgent 循环骨架。

## 期一 — rounds/iterations 双计数

- [ ] `createAgent.ts` options(:63-98)加 `maxIterations?: number`
- [ ] 抽纯函数 `computeMaxIterations(maxToolRounds, maxIterations?): number`(规则 `Math.max(maxToolRounds*3, 30)`,显式覆盖)
- [ ] `stream()` 循环(:383-475):
  - [ ] 新增 `let iterations = 0`;while 条件加 `&& iterations < maxIterations`
  - [ ] 循环体首行 `iterations++`
  - [ ] 格式自纠路径(:426)移除 `rounds += 1`(保留 `formatRetries += 1; continue`)
  - [ ] verify 自纠路径(:438)移除 `rounds += 1`(保留 `state.verifyAttempts += 1; continue`)
  - [ ] 工具执行后(:474)`rounds++` 保留(唯一自增点)
- [ ] 确认 `round_start` 事件仍发(基于 rounds 或 iterations,选合理口径)

## 期二 — wrap-up 兜底文案

- [ ] `createAgent.ts:512` 文案改为进展引导(基于已完成工具结果,不给用户"简化"责任)
- [ ] 确认 `lastFinalContent`(:482)/ ToolMessage 收口(:489)优先返回逻辑不变

## 期三 — 测试 + 门禁

- [ ] selftest:`computeMaxIterations` 白盒(4 分支:默认/小 maxToolRounds/大/显式覆盖)
- [ ] selftest:mock LLM 验证自纠不增 rounds、iterations 递增、触顶强制退出
- [ ] `npm run test:types` + `npm test` + `npm run build && npm run test:e2e` 全过
- [ ] 排查 e2e 是否有固定轮次硬编码断言(预计无)
- [ ] 断言计数同步

## 期四 — 收口

- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:`maxToolRounds` 语义说明(只计工具轮)+ 断言计数
- [ ] `CHANGELOG.md`:patch 条目
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
