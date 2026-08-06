# Design: placeholder-protected-read-write(占位符替换读写:精确值保护)

> **核心**:给「需要精确保存的内容」一个占位符替换读写通道 —— read 侧把精确值换成稳定句柄(值不入 LLM 消息流,防压缩丢字 + 防幻觉改错),写侧强制精确性(freeze 拒绝 / verbatim 展开校验),配套资源存储(vfs 第四池)与生命周期(懒注册/显式释放/淘汰检测/跨压缩 pin)。全增量,默认零行为变化。

## 1. 现状核对(证据)

- **无占位符替换读写**:grep `placeholder|占位` 全 src 仅三处,均与精确值保护无关 —— `limitDepth` 深度截断 `{...}`/`[...]`(体积截断,`jsonUtils.ts:102`)、UI input `placeholder`(`createChatSdk.ts:313`)、`useChat` 流式 assistant 占位(`useChat.ts:101`)。
- **workingMemory 只保 path/hash**:`workingMemory.ts:12-13` pin locatedPaths/lastHashes 到 augmentPrompt → 定位信息跨压缩;但**不保精确值本身**(值在消息流里,随压缩丢)。
- **offloadLargeResult 单向**:`utils/offload.ts` 把 >6000 字符结果转 vfs 引用 + 预览,读侧单向;不覆盖「中等长度精确值」且无写侧强制。
- **vfs 三池是现成「外存 + 淘汰」基建**:`vfs.ts:31-33,80-121` large_results 4MB / drafts 2MB / userFiles 2MB,池内 LRU + 字节水位,`poolBytes` 可配 —— 资源池直接复用,零新后端。
- **写链无「冻结/原样」概念**:`commitSetToBind`(`dataOps.ts:112`)/`applyPatchesToBind`(`:160`) 按 schema 白名单 + merge,保护「未声明字段」,不保护「声明但需精确保存」字段。

## 2. 设计总览

```
┌─ read 侧(read/read 子路径)───────────────┐
│  受保护路径 → 占位符(精确值不入 LLM 消息流)  │
│  freeze   → ⟦frozen:<path>⟧              │
│  verbatim → ⟦res:<handle>⟧(懒注册入库)     │
└─────────────────────────────────────────┘
┌─ 写侧(commitSetToBind / applyPatchesToBind)┐
│  freeze 路径被改        → FROZEN_FIELD 拒绝 │
│  verbatim 句柄          → 展开回原值        │
│  verbatim 新值 ≠ 原值   → VERBATIM_MISMATCH │
│  未知句柄               → RESOURCE_NOT_FOUND│
└─────────────────────────────────────────┘
┌─ 资源存储(vfs 第四池 resources)─────────────┐
│  懒注册 / resource_* 工具 / 显式释放 /      │
│  LRU+字节 / RESOURCE_EVICTED 淘汰检测      │
└─────────────────────────────────────────┘
┌─ 跨压缩 pin(augmentPrompt 注入资源清单)─────┐
│  path→mode→handle 每轮重建(不调 LLM),      │
│  同 workingMemory/mission,state 天然跨压缩  │
└─────────────────────────────────────────┘
```

**关键不变式**:bind 恒持原始值,占位符只在**读渲染层**与**写提交层**做变换,永不落 bind。→ hash(A3 惰性)/A4 子路径 hash/快照(A2)/clone/checkpoint 全部零干扰。

## 3. P0 · 冻结字段(freeze)

```ts
// createChatSdk data 配置(新)
data: {
  schema, bind,
  resources: [
    { path: 'id',                       mode: 'freeze' },
    { path: 'createdAt',                mode: 'freeze' },
    { path: 'components.0.verification', mode: 'verbatim' },
  ],
}
```

**读侧**(dataOps read 子路径分支,`dataOps.ts:288-300` 扩展;**仅结构化读 read/describe/get_data 替换**,query/search 显式查询、eval 沙箱返真值由写侧强制兜底,见 §7c A1):
```ts
function renderValue(jp: string, val: unknown): string {
  const res = resourcesByPath.get(jp)
  if (res?.mode === 'freeze') return `⟦frozen:${jp}⟧`              // 值不入 LLM 流
  if (res?.mode === 'verbatim') return `⟦res:${ensureResource(jp, val)}⟧`  // 懒注册:当前 bind 值入库 → 句柄
  return safeStringify(val)
}
```
- 冻结值**不入 LLM 消息流** —— 从源头杜绝「幻觉记错再写回」。LLM 确需真值时显式 `resource_get`(该次读结果仍可能被压缩,但句柄 pin 保底 + 可再取)。
- 匹配规则:`resourcesByPath` 归一化 jsonPath,精确路径或前缀匹配。

**写侧强制**:
```ts
// commitSetToBind(整体 set/merge):merge 后显式校验冻结路径未被改
for (const [path, mode] of resources) {
  if (mode === 'freeze' && !isEqual(getByPath(effValue, path), getByPath(bindRef, path))) {
    return toolError({ code: 'FROZEN_FIELD',
      message: `字段 "${path}" 已冻结,不可修改`,
      hint: '该字段由系统/集成方维护,LLM 不得改动' })
  }
}
// applyPatchesToBind(增量 patch):patch 目标命中冻结路径(前缀匹配)→ FROZEN_FIELD
```

## 4. P1 · verbatim 原样保留

- **读侧**:verbatim 路径值 → `⟦res:<handle>⟧`,原值懒注册进资源池(首次 read 自动)。
- **写侧**:
```ts
function expandHandles(value: unknown, verbatimPaths: string[]): unknown {
  // 定点展开:仅沿 verbatim 受保护路径 getByPath 定位 → 检查该位值是否为句柄串 → 查资源池返回原值
  // 非受保护路径完全不碰 → 无误展开(防真实字符串恰好以 ⟦res: 开头)+ 成本 O(受保护路径数) 非 O(全树),见 §7c A2
  // 池中缺失 → RESOURCE_EVICTED;未知句柄 → RESOURCE_NOT_FOUND
  // **D1 自愈**:句柄在但「池值 ≠ bind 当前值」(restore/setData/importData/外部改 bind 的漂移)→ 以 bind 当前值为准
  //   自动重注册(句柄不变,值更新),按「未改」放行 —— 防展开旧值把刚回退/导入的新值覆盖掉
}
// commitSetToBind:先 expandHandles(定点)再走 schema 校验 + merge
// verbatim 路径写「非句柄的新值」且 ≠ 原值:
if (mode === 'verbatim' && !isEqual(newVal, stored)) {
  return toolError({ code: 'VERBATIM_MISMATCH',
    hint: '该值 verbatim 保护(精确原样),要改请先 resource_update,再写回句柄' })
}
```
- 语义:LLM 不需要重打长精确串(省 token + 防错字);改值走显式 `resource_update` 通道。

## 5. P1 · 资源存储与生命周期

**vfs 第四池**:
```ts
// vfs.ts
type VfsPoolKey = 'large_results' | 'drafts' | 'userFiles' | 'resources'
const DEFAULT_POOL_BYTES = { large_results: 4MB, drafts: 2MB, userFiles: 2MB, resources: 4MB }
```
(池内 LRU + 字节水位复用现状;`poolBytes.resources` 可配。)

**资源工具**(`tools/resources.ts`,advanced 暴露):
```ts
resource_get({ path|handle })     → 实际值(有 path 无资源 → 按当前 bind 值即时生成并入库)
                                  // 仅接受受保护路径(§7c E2:防 LLM 拿它把任意路径值塞进资源池)
resource_update({ path, value })  → verbatim 才可改;freeze → 拒绝
                                  // 同时标 dataOps 脏(§7c D2:防 checkpoint 快照内池≠bind)
resource_list()                   → [{ path, mode, handle, bytes }]
resource_delete({ path|handle })  → 显式释放(后续 read 再懒注册)
```

**SDK API**(经 createDataOps controller 同闭包,零桥接):
```ts
sdk.createResource(path, value?) / getResource / updateResource / deleteResource / listResources / releaseResources({ paths? })
```

**装配(opt-in)**:`createDataOps` 解析 `data.resources` 非空时,向返回工具数组**追加** `resource_get/update/list/delete`(与现有 controller 同闭包,工具运行时即时生效);`selectBuiltinTools`/toolsets **不动**(不静态装配)→ 未配置 `data.resources` 的用户工具面零变化。

**统一提交链强制层**:freeze/verbatim 强制做成 `commitSetToBind`/`applyPatchesToBind` 内的一个**前置层**(非独立写路径)→ `write`/`edit_data`/`delete_data`/`draft_commit`/`eval_script`(transform)全部天然覆盖;`write({dryRun})` 也走强制(预检同样拦冻结/verbatim 违规)。

**生命周期矩阵**:
| 事件 | 行为 |
|---|---|
| 首次 read 受保护路径 | 懒注册:当前 bind 值入库 → 返回句柄 |
| `setData` 替换 | 清空 resources(路径可能失效;与快照/hash 重置一致) |
| `importData` 替换 | 不清空 resources(§7c F2);bind 被直改 → 下次写侧展开走 **D1 自愈**(比对 bind 当前值重注册) |
| checkpoint save/restore | 随 vfs 天然保存/恢复(resources 池在 vfs 内) |
| dataOps 快照/restore | 不受影响(bind 恒持原始值,占位符只在读写边界) |
| 池 LRU 淘汰 | **读侧自愈**(重新懒注册,新句柄);**写侧**展开句柄时 `RESOURCE_EVICTED`(原值不可知,提示重注册),见 §7c A3 |
| 显式释放 | `resource_delete` / `sdk.releaseResources` |

## 6. P1 · 跨压缩 pin

```ts
// augmentPrompt 追加段(在 workingMemory 之后;数据源=资源清单,不调 LLM)
## 受保护资源(跨压缩保留)
- id (freeze) ⟦frozen:id⟧
- components.0.verification (verbatim) ⟦res:a1b2c3⟧
```
- 数据源:资源闭包 map(path→mode→handle)直接生成,零 LLM 调用。
- 机制与 workingMemory/mission 相同:在 state 不在 `AgentMessage[]` → `compressInput` 不碰 → 天然跨压缩,无需改 summarization。
- 压缩后 LLM 仍知「哪些字段被保护 + 句柄」→ 不会误改;需真值 `resource_get`。

## 6b. P1 · 配套内置 skill 与 usageHints(LLM 可达性)

**新内置 skill `precise-value-protection`**(入 npm `skills/` 分发,仿 `adaptive-planning` 结构):
```markdown
# precise-value-protection
识别「需精确保存的字段」:id / hash / 长 verbatim 串 / 关键配置
- read 返回 ⟦frozen:<path>⟧ / ⟦res:<handle>⟧ → 这是占位符,精确值在冻结区/资源池
- 确需真值:resource_get({path|handle})
- 冻结字段(freeze)不可修改 → 撞 FROZEN_FIELD 即放弃改动该字段
- verbatim 字段:写回句柄 ⟦res:<handle>⟧;要改新值先 resource_update 再写句柄
- 撞 VERBATIM_MISMATCH → 先 resource_update;撞 RESOURCE_EVICTED → 重注册
- 撞 RESOURCE_NOT_FOUND → 句柄失效,重新 read 触发懒注册
```

**usageHints 补丁**(按 `rc.xxx` 分段,`usageHints.ts`):
- data 段(`hasDataOps` 分支):「受保护路径(配 `data.resources`)read 返回占位符 `⟦frozen:path⟧`/`⟦res:handle⟧`;冻结字段不可改;verbatim 要改先 `resource_update` 再写回句柄;需真值 `resource_get`;撞 `RESOURCE_EVICTED` 重注册」。
- draft 段(`rc.draftWrite`):「draft_commit 提交后仍过 freeze/verbatim 强制,受保护字段一样不能改/要改先 update」。
- eval 段:「transform 结果含受保护路径 → 同样走强制(冻结拒绝 / verbatim 展开)」。
- write 段:「dryRun 也走强制,预检即拦」。

## 7. 边界与交互

- **bind 恒原始值** → hash(A3 惰性)/A4 子路径 hash/快照(A2)/clone/checkpoint 全不受影响(占位符是渲染层/提交层变换,不落 bind)。A4 的 `subHash` 对原始 bind 计算,天然兼容。
- **draft C1 多草稿 merge**:合并结果仍过 freeze/verbatim 强制(共用 `commitSetToBind` 提交链)。
- **schema 投影**:正交 —— 投影管「隐藏未声明字段」,resources 管「保护已声明敏感/精确字段」。
- **offloadLargeResult**:正交 —— 自动·超大·读侧单向;resources 是声明式·精确·双向。
- **`interceptors.read`(脱敏)**:可与 resources 叠加(先资源替换再脱敏,或反之);文档说明顺序。
- **乐观锁**:冻结/verbatim 路径仍参与整体 hash / A4 subHash(原始值),不因占位符改变冲突语义。
- **匹配规则(段边界)**:freeze 前缀匹配按 jsonPath **段边界**(`components` 命中 `components.0.key`,不误伤 `componentsA`),selftest 锁死。
- **handle 派生**:`⟦res:<path 短哈希>⟧`(路径派生),值变句柄不变 → 跨轮稳定,update/淘汰重注册后句柄不漂移,并发懒注册无双写漂移。
- **verbatim 无值**:受保护路径在 bind 中不存在 → 懒注册 skip(不注册 undefined),写撞 `RESOURCE_NOT_FOUND` 提示「该字段不存在」。

## 7c. 实施前审查结论(2026-08-04,锁死)

> 评审发现 3 架构缺口 + 4 语义细节 + 3 写回/删除边界(C1-C3)+ 2 数据一致性漏洞 + 3 实现偏差(D/F),已同步进 `doc/placeholder-protected-rw.md` §8。

| # | 缺口/细节 | 结论(锁死) |
|---|---|---|
| A1 | 占位符替换仅覆盖 `read`,get_data/describe/query/search/history/diff/eval 返真值 | 替换仅作用于**结构化读**(read/describe/get_data);query/search 显式查询、eval 沙箱返真值,**写侧强制兜底**(改冻结照拒/verbatim 新值照拒)。「值不入消息流」收紧为「结构化读默认不泄露;显式查询/沙箱可读真值」 |
| A2 | expandHandles 全局深遍历 → 误展开 + 大 JSON 全树成本 | 改**沿 verbatim 路径定点展开**(getByPath 定位 → 检查句柄串 → 替换);非受保护路径不碰 |
| A3 | 淘汰读侧报错不合理 | **读侧自愈**(懒注册重建,新句柄);**写侧**展开时资源缺失才 `RESOURCE_EVICTED` |
| B1 | freeze 前缀匹配需段边界 | 按 jsonPath 段边界匹配,selftest 锁死 |
| B2 | handle 派生规则未定 | **路径派生短哈希**,值变句柄不变(update/淘汰后不漂移) |
| B3 | setData 清空 vs checkpoint restore 时序 | restore 后旧句柄撞 `RESOURCE_NOT_FOUND` 走懒注册自愈,文档写明 |
| B4 | verbatim 路径无值懒注册什么 | skip(不注册),写撞 `RESOURCE_NOT_FOUND`「字段不存在」 |
| C1 | 整体写回时 LLM 把占位符**原样带回**,强制层须识别为「未修改」;「merge 天然保留冻结值」不成立 | 整体 set 前置**沿受保护路径 normalize**:freeze 回显 `⟦frozen:path⟧` → **跳过保留当前值**(safeMerge 顶层浅合并不跳过,不显式做会把占位符字符串写进 bind 或误报 FROZEN_FIELD);verbatim 回显 `⟦res:handle⟧` → 定点展开回原值(等于未改)放行;verbatim 写原值(经 resource_get 拿到)视为未改放行;verbatim 写新值≠原值 → VERBATIM_MISMATCH;freeze 写新值≠当前 → FROZEN_FIELD。normalize 是 A2 定点展开的三态扩展(展开/保留/拒绝),仍非全局深遍历 |
| C2 | 批量 patch 原子性有,但失败无定位 → LLM 整批重试烧 token | 强制层失败**沿用 `patches[i]` 定位约定**(如 `patches[2] @ components.3.props.copy: VERBATIM_MISMATCH,需先 resource_get/update`),LLM 精准自纠 |
| C3 | `op:'remove'`/`write({del:true})` 走 deleteByPath 分支,现强制层(FROZEN_FIELD/VERBATIM_MISMATCH 只在 patch set/merge 时比对)**拦不住静默删受保护字段** | 锁死:freeze 路径 remove/delete → `FROZEN_FIELD`;verbatim 路径 remove/delete → 默认**拒绝**(要删先 `resource_delete` 释放再删,或视作改值引导先 resource_update)。**容器 op(merge/append)同样统一**:patch 目标命中受保护路径 → 一律按 mode 处理,与 op 无关(E1) |
| D1 | **verbatim 池值 vs bind 当前值漂移**(restore_data 回退 / importData 替换 / setData 替换 / 外部直改 bind 均为漂移源;池存旧值,展开会覆盖回旧值) | 写侧展开句柄时**比对「池值 vs bind 当前值」**:不等说明 bind 被非资源感知路径改过 → **以 bind 当前值为准自动重注册**(句柄不变,值更新)按「未改」放行。覆盖 restore/setData/importData/外部改 bind 四源,与读侧懒注册自愈同哲学。**乐观锁拦不住该时序**(LLM 在漂移后重新 read 即过 hash) |
| D2 | **checkpoint 增量 × 资源池版本不一致**:resource_update 只改池不改 bind → save 时 vfs 脏(池新值入库)但 bind 用 lastBindClone(旧值)→ 快照内池≠bind → restore 后即 D1 漂移 | `resource_update` 同时标 dataOps 脏(或 checkpoint save 把「池与 bind 同版本」纳入判断),保证 checkpoint 内池与 bind 始终同版本 |
| F1 | **eval transform 整体替换不走 commitSetToBind**(`dataOps.ts:578-596` 内联 safeParse+safeMerge/restoreInPlace,独立第三条落地路径)→「统一前置层六路径全覆盖」不成立 | 强制层抽**独立函数**,在 commitSetToBind / applyPatchesToBind / eval 整体替换**三处调用**(或重构 eval 整体替换复用 commitSetToBind);§7b 矩阵「eval transform 归整体写」表述修正 |
| F2 | importData(`createChatSdk.ts:1802` restoreInPlace 直改 bind)是另一条落地路径,且为 D1 漂移源 | 集成方调用不走强制层可接受;生命周期矩阵补「importData 替换 bind 后资源池不清空,写侧展开自愈(D1)兜底」 |
| F3 | vfs 池键名不一致:design 写 `large_results`,实现是 `largeResults`(`vfs.ts:24`) | 实施统一用 `resources`(新池键),勿照 design 写错 |

## 7b. 局部读写校验矩阵(每次读写对应的校验点)

> 用户诉求(2026-08-04):「每次局部读写是否有对应的校验」→ 明确方案下每次读写的校验点,补进规划锁死。

| 操作 | 校验层(执行顺序) | 新/现有 |
|---|---|---|
| **局部读** `read({jsonPath})`(仅结构化读) | ① `isUnsafePath`(PATH_UNSAFE)② `isPathAllowed` 逐段(PATH_DENIED)③ **freeze/verbatim 占位符替换**(结构化读值不入消息流;query/search/eval 返真值由写侧兜底)④ subHash(A4) | ①-② 现有;③-④ 新 |
| **局部写 patch** `edit_data` / `write({patch})` / `write({patches})` | ① 路径校验(isUnsafePath+isPathAllowed)② `applyPatchToClone`(PATCH_FAILED)③ **强制层:freeze 前缀→FROZEN_FIELD / verbatim 句柄→expandHandles→原值 / 新值≠原值→VERBATIM_MISMATCH / 未知句柄→RESOURCE_NOT_FOUND / remove·delete 受保护路径→拒(§7c C3)** ④ `schema.safeParse` 整体(SCHEMA_INVALID)⑤ 乐观锁(VERSION_CONFLICT)⑥ 快照。批量失败带 `patches[i]` 定位(§7c C2),原子性天然(全过才 applyLive) | ①-⑥ 现有;③ 新(插 ② 后 ④ 前) |
| **整体写** `write({value})` / `set_data` / `draft_commit` / `eval transform` | ① 沿受保护路径 **normalize 回显识别**(§7c C1:freeze 回显→跳过保留当前值 / verbatim 回显→展开原值 + **D1:展开时比对池值 vs bind 当前值,不等以 bind 为准重注册**)② schema 白名单路径 ③ merge(未声明字段保留)④ **强制层**(同 patch)⑤ schema 整体校验 ⑥ 乐观锁(A1 补 draft_commit)⑦ 快照。⚠ **eval transform 整体替换是独立落地路径**(`dataOps.ts:578-596` 内联 safeParse+safeMerge,不走 commitSetToBind),强制层须在**三处**调用(F1) | ①-⑦ 现有(A1 新);①④ 新(F1 修正 eval 归整体写表述) |
| **eval 子树** `eval_script({jsonPath})` | transform 结果 → 子树模式:③ 强制层 → ④ 整体校验(子树替换 / patches) | ③ 新 |
| **draft 分块** `draft_write` | append 后预检(B1:DRAFT_FRAGMENT_INVALID);最终 commit 走「整体写」行 | B1 新 |

**强制层位置(关键)**:verbatim 句柄须在 schema 校验**之前**展开(否则句柄字符串被当真实值校验,类型不符);freeze 校验在 merge/apply **之后**(比对目标路径当前值);整体写回显识别(§7c C1)在 schema/merge **之前**(先把回显占位符 normalize 成「未改」再进校验链,防占位符字符串落 bind);展开句柄时做 **D1 池值一致性自愈**(以 bind 当前值为准)。**强制层须为独立函数,在 commitSetToBind / applyPatchesToBind / eval transform 整体替换 三处调用(§7c F1)** —— eval transform 整体替换是内联独立路径(`dataOps.ts:578-596`),不归 commitSetToBind,单放 commitSetToBind 会漏它。统一三处调用 → 全部写路径全覆盖,**不新增独立写路径**。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 看到 ⟦frozen⟧ 不知值,推理受阻 | `resource_get` 显式取真值;freeze 通常用于 LLM 无需知道值的字段(id/hash/ts) |
| verbatim 句柄被压缩掉 | 资源清单 pin 每轮重建;句柄是稳定短串 |
| 懒注册在 bind 已有旧值时过期 | 首次 read 注册当前值;外部改值由乐观锁(hash)兜底 |
| resources 池淘汰误删重要 verbatim | 默认 4MB 大;RESOURCE_EVICTED 显式报错可重注册;集成方按需配大 |
| setData 清空资源误伤 | 文档说明;集成方 setData 后重新 read 触发懒注册 |
| 冻结字段被前缀匹配误伤 | 匹配规则精确路径或明确前缀,测试锁死边界 |

## 9. 关键实现文件

| 文件 | 改动 |
|---|---|
| `src/core/tools/dataOps.ts` | read 占位符替换;commitSetToBind/applyPatchesToBind 冻结/verbatim 强制;懒注册 |
| `src/core/tools/resources.ts` | 资源工具(resource_get/update/list/delete) |
| `src/core/backends/vfs.ts` | 第四池 `resources` + VfsPoolKey 扩 |
| `src/core/harness/workingMemory.ts`(或新 resourcesPin) | 资源清单 augmentPrompt pin |
| `src/core/types/index.ts` + `types/index.d.ts` | `data.resources` / `maxResourceBytes` / 资源工具参数 |
| `src/core/sdk/createChatSdk.ts` | data 配置解析 resources;SDK 资源 API |
| `src/core/index.ts` | 若导出资源工具/resource API 则同步 |
| `skills/precise-value-protection/SKILL.md` | 新内置 skill(入 npm `skills/`);skills 中间件索引自动收录 |
| `skills/page-agent-sdk-integrate/references/api.md` | 补 `data.resources` 配置说明(公开分发同步) |
