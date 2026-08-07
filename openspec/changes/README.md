# 活跃 Changes 优先级索引

> 12 个活跃 change 的**优先级 / 依赖 / 批次组织**。change 归档或新增时同步更新本表。
> 评估日期:2026-08-06。已归档 change 见 `archive/`。
> `project.md`「进行中的 change」给一句话概览,本文件给**可执行的推进顺序与依赖约束**——两者不重复。

## 全景盘点

| change | 类型 | 严重度 | 工作量 | 风险 | 碰写链核心? |
|---|---|---|---|---|---|
| **fix-write-safety-bypass** | 安全逃逸(edit 写回绕白名单 + DSML 执行示例) | 🔴 P0 | S | 低 | ✅ applyPatchesToBind + commitSetToBind |
| **harden-large-json-write** | 安全+正确性+性能(A1 draft_commit 乐观锁 / A4 子路径 hash / A2-A3,B1-B2,C1-C2) | 🔴 P0(A1/A4)/🟡 P1(其余) | M-L | 中 | ✅ draft_commit + read hash |
| **placeholder-protected-read-write** | 精确值保护(freeze/verbatim + vfs 第四资源池 + 跨压缩 pin) | 🟡 P1 | L | 中 | ✅ 强制层注入 commit/apply/eval 三处 |
| **arch-review-p1-fixes** | 架构债 6 项(wrap-up 绕中间件 / 并发 state / beforeReturn 门禁 / subagent 工具快照 / switchSession 重置 / setMission 重捕) | 🟠 P1 | M | 中 | ❌(改 createAgent/createChatSdk) |
| **session-history-management** | 会话历史管理(listSessions/deleteSession/sessionId 对外暴露 + checkpoint 切会话残留修复 + onClear 发事件) | 🟡 P1(S1 bug)/🟢 P2(API) | S-M | 低 | ❌(改 switchSession/onClear 重置 + 新增 return API;接续 arch-review P1-5 同段代码) |
| **tool-name-collision** | 工具重名覆盖语义(装配期 dedupe + removeTool 可删内置) | 🟠 P1 | S | 低 | ❌ |
| **context-inspector** | 上下文构成面板(大小/分类/占比,DebugDrawer tab + 常驻进度条) | 🟢 P2 | M | 低 | ❌ |
| **focus-context** | 上下文聚焦·指定组件精修(strict 写拦截 + 三触发) | 🟢 P2 | M | 中(wrapToolCall 拦写) | ⚠️ wrapToolCall 拦写工具 |
| **agent-driven-compression** | 压缩自决策(inspect_context + CompressDecision) | 🟢 P2 | M-L | 中(烧 token,opt-in) | ❌ |
| **skill-external-scripts** | skill 执行器(exec 钩子 + 附带 tools,host opt-in) | 🟢 P2 | M | 高(host 执行安全) | ❌ |
| **simplify-toolset** | 工具面精简(移除被覆盖的 snapshot_data/list_data_snapshots/get_data + vfs_rm) | 🟢 P2 | S-M | **高(破坏兼容)** | ❌ |
| **chatdialog-component-split** | ChatDialog 原子化重构(785 行拆 8 区块 + 6 消息子件 + slot/sections) | 🟢 P2 | **L** | **高(785 行重构 + scoped CSS 跨边界)** | ❌ |

> 工作量:S ≈ 1-2 天 / M ≈ 3-5 天 / L ≈ 1 周+。「碰写链核心」= 是否改 `commitSetToBind`/`applyPatchesToBind`/写回取值,改的必须串行(见下)。

## 🔴 最关键约束:写链三件套必须串行

下列三个 change **都在改 `commitSetToBind` / `applyPatchesToBind` 同一段代码**,不能并行,否则 merge 地狱:

```
fix-write-safety-bypass   →   harden-large-json-write   →   placeholder-protected-read-write
(修写回取值源 res.data)        (A1 乐观锁 + A4 subHash)        (注入 freeze/verbatim 强制层)
```

- **fix-write-safety 必须最先**:它改的是「applyPatchesToBind 写回 `res.data` 而非原始 `pVal`」—— 写链正确性地基。不先修,后两个在沙地上盖楼。
- **harden A4 必须次之**:给 read 加 `subHash`、写加 `expectedSubHash`;placeholder 的 design 已假设它存在(design.md「与 A4 子路径 hash 天然兼容」)。
- **placeholder 必须最后**:在 fix 修正过的取值源上才能正确放 C1 normalize / freeze 比对;且强制层要在 harden 的乐观锁**之前**插入,顺序倒了就要重写。

> ⚠️ 这条依赖链在各自 proposal 里隐式提到彼此,但**之前未显式排出执行顺序**——是本索引要锁死的第一件事。

## 依赖链与并行集

```
写链串行链(硬依赖,不可并行):
  fix-write-safety ─→ harden(A1/A4) ─→ placeholder

context 链(软依赖):
  context-inspector ─→ agent-driven-compression(复用 analyzeContext 数据源)

UI 块(互补,各自先做内置 prop 版可并行,chatdialog-split 后挪 slot):
  chatdialog-split ↔ focus-context(焦点条) ↔ context-inspector(进度条)

完全独立、随时可插队:
  arch-review-p1-fixes(P1-5 已提交)/ tool-name-collision / skill-external-scripts / simplify-toolset / session-history-management(接续 P1-5 改 switchSession/onClear 同段,已在干净底座)
```

## 推进批次

**批次 0 · 立即(P0 安全,独立 patch 发布)**
- `fix-write-safety-bypass` —— edit 写回绕白名单 + DSML 执行示例,两处都是默认路径暴露。最小改、向后兼容(安全收紧),建议 bump patch 单独发。

**批次 1 · 写链正确性(P1,紧跟批次 0)**
- `harden-large-json-write` 的 **A1**(draft_commit 乐观锁)+ **A4**(子路径 hash)—— 安全+正确性必修。
- A2/A3/B1/B2(性能/体验)可同批;**C1/C2**(多草稿合并、子树 patches)降级 P2,可选。
- 完成后写链稳定,解锁 placeholder。

**批次 2 · 架构债 + 工具语义 + 会话管理(P1,与批次 1 完全并行)**
- `arch-review-p1-fixes`(6 项可分批 commit,不碰写链核心;P1-5/P1-6 已提交,余 P1-1/2/3/4 推后)
- `tool-name-collision`(小、明确、向后兼容)
- `session-history-management`(Phase 1 checkpoint 修复接续 P1-5 同段;Phase 2-3 会话 API + onClear 事件,向后兼容;Phase 4 title 编辑/demo 可选)

**批次 3 · 能力增强(P2,按依赖与人力安排)**
- `placeholder-protected-read-write`(批次 1 完成后)
- `context-inspector` → `agent-driven-compression`(前者先行)
- `focus-context`(可独立,或并入 chatdialog-split 后做 slot 版)
- `skill-external-scripts`(host 执行默认关,安全可控)
- `simplify-toolset`(⚠️ 唯一破坏兼容的,建议放最后,先发 deprecated warn 一版再移除)
- `chatdialog-component-split`(独立大重构,工作量最大、风险最高,建议单独 milestone)

## 风险点

1. **写链三件套代码冲突最密** —— fix 与 placeholder 都改 `applyPatchesToBind` 写回段;务必 fix 先合,placeholder 在 fix 之后的干净底座上加强制层,否则 C1 normalize 与「写回 res.data」逻辑互相覆盖。
2. **simplify-toolset 是唯一硬破坏兼容的** —— 即使标 deprecated,移除 `get_data`/`snapshot_data` 仍可能断集成方。建议先发一版「deprecated warn」,观察后再移除,不要一步到位。
3. **chatdialog-split 风险最高** —— 785 行单文件拆 8 区块 + scoped CSS 跨边界归属(`.message-row.assistant:hover .msg-actions` 这类祖先选择器拆分后失效)。建议单独 milestone,每步迁移用既有 browser spec 锁契约。
4. **arch-review P1-2(并发 state 竞态)** —— proposal 自标「真缺陷只在并发 shareContext 双视图/headless 双发,顺序跨 send 安全」。优先级可降,不必卡批次 2 先行。

## 维护约定

- change **归档**(移入 `archive/`)→ 从本表删除,在 `archive/` 留底。
- change **新增** → 加本表一行 + 归入对应批次;若碰写链核心,务必检查与写链三件套的串行关系。
- 评估结论变化(优先级 / 依赖)→ 更新本文件 + 同步 `project.md`「进行中的 change」段的一句指向。
