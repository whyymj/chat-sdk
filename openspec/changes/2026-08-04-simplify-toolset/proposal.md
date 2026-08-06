# Change: simplify-toolset(工具面冗余精简 + 遗漏补充)

> 用户诉求(2026-08-04):「内部工具是否有多余、重复的」「是否有遗漏或需要优化的」→ 系统性评估内置工具面(30+ 工具),确认 3 处功能覆盖冗余 + 1 处能力遗漏 + 若干提示优化。
> **状态**:proposal(未实施)。**独立 change**,无前置依赖。基于对 dataOps/vfs 工具实现的逐行核对(证据见 design §1)。

## Why

内置工具面经多轮演进累积,存在**「被高层工具覆盖的低层工具」**与**「只进不出的 vfs」**两类问题:

| 类型 | 现状 | 问题 |
|---|---|---|
| **冗余(被覆盖)** | `snapshot_data`/`list_data_snapshots` 被 `history_data` 覆盖(只读查快照 + id/jsonPath);`get_data` 被 `read` 完全覆盖(describe+get+jsonPath+fields+depth+分页 超集) | advanced 模式工具面有 3 个「功能上被替代」的工具,LLM 认知负担冗余,与 `tool-name-collision` 的「工具面确定性」目标相悖 |
| **冗余(可吸收)** | `diff_data` 与 `history_data` 轻微重叠(都涉快照) | diff 是结构化差异、history 是查看单快照,能力不同 —— 保留,但让 history 提示「对比用 diff_data」 |
| **遗漏(只进不出)** | vfs 有 read/write/edit/ls/glob/grep/json_read/json_patch,**无 `vfs_rm`** | vfs 只进不出,草稿/临时文件无法清理;draft_write 草稿 commit 后自动清,但用户写入的中间文件无删除通道 |
| **提示缺失** | `diff_data` 存在性 / `get_dom` 回看 / `read` 按 schema 投影 未进 usageHints | LLM 不知道这些能力存在,「能力对 LLM 不可达」 |

**价值**:精简 advanced 工具面(少 2-3 个被覆盖工具)+ 补 vfs 删除闭环 + 强化提示可达性。全增量,默认零行为变化(simple 模式不受影响)。

## What Changes

### 1. 移除被覆盖工具(advanced)
- `snapshot_data` + `list_data_snapshots` → `history_data` 吸收(history_data 增「列表模式」返回快照时间线元信息,等价 list_data_snapshots)。advanced 不再暴露这俩工具。
- `get_data` → 标 deprecated(advanced 移除,simple 本就不暴露);`read` 是唯一读取入口。

### 2. 补 `vfs_rm`
- 新增 `vfs_rm({ path })`:删除 vfs 文件(含 drafts/ 下草稿),清理闭环;`VFS_TOOL_NAMES` 加 `vfs_rm`。

### 3. usageHints 可达性增强
- advanced/simple 段补:`diff_data` 存在性(对比当前与快照);`get_dom`(改完数据回看渲染,需 domInspect 开);`read` 按 schema 投影自动隐藏未声明字段。
- `history_data` 描述补「对比差异用 diff_data」联动。

## Impact

- **测试**:
  - selftest:`history_data` 列表模式(等价 list_data_snapshots)/ 移除 snapshot_data 后不可用 / `vfs_rm` 删除文件(含不存在报错)/ get_data deprecated 后 advanced 不含。
  - e2e:advanced 模式 `inspect().tools` 不含 snapshot_data/list_data_snapshots/get_data;simple 模式含 read/write。
  - browser:mock LLM 用 vfs_rm 清理草稿端到端。
- **行为变化**:advanced 模式少了 3 个被覆盖工具(simple 本就无);新增 vfs_rm。对从不用的用户零影响。
- **向后兼容**:移除的是「功能被替代」的工具,`history_data` 列表模式补回等价能力;`get_data` 若被集成方引用,标 deprecated + 文档指引 read(不硬删,避免破坏)。
- **文档**:CLAUDE.md 工具面小节、usage-guide 工具表、README 工具清单同步。

## 决策

1. **移除而非「降级到 simple」**:被覆盖工具连 advanced 也不必保留(history_data/read 已完整替代);simple 本就隐藏,移除对 simple 无感。
2. **`get_data` 标 deprecated 而非硬删**:集成方可能引用(工具集导出/自定义),硬删破坏;deprecated + 文档指引 read 平滑过渡。
3. **`history_data` 列表模式吸收 list_data_snapshots**:等价能力不丢,少一个工具。
4. **补 `vfs_rm` 而非「复用 vfs_write 写空」**:语义清晰(删除 vs 覆写空内容),且避免误用。
5. **不合并 eval/query/search/checkpoint/restore**:互补/不同层级,非冗余(见 design §3)。

## Non-goals

- 不做工具「别名系统」(一个名多个语义)—— 与 tool-name-collision 的覆盖语义正交,不需要。
- 不重命名现有工具(破坏集成方)。
- 不动 read/write 分层设计(simple 主推高层、advanced 暴露底层是刻意,非冗余)。
- 不并入其它活跃 change。
