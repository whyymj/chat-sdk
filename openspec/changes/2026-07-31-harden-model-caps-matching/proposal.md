# Change: harden-model-caps-matching

> 配套:本变更加固模型能力表(`MODEL_TABLE`)的匹配策略 —— 当前 first-match + 正则子串,顺序脆弱(未来新模型若名字是旧模型子串,极易匹配错条目,拿到错误的 contextWindow/maxOutputTokens,连锁影响 offload 阈值/压缩触发/maxTokens 缺省)。改为 longest-match + 表驱动断言锁死已知模型。独立小改,与其它 change 无耦合。

## Why

1. **first-match + 子串匹配,顺序敏感**。`modelCaps.ts:64-73` 的 `resolveModelCaps` 用 `MODEL_TABLE.find(e => e.pattern.test(model))`(first-match),pattern 是子串正则。当前条目顺序经精心安排(`gpt-4o-mini` 在 `gpt-4o` 前、`deepseek-v4` 在 `deepseek` 前)暂时正确,但**顺序是隐式契约,无静态保障**。
2. **未来新增模型易踩坑**。若加 `deepseek-v4-mini`(期望匹配某条目),会被先出现的 `/deepseek-v4/i`(1M)吃掉 → 拿到错的 contextWindow。这类 bug 静默(不报错,只拿错能力值),导致 offload 阈值/压缩触发点/maxTokens 缺省全偏,难排查。
3. **无表驱动测试**。当前 selftest 对 `resolveModelCaps` 的覆盖若只测几个模型名,无法捕捉"顺序改动导致匹配偏移"。需要表驱动断言:每个已知模型名必须命中预期条目。

## What Changes

### 1. first-match 改 longest-match

- `resolveModelCaps`(`:64-73`):`find` 改 `filter` 收集所有命中,按 pattern 源字符串长度降序,取最长(最具体)的命中条目。
- 效果:`gpt-4o-mini` 同时命中 `gpt-4o-mini` 与 `gpt-4o`,取前者(更长);顺序无关,新增模型不再受条目排列影响。

### 2. 表驱动断言(测试)

- selftest 新增表驱动用例:对 `MODEL_TABLE` 每条 pattern,构造代表性模型名,断言 `resolveModelCaps` 命中本条目(而非更宽泛的条目)。
- 锁死"已知模型名 → 预期 caps"映射,任何顺序调整 / 新增条目导致的偏移立即失败。

## Impact

- **改造**:`src/core/utils/modelCaps.ts:64-73` `resolveModelCaps` 匹配策略 first-match → longest-match。
- **行为变化**:无(当前顺序下 longest-match 与 first-match 结果一致;longest-match 只是让结果不再依赖顺序)。向后完全兼容。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 1 条 Requirement(模型能力匹配策略)。
- **测试**:selftest 补表驱动 `resolveModelCaps` 断言;断言计数同步。

## Non-goals

- **不引入** 精确版本解析(如 `gpt-4o-2024-xx` 解析为版本号)—— 过度工程,子串 + longest-match 已覆盖主流命名。
- **不改** `MODEL_TABLE` 的条目与 caps 值 —— 本变更只改匹配策略,不改表内容。
- **不暴露** 匹配策略为配置 —— 内部实现细节,集成方经 `contextWindow` / `maxOutputTokens` 显式声明覆盖即可。
- **不加** "未知模型 warn" —— 保守缺省(32K/4K)已是合理兜底,warn 噪音大。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | longest-match + 表驱动断言 | 极低 | ✅ patch |

单期 patch,改动极小(1 个策略调整 + 1 组测试)。
