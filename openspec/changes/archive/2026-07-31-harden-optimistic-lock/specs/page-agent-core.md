# Specification Delta: page-agent-core

> 本文件为 change `harden-optimistic-lock` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 乐观锁 hash 强度与并发语义

主数据乐观锁的 `hashValue` 使用 53-bit 非加密 hash(cyrb53,碰撞空间 2^53,生日碰撞阈值 ~2^26.5),替代此前的 32-bit djb2,大幅降低"不同值 hash 恰好相等 → 误判无冲突 → 静默覆盖外部修改"的概率。hash 返回 base36 字符串,经 `read`/`get_data` 返回给 LLM,LLM 在 `write`/`set`/`edit`/`delete` 时经 `expectedHash` 回传比对(或 `autoLock` 默认用最后 read 的 hash 自动比对)。`expectedHash` 协议与值语义不变(只比对相等,LLM 不解析具体值),算法升级对同会话内 read→write 自洽(闭包变量不持久化、不跨会话,无兼容问题)。

在并发工具(`maxParallelTools > 1`)场景下,`autoLock` 退化为"整体快照语义":同轮多个 `read` 并发写共享的 `lastReadHash`,后续 `write` 比对的是最后完成的 read 的整体 bind hash(不可重现,但语义上仍为整体快照)。文档明确该行为,并建议并发场景下 LLM 显式传 `expectedHash`(取自它自己那次 read 的返回值)以精确控制乐观锁粒度。
