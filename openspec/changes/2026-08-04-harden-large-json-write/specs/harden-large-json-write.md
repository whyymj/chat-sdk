# Specification Delta: page-agent-core

> 本文件为 change `harden-large-json-write` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 大 JSON 写入链路加固(harden-large-json-write)

系统对大 JSON 写入链路(增量 patch / 批量 patches / 分块 draft_write-commit)加固安全性、成本与鲁棒性,并补齐能力。全增量,默认零行为变化。

- **draft_commit 乐观锁**:`draft_commit` 写前经 `handleConflict` 检测(支持显式 `expectedHash`,缺省 autoLock 用最后 read 的 hash);冲突触发人工介入/返回 VERSION_CONFLICT,**不得静默覆盖**。与 set/edit/delete/write 一致。
- **快照字节上限**:`maxSnapshotBytes`(默认 2MB)与 `maxSnapshots`(数量)双上限;pushSnapshot 统一 helper,超字节上限从最旧逐删;单次写入超上限只保留最近 1 个快照。大 JSON 场景快照数量自动收敛,防常驻内存爆炸。
- **惰性 hash**:`hashValue` 加缓存(dirty 标记);写路径标脏,读/冲突检测复用缓存、未脏不重算。缓存经不可枚举属性或 WeakMap,不得污染 `safeStringify` 输出(防 hash 自引用不稳定)。
- **draft 中间校验**:`draft_write` append 后预检拼接合法性 —— ≤512K 全量 `JSON.parse`、更大做括号/引号平衡轻量扫描;失败返回 `DRAFT_FRAGMENT_INVALID`(草稿保留,可 `mode:'rewind'` 回退或重 start),把「最后才知道拼错」提前到每 chunk。
- **draft 淘汰显式化**:`maxDraftBytes`(默认 1.5MB)超限返回 `DRAFT_TOO_LARGE` 显式报错;`draft_commit` 检测到草稿被池 LRU 淘汰返回 `DRAFT_EVICTED`(提示重 start / 拆多草稿合并)。不得静默淘汰或 append 到空。
- **多草稿合并**:`draft_commit({ draftId, merge?: string[] })` 支持多草稿结构化合并(`mergeParts`:对象递归合并后覆盖前 / 数组顺序拼接 / 标量后覆盖)→ 整体 schema 校验 → 提交。各草稿仍可单独 commit(向后兼容)。大 JSON 可分模块构建后一次合并提交。
- **eval 子树 transform 支持 patches**:子树模式 transform 若脚本返回 `{patches:[...]}`(path 相对子树根)→ 前缀化后走 `applyPatchesToBind`(与整树行为对齐);子树内增量改不退化整树。
- **子路径 hash 粒度**:`read({jsonPath})` 返回追加 `subHash = hashValue(getByPath(bindRef, jp))`(与整体 hash 并存;不传 jsonPath 维持整体)。写侧新增 `expectedSubHash` 参数(`write`/`edit_data`/`delete_data`/`draft_commit` 单 jsonPath 操作),冲突检测比对**目标子路径子树 hash**(`handleConflict` 加 `scopePath`);外部改未读部分不误触发。批量 patches 无单一目标路径,维持整体 hash。修「子路径 read + 整体 hash」粒度错,大 JSON 乐观锁从「整页级」细到「你改的那部分级」。
- **round 预算提示**:usageHints draftWrite 段补「大 JSON 分块构建是典型多轮工具调用,默认 `maxToolRounds=10` 可能触顶被截断,建议集成方配 ≥20」;`createChatSdk` 类型注释/文档补建议值。**不做自动放大**(改默认影响全局,零行为变化原则)。
- **行为约束**:全增量,API 零破坏;`maxSnapshotBytes`/`maxDraftBytes` 新配置有默认值;`draft_commit` 增可选 `merge`/`expectedSubHash` 参数;`read` 增 `subHash` 追加字段(整体 hash 保留);现有 draft/写路径用户零影响(A1 修安全缺陷、A4 修 hash 粒度正确性)。
