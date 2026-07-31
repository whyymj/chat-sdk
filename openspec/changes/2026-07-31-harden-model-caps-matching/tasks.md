# Tasks: harden-model-caps-matching

> 状态:**待实施**。关联:本目录 `proposal.md` / `design.md`。单期 patch,改 modelCaps 匹配策略。

## 期一 — longest-match + 表驱动断言

- [ ] `src/core/utils/modelCaps.ts:64-73` `resolveModelCaps`:`find` 改 `filter` + 按 `pattern.source.length` 降序取首
- [ ] 确认当前所有条目 longest-match 结果与原 first-match 一致(无回归)
- [ ] selftest:表驱动 `resolveModelCaps` 断言(deepseek-v4 / deepseek-chat / gpt-4o-mini / glm-4.6 / qwen2.5-1m / 未知模型 缺省)
- [ ] selftest:显式声明覆盖优先(`resolveModelCaps({model:'x', contextWindow:999}).contextWindow === 999`)
- [ ] `npm run test:types` + `npm test` 全过
- [ ] 断言计数同步

## 期二 — 收口

- [ ] `README.md` / `README.zh-CN.md` / `CLAUDE.md`:断言计数 + 模型匹配策略说明(longest-match)
- [ ] `CHANGELOG.md`:patch 条目
- [ ] `openspec/specs/page-agent-core.md`:合入 Requirement
- [ ] 归档 + `openspec/project.md` 更新

> 发布触发约定:commit 后停下询问用户是否发布,不自动 publish。
