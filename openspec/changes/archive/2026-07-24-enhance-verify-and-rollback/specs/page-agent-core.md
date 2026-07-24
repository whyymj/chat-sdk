# Specification Delta: page-agent-core

> 本文件为 change `enhance-verify-and-rollback` 对 `openspec/specs/page-agent-core.md` 的**增量/修订 Requirement**。实现完成归档时合入主 specs(修订「对抗式验证(可选)」条)。

## Requirement: 对抗式验证子 agent 配只读工具(修订:实证审查)

(revises「对抗式验证(可选)」:对抗子 agent 从「无工具纯文本审查」改为「配备只读工具实证审查」。)

`verify.adversarial: true` 时,verify 中间件在 check 通过后 spawn 的「找茬」子 agent **配备只读工具**(读 window 的 `get_window_prop`/`get_window_paths`/`list_window_props`/`describe_window_prop` + `fetch_document`,复用子 agent 只读白名单筛选)与多轮工具调用预算(`maxToolRounds` 提升至 4),使其能**实证读回**被改属性检查,而非纯文本臆测。审查聚焦 window 修改的典型错误:属性路径是否正确、值类型是否符合 schema、语义是否符合属性 description。无只读工具可装时(如 `capabilities.windowOps:false`)退化为文本审查。默认关闭(token 成本),`createPageAgent` 透传主 `llm` 与筛选后的只读工具构造子 agent。
