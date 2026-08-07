# Specification Delta: page-agent-core

> 本文件为 change `simplify-toolset` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 工具面冗余精简 + 遗漏补充(simplify-toolset)

系统精简内置工具面:移除被高层工具完全覆盖的低层工具,补充 vfs 删除能力,并增强工具可达性提示。全增量,默认零行为变化(simple/minimal 模式不受影响)。

- **移除被覆盖工具(advanced)**:`snapshot_data`/`list_data_snapshots` 被 `history_data` 覆盖(只读查快照 + id/jsonPath 子路径 + 新增列表模式 `history_data({list:true})` 等价返回快照时间线元信息);`get_data` 被 `read` 完全覆盖(read 合并 describe+get,带 jsonPath/jsonPaths/fields/depth/分页超集)—— 三者从 advanced 工具面移除。`get_data` 标 **deprecated**(保留实现兼容,`defineDataToolset` 导出剔除,文档指引 read),不硬删避免破坏集成方。`toolMode` 计数同步(advanced 16→13,simple 7/minimal 2 不变)。
- **补 `vfs_rm`**:新增 `vfs_rm({ path })` 删除 vfs 文件(含 drafts/ 下草稿),不存在返回 `NOT_FOUND`;`VFS_TOOL_NAMES` 加 `vfs_rm`(source 标注 builtin)。vfs 由「只进不出」补全删除闭环(与 draft_commit 的内部自动清草稿互补,`vfs_rm` 是外部显式删除通道)。
- **usageHints 可达性增强**:simple 段补 `read()` 按 schema 投影自动隐藏未声明字段提示;`rc.domInspect` 开启时补 `get_dom` 回看渲染提示;`history_data` 描述补「对比差异用 `diff_data`」联动(advanced)。**diff_data 提示保持 advanced 段**(simple 不暴露,不得提示不存在的工具)。
- **保留合理现状**:`read`/`write` 与底层工具的分层设计(非冗余)、`eval_script`/`query_data`/`search_data` 互补、`checkpoint` 与 `restore_data` 分属会话级/数据级、`vfs_edit`(精确替换)与 `vfs_write`(整体覆盖)有区分 —— 均不移除。
- **行为约束**:全增量,API 零破坏(移除的是被替代工具 + deprecated 兼容);集成方引用 `get_data` 仍可用(经兼容导出),文档指引迁移到 `read`。
