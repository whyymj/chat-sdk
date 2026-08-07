# Design: simplify-toolset(工具面冗余精简 + 遗漏补充)

> **核心**:移除 3 个被覆盖工具(snapshot_data/list_data_snapshots/get_data)+ 补 vfs_rm + usageHints 可达性增强。全增量,默认零行为变化。评审修正:逐行核对实现区分度。

## 1. 现状核对(证据)

### 1.1 完整内置工具清单(30+)
| 类别 | 工具 | toolMode |
|---|---|---|
| 高层 | `read`/`write` | simple 主推 |
| 底层读 | `describe_data`/`get_data`/`schema_data` | advanced |
| 底层写 | `set_data`/`edit_data`/`delete_data` | advanced |
| 快照/历史 | `snapshot_data`/`list_data_snapshots`/`restore_data`/`history_data`/`diff_data` | 部分 advanced |
| 查询 | `query_data`/`search_data`/`eval_script` | simple |
| 分块写 | `draft_write`/`draft_commit` | advanced |
| 文档 | `fetch_document` | 默认 |
| DOM/环境 | `get_dom`/`inspect_env` | opt-in |
| vfs(8) | `vfs_read/write/edit/ls/glob/grep/json_read/json_patch` | 中间件 |
| 规划 | `write_todos`/`update_todo` | 中间件 |
| 子 agent | `spawn_agent`/`spawn_agents`/`use_<id>` | 中间件 |
| skill | `load_skill` | 中间件 |
| checkpoint | `restore_last_checkpoint`/`list_checkpoints` | 中间件 |
| human confirm | `request_human_confirmation` | 中间件 |

### 1.2 冗余确认(核对实现)
- **`snapshot_data`(`:416`)/`list_data_snapshots`(`:432`)vs `history_data`(`:475`)**:history_data 只读查快照 + id/jsonPath 子路径,已覆盖「查看」;list_data_snapshots 仅「时间线元信息(序号/操作/标签/大小)」。CLAUDE.md 已记「被自动快照+restore+history 覆盖」。
- **`get_data`(`:288`)vs `read`(`:614`)**:read 合并 describe+get,带 jsonPath/jsonPaths/fields/depth/offset/limit 分页,超集。
- **`vfs_edit`(`vfs.ts:335`)vs `vfs_write`(`:289`)**:vfs_edit 是「唯一 oldString 精确替换」+ 多匹配报错(AMBIGUOUS_MATCH),vfs_write 是整体覆盖 —— **有区分,非别名**。
- **`diff_data` vs `history_data`**:diff 是结构化 `{path,from,to}[]` 对比,history 是查看单快照 —— **能力不同,保留**。

### 1.3 遗漏确认
- **无 `vfs_rm`**:vfs 工具集(8 个)只进不出;draft 草稿 commit 自动清,但用户写入中间文件无删除通道。`VFS_TOOL_NAMES`(`vfs.ts:248`)不含 rm。
- **usageHints 缺**:diff_data 存在性(仅 advanced)、get_dom 回看、read schema 投影。

## 2. 移除被覆盖工具

### 2.1 `history_data` 增列表模式
```ts
// history_data 参数加 list?: boolean(或 mode:'view'|'list')
async ({ id, jsonPath, list }) => {
  if (list) {
    return snapshots.map((s) => `#${s.id} [${s.op}]${s.label ? ' ' + s.label : ''} ${formatBytes(size)} ${new Date(s.ts).toLocaleString()}`).join('\n')
    // 等价 list_data_snapshots 的时间线元信息
  }
  // 现状:查看某快照内容
}
```
- 吸收 list_data_snapshots 的全部能力,单一「快照查看」工具。
- `snapshot_data`/`list_data_snapshots` 从 dataOps 工具数组移除(`SIMPLE_HIDDEN` 与 advanced 暴露列表同步删)。

### 2.2 `get_data` 标 deprecated
- advanced 不再暴露(从 dataOps 工具数组移除,`get_data` 保留实现但不装配);`SIMPLE_HIDDEN` 无关(simple 本就不含)。
- `types/index.d.ts` / `defineDataToolset` 导出同步:`get_data` 从返回工具名剔除,但保留 `get_data` 导出兼容(或文档指引 read)。

### 2.3 toolMode 计数同步
- simple=7 / advanced=16 / minimal=2 计数更新(advanced 减 3:snapshot_data/list_data_snapshots/get_data)。
- e2e/selftest 断言 toolMode 工具数同步。

## 3. 补 `vfs_rm`

```ts
// vfs.ts 加 vfs_rm
const vfsRm = tool(
  async ({ path }) => {
    const key = normalize(path)
    if (!store.files[key]) return toolError({ code: 'NOT_FOUND', path, message: `未找到文件 "${path}"`, hint: '用 vfs_ls 查看文件列表' })
    delete store.files[key]
    return `已删除 ${path}。`
  },
  { name: 'vfs_rm', description: '删除虚拟工作区文件(含 drafts/ 下草稿);vfs 只进不出的清理闭环。', schema: z.object({ path: z.string() }) },
)
```
- `VFS_TOOL_NAMES`(`vfs.ts:248`)加 `'vfs_rm'` → source 标注 builtin。
- draft_commit 成功清草稿的现状不变(内部删除);vfs_rm 是外部(LLM)删除通道。

## 4. usageHints 可达性增强

```ts
// usageHints.ts
// advanced 段(:54 附近)已有 diff_data 提示(「对比当前与历史快照…」)—— 补 simple 段存在性
if (rc.dataOps && !simple) hints.push('… diff_data({snapshotId?,against?}) 对比当前与快照差异(结构化 path→from/to)')
// 或 diff_data 从 advanced 提示挪到通用段(需评估是否对 simple 有意义)
// read 投影提示
hints.push('read() 按 schema 投影自动隐藏未声明字段;大 JSON 读子路径看实际形状用 read({jsonPath})')
// get_dom 回看提示(domInspect 开时)
if (rc.domInspect) hints.push('改完数据回看渲染是否生效:get_dom 读渲染后 DOM 结构化(深度可控/属性白名单)')
```

- **注意**:diff_data 是 advanced 工具,simple 不暴露 —— simple 段**不应**提示 diff_data(否则提示了工具不存在)。设计决策:diff_data 提示保持 advanced 段;simple 段只补 read 投影 + get_dom。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 移除工具破坏集成方引用 | `get_data` 标 deprecated(不硬删),文档指引 read;snapshot/list 被 history 完整替代 |
| history_data 列表模式行为变化 | 新增 list 参数,默认行为(查看单快照)不变 |
| 移除后 advanced 用户短暂困惑 | usageHints/文档同步;移除的是被覆盖工具,read/history 是既有入口 |
| vfs_rm 误删草稿 | 返回 NOT_FOUND 明确;draft_commit 内部删除独立,不受影响 |
| 计数不同步 | 按「新增功能测试同步约定」更新 toolMode 计数 + 断言 |

## 6. 与现有机制关系

| 机制 | 关系 |
|---|---|
| `tool-name-collision`(并行 change) | 互补:重名管「覆盖语义」,simplify 管「移除冗余 + 补遗漏」;若同批实施,dedupeTools 收敛天然处理「history 吸收 snapshot」的重名覆盖 |
| `toolMode` 三档 | advanced 工具面精简(16→13);simple(7)/minimal(2)不受影响 |
| `defineDataToolset` | 移除工具从导出剔除;get_data 保留导出兼容(deprecated) |
| `harden-large-json-write`(并行) | vfs_rm 与 draft 淘汰(B2)互补:草稿可显式删(vfs_rm)也可超限报错 |

## 7. 关键实现文件

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts` | history_data 列表模式;移除 snapshot_data/list_data_snapshots/get_data 装配;toolMode 计数 |
| `src/core/backends/vfs.ts` | vfs_rm 工具 + VFS_TOOL_NAMES |
| `src/core/harness/usageHints.ts` | read 投影 / get_dom 回看提示;diff_data 保持 advanced |
| `src/core/types/index.ts` + `types/index.d.ts` | get_data deprecated 标注;工具名清单同步 |
| `src/core/index.ts` | 若导出工具名常量同步 |
