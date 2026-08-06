# Change: harden-large-json-write(大 JSON 写入链路加固)

> 用户诉求(2026-08-04):「当前方案是否完善,是否有遗漏或不足」→ 评审现状大 JSON 写入方案发现 6 个真实缺口(1 安全 + 3 性能/鲁棒 + 2 能力)。
> **状态**:proposal(未实施)。**独立 change**,无前置依赖。基于对 dataOps 写入链的逐行核对(证据见 design §1-§4)。

## Why

大 JSON 写入现状方案主干正确(原子批量 `applyPatchesToBind` + 分块构建 `draft_write/commit` + 双收敛点 `commitSetToBind`/`applyPatchesToBind` + 白名单 merge + 三池独立 LRU),但**对「几百 K 大 JSON」这条链路本身有一组真实缺口**,按严重度:

| 缺口 | 现状 | 问题 |
|---|---|---|
| **A1 draft_commit 无乐观锁(安全)** | `draft_commit`(`dataOps.ts:875`)直接 `commitSetToBind`,**跳过 `handleConflict`** | 全 SDK 唯一漏乐观锁的写路径;draft 跨多轮累积期间外部改过 bind → 整份大 JSON 静默覆盖,冲突丢弃。恰恰是核心卖点「乐观锁+冲突介入」最该保护的场景 |
| **A2 快照栈无大小上限(性能)** | `maxSnapshots=20`,每次写 push 全量 `deepClone(bindRef)` | 大 JSON 下 20 个完整快照常驻 = 几百 K×20 ≈ 数 MB;每次写 O(n) 全量深克隆 |
| **A3 hashValue 全量序列化(性能)** | `hash = cyrb53(safeStringify(v))` | read/写后/冲突检测都全量 stringify+扫描;大 JSON 频繁读写 = 多次全量序列化 |
| **B1 draft_write 无中间校验(体验)** | `existing.content + chunk` 裸拼,最后才 `JSON.parse` | 唯一让 LLM 直接拼原始 JSON 的通道;几百 K 一个逗号错 = JSON_INVALID,LLM 定位难、反复试错烧 token |
| **B2 draft 池静默淘汰(鲁棒)** | drafts 池内 2MB 按 updatedAt 淘汰,超限删最旧 draft | 累积中 draft 可能被静默删(前功尽弃无显式报错);多 draftId 或超大目标池内互挤 |
| **C1 多草稿合并(能力)** | 只能单 draftId 累积→一次 commit | 大 JSON 分模块构建(组件 A/B/C 各一草稿最后合并)无能力 |
| **C2 eval 子树 transform 不支持 patches(能力/一致性)** | 整树 transform 支持 `{patches}` 返回,子树 transform 只支持整体替换子树新值 | 大子树增量改要退化整树;与整树行为不一致 |
| **A4 子路径 hash 粒度错(正确性,评审补充)** | `read({jsonPath})` 返回**整体 bind 的 hash**(`dataOps.ts:297`),`handleConflict` 也整体比对 | 大 JSON 下 LLM 分多次 read 子路径(`components.0`/`components.1`…),但 hash 是整页级 → 外部改**未读部分**(`components.3`)也触发整体 hash 变 → 写已读子路径**误冲突**。对象越大,外部动到未读部分概率越高,乐观锁退化「整页级」而非「你改的那部分级」 |
| **A5 round 预算截断(鲁棒,评审补充)** | `maxToolRounds` 默认 10(`createAgent.ts:185`),`rounds++` 每工具轮递增(`:641`),while `rounds < maxToolRounds`(`:525`) | 大 JSON 分块构建是典型「多轮多次工具调用」:draft_write ×6 + draft_commit ×1 + read 确认 ×1 + 调研 read/query ×2-3 ≈ 触顶 10 → 被 while 截断,剩余 draft 写不进去 |

**价值**:修安全/正确性缺陷(A1 + A4)+ 降大 JSON 成本(A2/A3)+ 提升分块构建体验与鲁棒性(B1/B2 + A5)+ 补齐能力(C1/C2)。全部增量、默认零行为变化。

## What Changes

### P0 · A1 `draft_commit` 乐观锁
- `draft_commit` 写前补 `handleConflict('set', effHash)`(复用现有函数),autoLock 用最后 read 的 hash;冲突 → 走冲突人工介入(与 set/edit/delete/write 一致),不静默覆盖。

### P1 · A2 快照栈大小上限 + A3 增量 hash
- A2:`createDataOps` 增加 `maxSnapshotBytes`(默认如 2MB),pushSnapshot 前估算新增快照体积,超限从最旧逐删;大 JSON 场景快照数量自动收敛,防常驻爆炸。
- A3:`hashValue` 引入「惰性 hash」——bind 挂 `_dirty`(复用 checkpoint 脏标记思路),hash 计算缓存,仅脏时重算;或提供 `hashValueDeep`(走 dirty 判断)供高频路径。目标:读多写少场景避免每读一次全量序列化。

### P1 · B1 draft_write 中间校验
- `draft_write` append 时做**增量结构预检**:拼接后尝试 `JSON.parse`(低成本,失败返回 `DRAFT_FRAGMENT_INVALID` 提示「当前 chunk 导致不合法 JSON,可回退/修正」,草稿保留)——把「最后才知道拼错」提前到每 chunk。
- 大 JSON 下 parse 整份有成本,预检阈值化:bytes < N(如 512K)全量 parse;更大则做「括号/引号平衡 + 首尾闭合」轻量扫描(成本 O(len) 但远低于 parse)。

### P1 · B2 draft 池淘汰显式化
- `draft_write` 写入前检查目标 draft 累计 bytes 是否超单 draft 上限(`maxDraftBytes` 默认如 1.5MB,drafts 池 2MB 内留余量)→ 超限返回 `DRAFT_TOO_LARGE` 显式报错(不静默挤淘汰)。
- 池满时若目标 draft 被 LRU 删除,`draft_write`/`draft_commit` 检测到草稿缺失 → 返回 `DRAFT_EVICTED`(提示「草稿已被池淘汰,需重新 start」),而非静默 append 到空。

### P2 · C1 多草稿合并
- `draft_commit` 增 `merge?: string[]`(多个 draftId):读取各草稿 → JSON.parse 各自 → **按 merge 语义合并**(目标为对象按 key 合并 / 数组按顺序拼接)→ 整体 schema 校验 → 提交。
- 让大 JSON 可「组件 A/B/C 各一草稿 → 一次 commit 合并」。

### P2 · C2 eval 子树 transform 支持 patches
- 子树模式 transform 若脚本返回 `{patches:[...]}`(path 相对子树根)→ 相对子树 apply(与整树行为对齐),子树内增量改不退化整树。

### P1 · A4 子路径 hash 粒度(read({jsonPath}) 返回子路径 hash,评审补充)
- `read({jsonPath})` 返回**子路径 hash** `subHash = hashValue(getByPath(bindRef, jp))`(与整体 hash 并存,如 `(hash=整体 subHash=子路径)`);`read` 不传 jsonPath 时维持整体 hash。
- 写侧新增 `expectedSubHash` 参数(`write`/`edit`/`delete`/`draft_commit`):单 jsonPath 操作传子路径 hash,冲突检测比对**目标子路径当前子树 hash**(`hashValue(getByPath(bindRef, jp))`)—— 外部改**未读部分**(其它子路径)不误触发。
- 批量 patches 无单一目标路径 → 维持整体 hash 比对(不适用子路径 hash)。
- 修「子路径 read + 整体 hash」粒度错:大 JSON 下 LLM 分多次读子路径,写局部不因整体变化误冲突。

### P1 · A5 round 预算放大/提示(大 JSON 分块不被截断,评审补充)
- usageHints draftWrite 段补提示:「大 JSON 分块构建是典型多轮工具调用(draft_write×N + commit + read 确认 + 调研),默认 maxToolRounds=10 可能触顶被截断,建议集成方按目标组件数调大(如 20-30)」。
- `createChatSdk` 选项文档/类型注释补:`maxToolRounds` 大 JSON 场景建议值。
- **不做自动放大**(改默认影响全局,零行为变化原则):提示 + 文档,让集成方按场景配。

## Impact

- **测试**(按「新增功能测试同步约定」):
  - selftest:A1 draft_commit 冲突触发/无冲突通过;A2 快照字节上限淘汰;A3 脏后 hash 重算/未脏复用;A4 read 子路径返回 subHash + 写侧 expectedSubHash 比对(外部改未读部分不误冲突 / 改目标子路径触发)/ 批量 patches 走整体;A5 usageHints draft 段含轮次提示;A2 性能可测;B1 append 预检失败/阈值切换;B2 超限报错/淘汰检测;C1 merge 对象/数组;C2 子树 patches。
  - e2e:A1 冲突路径(inspect/pendingConflict)、A4 子路径 hash 冲突路径、C1 merge、B2 显式报错。
  - browser:mock LLM 跑「分块构建 + 中间校验 + commit」端到端(含多轮不截断)。
- **行为变化**:全增量;默认对现有用户零影响(draftWrite 本就 opt-in)。A1 修的是现有 bug(安全);A4 修的是 hash 粒度正确性。
- **向后兼容**:`maxSnapshotBytes`/`maxDraftBytes` 新配置默认值;`draft_commit` 增可选 `merge` + `expectedSubHash`;eval 子树 patches 是增量能力。`read` 返回附 `subHash` 是追加字段(整体 hash 保留)。
- **文档**:CLAUDE.md 大 JSON 小节补 A1-A5/B1-B2/C1-C2;usage-guide draft 小节补中间校验/合并/淘汰 + maxToolRounds 提示;read 小节补 subHash;`doc/问题.md` 记录 C3(批量 patch 极端体积,非主路径)。

## 决策

1. **A1 是必改**(安全缺陷):draft_commit 补乐观锁,与所有写路径一致。
2. **A2/A3 用「配置默认 + 惰性」**:快照字节上限默认值保守(不改变现有语义,只防大 JSON 爆);增量 hash 复用 dirty 思路,不引入新依赖。
3. **B1 用阈值化预检**:小 draft 全 parse(准),大 draft 轻量扫描(快),成本可控。
4. **C1 用 merge 语义而非「拼接 JSON」**:多草稿合并走结构化 merge(对象按 key/数组拼接),避免「拼接 JSON 字符串」的脆弱(与 B1 的定位一致:LLM 不该直接拼原始 JSON)。
5. **P0/P1 优先, P2 可选**:A1 修 bug,应独立优先;P2 是能力增强,可随本 change 一并做或后续单独评估。
6. **A4 子路径 hash 是增量、非替换**:read 返回追加 `subHash`,整体 hash 保留(向后兼容);写侧 `expectedSubHash` 是可选参数,单路径操作可用、批量回退整体。粒度从「整页级」细到「你改的那部分级」,正是大 JSON 乐观锁的核心诉求。
7. **A5 提示而非自动放大**:改 `maxToolRounds` 默认值影响所有用户(含非大 JSON),违背零行为变化;提示 + 文档让集成方按场景配,风险最小。

## Non-goals

- 不做完整「多草稿 diff/冲突」工作流(合并冲突交 schema 校验 + 现有乐观锁兜底,不做逐 key 冲突 UI)。
- 不做 draft 的「结构化分块协议」(让 LLM 按 schema 树分块)—— 那是更大的设计,B1 的预检已缓解拼错问题。
- 不并入 `tool-name-collision` / `skill-external-scripts` / 其它活跃 change。
