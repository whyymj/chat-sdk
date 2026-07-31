# Specification Delta: page-agent-core

> 本文件为 change `evolve-default-toolset` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: simple 工具集构成(精简低价值工具 + 补只读历史入口)

`toolMode: 'simple'`(默认)下,数据工具集为:`read` / `write` / `query_data` / `search_data` / `eval_script` / `restore_data` / `history_data`(共 7 个)。`snapshot_data`(手动命名快照)与 `list_data_snapshots`(快照列表元信息)从 simple 移除(归入 `advanced`),理由:自动快照(`write`/`set`/`edit`/`delete` 自动入栈)+ `restore_data`(回退)+ `history_data`(只读查看)已覆盖其使用场景,手动命名快照在 simple 场景低价值,移除以降低 LLM 工具选择负担。`advanced` 模式仍暴露全部工具(向后兼容);`minimal`(只 read/write)不受影响。

## Requirement: history_data 只读查看快照(非破坏性历史访问)

系统提供 `history_data({ id?, jsonPath? })` 工具(归入 simple 工具集):返回指定快照(默认最近一次)的内容;可选 `jsonPath` 返回该子路径(经 schema 白名单投影)。该工具**只读,不修改当前主数据**(不调用写回 / 不入快照栈),填补 `list_data_snapshots`(仅元信息,不可见值)与 `restore_data`(破坏性回退)之间的空档,使 LLM 能在不动当前态的前提下查看历史快照(用于冲突诊断、自纠核对、用户问"刚才改了啥")。空快照返回 `NO_SNAPSHOT`、指定 id 不存在返回 `SNAPSHOT_NOT_FOUND`。

## Requirement: read 支持多路径 / write 支持 dryRun 预检

`read` schema 新增 optional `jsonPaths: string[]`(与 `jsonPath` 互斥):一次读取多个不相关子路径,返回 `[{ path, value }]`(各自经 schema 投影 + 整体 hash);某条路径非法(不在白名单)时该项标记 error,其余路径正常返回(不整批失败)。单 `jsonPath` 行为不变(向后兼容)。

`write` schema 新增 optional `dryRun: boolean`:为 true 时走完整校验链(schema `safeParse` + 白名单 + patch 应用到 clone),但**不落盘、不入快照、不写 bind**,返回 `{ ok, preview, errors? }`(preview 为应用后的预览值)。四意图(value / patch / patches / del)均支持;乐观锁冲突在 dryRun 下照常检测并返回冲突信息(不挂起人工介入)。用于复杂改动的写前预检,减少"写错→校验失败→重试"轮次。

## Requirement: diff_data 差异对比(advanced)

系统提供 `diff_data({ snapshotId?, against? })` 工具(归入 advanced 工具集,不进 simple):对比"当前主数据"与"指定快照(`snapshotId`)或一段 JSON(`against`)",返回结构化 `{ path, from, to }[]`。差异算法:对象按 key 并集递归、数组按下标递归(不按值匹配,保持简单可预测)、叶子或类型不同记差异;由纯函数 `diffObjects` 实现(从顶层导出,可供集成方与测试复用)。用于 verify 自纠、冲突诊断、操作审计,替代 LLM 自行 read 两次心算对比。
