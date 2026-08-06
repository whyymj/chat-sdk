# Change: placeholder-protected-read-write(占位符替换读写:精确值保护)

> 用户诉求(2026-08-04):「对于部分内容需要精确保存,是否有占位符替换读写的功能?防压缩丢失,或者幻觉导致错误修改?还需要有对应的资源管理,释放等」→ 评估现状发现无此能力,立 change。
> **状态**:proposal(未实施)。**独立 change**,无前置依赖。基于对 read/写链/workingMemory/vfs 的逐处核对(证据见 design §1)。

## Why

当前 `read` 直接把原始精确值(ID / hash / 长 verbatim 串 / 关键配置)丢给 LLM,写链只按 schema 白名单 + merge 语义保护「未声明字段」,对「声明了但需精确保存的字段」无保护。按用户诉求拆 4 个真实缺口:

| 缺口 | 现状 | 问题 |
|---|---|---|
| **R1 读侧无占位符替换(正确性)** | `read`/`read({jsonPath})` 直接返回原始精确值(`dataOps.ts:297`) | 精确值长期在 LLM 消息流里 → 压缩易丢字;重写时幻觉改错(猜一个「差不多」的值写回) |
| **R2 写侧无精确性强制(安全)** | schema 白名单 + merge 语义只保**未声明**字段;已声明精确字段可自由改 | LLM 改错 id/hash/关键配置无拦截;整体 set 的 merge 保留「未声明」但**不保「声明但需冻结」**的字段 |
| **R3 无跨压缩资源句柄 pin(鲁棒)** | `workingMemory` 只 pin **path/hash**(结构化定位,`workingMemory.ts:12-13`);`offloadLargeResult` 只读侧·只超大 | 「句柄→外存」的精确值保护模式无句柄 pin;压缩后 LLM 可能连「这字段被保护了」都不知道,仍去改 |
| **R4 无资源生命周期抽象(能力)** | vfs 三池(LRU+字节)是存储层,无「资源」语义 | 占位符背后缺 create/get/update/delete/list + 显式释放 + 淘汰检测 + 与 setData/checkpoint 联动 |

**价值**:修正确性/安全缺陷(R1/R2)+ 补跨压缩保真(R3)+ 补资源管理能力(R4)。全部增量、默认零行为变化(未配 `data.resources` 不启用)。

## What Changes

### P0 · 冻结字段(freeze,防幻觉错误修改)
- `data.resources: [{ path, mode: 'freeze' }]` 声明只读字段。
- `read` 时冻结路径值 → 占位符 `⟦frozen:<path>⟧`(**精确值不入 LLM 消息流**,从源头杜绝「幻觉记错再写回」);LLM 确需真值用 `resource_get` 显式取。
- 写侧强制:整体 set / 增量 patch 改冻结路径 → `FROZEN_FIELD` 拒绝(merge 语义天然保留冻结值,整体 set 显式校验)。

### P1 · verbatim 原样保留(防压缩丢失 + 防重打丢字)
- `mode: 'verbatim'`:read 时精确长串 → `⟦res:<handle>⟧`,原值懒注册进资源池;写侧句柄展开回原值,LLM 写新值且 ≠ 原值 → `VERBATIM_MISMATCH`(要改先 `resource_update` 再写回句柄)。

### P1 · 资源存储与生命周期(资源管理/释放)
- vfs 第四池 `resources`(`maxResourceBytes` 默认 4MB,池内 LRU + 字节水位;淘汰检测 → `RESOURCE_EVICTED`)。
- LLM 工具:`resource_get/update/list/delete`(advanced);SDK API:`sdk.createResource/getResource/updateResource/deleteResource/listResources/releaseResources`。
- 生命周期:懒注册(首次 read 受保护路径自动入库);`setData` 替换清空(路径可能失效,与快照/hash 重置一致);checkpoint 随 vfs 天然保存/恢复;dataOps 快照/restore 不受影响(bind 恒持原始值,占位符只在读写边界)。

### P1 · 跨压缩 pin(防压缩丢句柄)
- augmentPrompt 每轮注入「受保护资源」段(path→mode→handle,从资源清单生成,**不调 LLM**)→ 与 workingMemory/mission 同机制,state 中天然跨压缩。
- 压缩后 LLM 仍知道「哪些字段被保护 + 句柄」,不会误改。

### P1 · 配套 skill / tools / usageHints / 集成(LLM 可达性)
- **新内置 skill `precise-value-protection`**(入 npm `skills/` 分发):指导 LLM 识别「需精确保存的字段」(id/hash/长 verbatim/关键配置)、读到 `⟦frozen⟧`/`⟦res:⟧` 用 `resource_get` 取真值、冻结字段不可写、verbatim 要改先 `resource_update` 再写回句柄、撞 `FROZEN_FIELD`/`VERBATIM_MISMATCH`/`RESOURCE_EVICTED` 后怎么应对。
- **资源工具装配(opt-in)**:`resource_get/update/list/delete` 由 `createDataOps` **动态生成、仅配 `data.resources` 时暴露**(同 controller 闭包);`selectBuiltinTools`/toolsets **不动**(不静态装配)→ 未配置用户零影响。
- **统一提交链强制层**:freeze/verbatim 强制做成 `commitSetToBind`/`applyPatchesToBind` 内的前置层(**非独立写路径**)→ `write`/`edit_data`/`delete_data`/`draft_commit`/`eval_script`(transform)全部天然覆盖;`write({dryRun})` 也走强制。
- **usageHints 补丁**(按 rc 分段):data 段补占位符语义 / `FROZEN_FIELD` / `VERBATIM_MISMATCH` / `RESOURCE_EVICTED` / `resource_get` 取真值;draft 段补「draft_commit 后仍过 freeze/verbatim 强制」;eval 段补「transform 结果含受保护路径 → 走强制」;write 段补「dryRun 也走强制」。
- **presets / integrate skill 同步**:pageBuilder 等 presets 说明文档补 resources 一句(可选);`page-agent-sdk-integrate`(公开分发 skill)的 references/api.md 补 `data.resources` 配置。

## Impact

- **测试**(按「新增功能测试同步约定」):
  - selftest:read 冻结/verbatim 占位替换;整体 set 改冻结拒绝 / patch 改冻结拒绝 / merge 保留冻结值;verbatim 句柄展开 / 新值不匹配拒绝;资源工具全路径(resource_get/update/list/delete);懒注册;淘汰检测(RESOURCE_EVICTED);setData 清空;update 仅 verbatim;跨压缩 pin 段注入;未配置不启用(零影响)。
  - e2e:`inspect().resources` 反映配置与句柄;资源工具暴露 + source;createChatSdk 配置。
  - skill:load_skill(`precise-value-protection`) 后索引含 + 全文含 FROZEN_FIELD/VERBATIM_MISMATCH 处理指引(selftest)。
  - browser:mock LLM 跑「受保护资源」demo(read 占位 → 冻结拒绝 → verbatim 句柄 → 跨压缩)。
- **行为变化**:全增量;未配 `data.resources` 对现有用户零影响(占位符只在受保护路径出现)。
- **向后兼容**:`data.resources`/`maxResourceBytes` 新配置默认值;资源工具是新增;bind 恒持原始值 → hash/快照/乐观锁(A4 子路径 hash)/checkpoint 全不受影响。
- **文档**:CLAUDE.md 数据槽小节补受保护资源(freeze/verbatim/资源工具/生命周期);usage-guide data 小节补 resources 配置 + 资源工具 + 跨压缩 pin。

## 决策

1. **bind 恒持原始值,占位符只在读写边界替换** → hash/快照/clone/乐观锁零干扰,与 A4 子路径 hash 天然兼容(占位符是渲染层/提交层变换,不落 bind)。
2. **freeze 与 verbatim 共享基础设施**:freeze 管「不能改」(不可变),verbatim 管「改不得丢字」(原样保留);两者都走「read 占位 + 写侧强制」同一骨架。
3. **资源存储复用 vfs 第四池**:复用现有 pool/LRU/字节水位/checkpoint 基建,不新建后端。
4. **懒注册**:首次 read 受保护路径自动把当前 bind 值入库 → 声明式配置零设置。
5. **跨压缩 pin 走 augmentPrompt 读资源清单(不调 LLM)**:同 workingMemory/mission 机制,state 中天然跨压缩。
6. **setData 替换清空资源**:旧路径可能失效(与快照/hash 重置一致),文档说明;新 read 触发懒注册。
7. **写侧强制语义**:freeze → `FROZEN_FIELD`;verbatim 句柄 → 展开;verbatim 新值不匹配 → `VERBATIM_MISMATCH`(显式 `resource_update` 才可改);未知句柄 → `RESOURCE_NOT_FOUND`。
8. **资源工具 opt-in 装配**:`resource_*` 由 `createDataOps` 动态生成、仅配 `data.resources` 时暴露,不进 `selectBuiltinTools` 静态装配 → 未配置用户零影响(与「默认零行为变化」一致)。
9. **(审查 A1)替换作用域 = 结构化读**(read/describe/get_data);query/search/eval 返真值由**写侧强制兜底**(与 Non-goal「精确性非安全遮蔽」一致)。
10. **(审查 A2)句柄定点展开**:沿 verbatim 路径定位替换,不做全局深遍历(防误展开 + 省大 JSON 成本)。
11. **(审查 A3)淘汰分侧**:读侧自愈(懒注册重建);写侧展开句柄资源缺失才 `RESOURCE_EVICTED`。
12. **(审查 B2)handle = 路径派生短哈希**:值变句柄不变,跨轮稳定,update/淘汰重注册不漂移。
13. **(审查 C1)整体写回显识别 = 未修改**:整体写前置沿受保护路径 normalize —— freeze 回显 `⟦frozen:path⟧` **跳过保留当前值**(safeMerge 顶层浅合并不天然跳过,不显式做会把占位符字符串写进 bind);verbatim 回显句柄/原值视为未改放行;新值≠原值 → VERBATIM_MISMATCH。normalize 是 A2 定点展开的三态扩展,非全局深遍历。
14. **(审查 C2)批量失败带 `patches[i]` 定位**:强制层失败沿用现有定位约定,LLM 精准自纠,不整批盲目重试。
15. **(审查 C3)remove/delete 受保护路径默认拒**:freeze → `FROZEN_FIELD`;verbatim → 拒(先 `resource_delete` 释放再删)。容器 op(merge/append)命中受保护路径同按 mode 处理。
16. **(审查 D1)写侧展开自愈**:展开句柄时比对「池值 vs bind 当前值」,不等以 **bind 当前值为准自动重注册**(句柄不变),按未改放行 —— 覆盖 restore_data / importData / setData / 外部改 bind 四种池值漂移源,防展开旧值覆盖回退/导入的新值。乐观锁拦不住该时序(重新 read 即过 hash)。
17. **(审查 D2)resource_update 标 dataOps 脏**:防 checkpoint 增量 save 时「池新值 + bind 旧值」入快照 → restore 后即 D1 漂移。
18. **(审查 F1)强制层独立函数三处调用**:commitSetToBind / applyPatchesToBind / **eval transform 整体替换**(`dataOps.ts:578-596` 是内联独立路径,不走 commitSetToBind)→ 真六路径全覆盖。

## Non-goals

- 不做脱敏/加密(定位是**精确性**不是安全遮蔽;「防幻觉」≠「防泄密」,敏感值脱敏走集成方 `interceptors` 已有能力)。
- 不做敏感字段自动检测(必须配置声明;宁明确不猜测)。
- 不做资源版本化/diff(合并冲突交现有乐观锁 + schema 校验兜底)。
- 不并入 `harden-large-json-write` / `simplify-toolset` / 其它活跃 change。
