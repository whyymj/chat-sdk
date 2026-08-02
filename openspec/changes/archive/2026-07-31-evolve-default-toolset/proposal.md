# Change: evolve-default-toolset

> 配套:本变更优化默认(simple 工具模式)数据工具集 —— ① **精简**(把 `snapshot_data` + `list_data_snapshots` 从 simple 移到 advanced,被自动快照 + `restore_data` + 新增 `history_data` 覆盖);② **补缺**(新增 `history_data` 填"只读查看快照"空档,新增 `diff_data` 做差异对比);③ **增强**(`read` 多路径、`write` dryRun 预检)。合并原总纲 Change 11(`refine-default-toolset`)/ 12(`enhance-dataops-tools`)同源工具演进,统一立项。与 `fix-dataops-write-correctness`(写路径修 bug)正交:那个修已有工具的正确性,本变更调工具集构成与能力,建议先合 bug 修复再合本演进(同文件,合并时冲突可控)。

## Why

1. **simple 工具集偏臃肿,有低价值工具**。simple 默认暴露 8 个数据工具,其中 `snapshot_data`(手动命名快照)+ `list_data_snapshots`(快照列表)在 `write`/`set`/`edit`/`delete` **已自动存快照** + `restore_data` 已能回退的前提下,价值很低 —— LLM 极少需要主动建命名检查点。它们徒占工具位,增加 LLM 每轮的选择负担(11 个默认工具里选,混用/误选概率上升)。

2. **快照能力断档:"看"不到、"只能破坏性回退"**。`list_data_snapshots` 只返回元信息(id/op/size,**看不到值**),`restore_data` 是**破坏性**回退(改坏当前态)。中间缺"只读查看某快照内容"。LLM 想"看看上一版长啥样"做不到,只能 restore 恢复后再撤销,或干脆放弃 —— 冲突诊断、verify 自纠、用户问"刚才改了啥"都缺这个非破坏入口。

3. **`read` 单路径,改前多路读费轮次**。LLM 改一处前常需读多个不相关路径(如 `title` + `footer.text` + `components.3.price`),当前 `read` 一次一个 `jsonPath`,要调 3 次 → 3 轮工具调用 + 3 倍 hash/说明噪音 token。

4. **`write` 无预检,复杂改动靠"写了才知道"**。当前 write 只能实际写,失败(校验/patch/乐观锁)才返回错误。复杂 `patches` 批量改动缺乏"先看会改成啥、能不能过 schema"的预检,LLM 只能试错重试,费轮次。

5. **无差异对比工具**。verify 自纠、冲突人工介入、操作审计场景,LLM 需要"对比当前与某快照/某 JSON 的差异",当前只能 read 两次自行心算对比 —— 费 token 且易错。

## What Changes

### 1. 精简 simple:snapshot_data + list_data_snapshots 移到 advanced

- `filterByToolMode` 的 `SIMPLE_HIDDEN`(`dataOps.ts:390`)加入 `snapshot_data` + `list_data_snapshots`。
- simple 工具集从 8 → 6 个数据工具(随后续新增 +1 回到 7):`read` / `write` / `query_data` / `search_data` / `eval_script` / `restore_data`(+ 新 `history_data`)。
- advanced 仍全暴露(向后兼容);`minimal`(只 read/write)不受影响。

### 2. 新增 `history_data`(进 simple,填只读快照空档)

- `history_data({ id?, jsonPath? })`:返回指定快照(默认最近一次)的内容(可选 `jsonPath` 子路径,按子 schema 投影),**只读不回退**。
- 填补 `list_data_snapshots`(元信息)与 `restore_data`(破坏性)之间的空档;`list_data_snapshots` 移 advanced 后,`history_data` 成为 simple 下"看历史"的主入口。
- 实现复用现有 `snapshots` 栈(`DataSnapshotEntry.value`)+ `getByPath` / `projectBySchemaDeep`,低成本。

### 3. 新增 `diff_data`(进 advanced,差异对比)

- `diff_data({ snapshotId?, against? })`:对比"当前 bind"与"指定快照 / 一段 JSON",返回结构化 `{ path, from, to }[]`。
- 供 verify 自纠、冲突诊断、操作审计用;放 advanced(偏诊断,不占 simple 工具位)。
- 实现深比较(对象/数组递归、叶子差异),纯函数可单测。

### 4. `read` 增强:多路径

- schema 新增 `jsonPaths: string[]`(optional,与 `jsonPath` 互斥):一次读多个不相关子路径,返回 `{ path, value }[]`(各自带整体 hash)。
- 单 `jsonPath` 行为不变(向后兼容)。

### 5. `write` 增强:dryRun 预检

- schema 新增 `dryRun: boolean`(optional):走完整校验链(schema + 白名单 + patch 应用到 clone),但**不落盘、不入快照**,返回 `{ ok, preview, errors? }`。
- 四意图(value/patch/patches/del)均支持 dryRun;乐观锁冲突在 dryRun 下照常检测(返回冲突信息不挂起)。

## Impact

- **改造**:`src/core/tools/dataOps.ts` —— `SIMPLE_HIDDEN` 加 2 项;新增 `history_data` / `diff_data` 工具定义;`read` schema + 实现(多路径);`write` schema + 实现(dryRun 分支);新增 `diffObjects` 纯函数(差异算法)。
- **新增导出**:`diffObjects` 纯函数可从顶层导出(供集成方/测试复用,类比 `jpEval`/`searchJson`);`history_data`/`diff_data` 是内置工具(经 `inspect().tools` 可见,source='builtin'),无需独立导出。
- **行为变化(向后兼容性)**:
  - simple 模式下 `snapshot_data` + `list_data_snapshots` 不再暴露给 LLM → LLM 调不到(集成方若依赖 LLM 主动建命名快照,需切 advanced 或自行调 SDK)。**默认配置收紧**(低价值工具下沉),advanced 用户零影响。
  - simple 模式新增 `history_data` → LLM 多一个高价值只读入口。
  - `read` / `write` 新增 optional 参数 → 旧调用零影响。
- **影响规范**:`openspec/specs/page-agent-core.md` 增量 Requirement:simple 工具集构成 / 只读快照查看 / read 多路径 + write dryRun。
- **测试**:selftest 补 `filterByToolMode` 新规则 + `history_data`/`diff_data`/`diffObjects`/`read` 多路径/`write` dryRun 白盒;e2e `inspect.mjs` 补 simple 工具集构成断言。断言计数同步。

## Non-goals

- **不加** `stats_data`(count/sum/avg/group)—— `eval_script` query 模式已覆盖,专用工具与之重叠。
- **不加** 条件批量删改工具 —— `eval_script` transform(patches 增量)已覆盖。
- **不暴露** schema 约束为独立工具(`schema_data`)—— 本期聚焦精简+补缺+多路径/dryRun;schema 约束暴露(让 LLM 精确知 min/max/enum)留后续 change(可能走 `read` 附带类型标注,需单独评估 verbose trade-off)。
- **不动** `minimal` 模式(只 read/write)—— 已是极简,不改。
- **不引入** 新 toolMode 档位 —— simple/advanced/minimal 三档足够;精简靠调整 SIMPLE_HIDDEN。
- **不改** fetch_document / load_skill / request_human_confirmation —— 非数据工具,不在本变更范围。
- **不改** snapshot/restore 的内部机制 —— `fix-dataops-write-correctness` 管写正确性;本变更只调整它们的 toolMode 归属 + 补只读入口。

## 分期交付

| 期 | 内容 | 风险 | 可独立发布 |
|---|---|---|---|
| 期一 | 精简(snapshot/list 移 advanced)+ `history_data` 补只读缺口(配套,防精简后 simple 无"看历史") | 低(配置 + 新增工具) | ✅ minor |
| 期二 | `read` 多路径 + `write` dryRun(现有工具增强,纯加 optional 参数) | 极低 | ✅ minor(叠加期一) |
| 期三 | `diff_data`(advanced 新增,差异对比) | 低 | ✅ minor(叠加期二) |

期一是核心(精简 + 补缺必须配套,否则精简后 simple 丢"看历史"能力)。三期都属 minor(工具集构成变化 + 新增工具,向后兼容)。建议期一先行,二三叠加。
