# Specification Delta: page-agent-core

> 本文件为 change `harden-model-caps-matching` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 模型能力表匹配策略(longest-match,顺序无关)

`resolveModelCaps` 对内置 `MODEL_TABLE` 的匹配采用 **longest-match** 策略:收集所有 pattern 命中当前模型名的条目,取正则源字符串(`pattern.source`)最长(最具体)的命中条目,而非依赖 `MODEL_TABLE` 的数组顺序(first-match)。该策略使匹配结果与条目排列无关,新增模型条目不会因位置不当被更宽泛的旧条目抢先匹配(如 `gpt-4o-mini` 命中 `gpt-4o-mini` 与 `gpt-4o`,稳定取前者)。匹配能力来源优先级不变:集成方显式声明(`contextWindow` / `maxOutputTokens`)> 表匹配 > 保守缺省(32K / 4K)。已知模型名 → 预期 caps 的映射由表驱动断言锁死,作为回归契约。
