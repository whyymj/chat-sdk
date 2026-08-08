# Tasks: harden-large-json-write(大 JSON 写入链路加固)

> 关联 `proposal.md`。**独立 change**,无前置依赖。
> **状态(2026-08-08 收尾归档):A1 + A5 完成并随版本发布(selftest sec-41 冲突白盒 + usageHints 轮次提示 + types/CLAUDE.md 文档);A2/A3/A4/B1/B2/C1/C2 评估后**永久推后**(见末尾「推后清单」)。e2e draft 冲突路径 / usageHints 字符串精确断言永久推后(selftest 已白盒覆盖核心逻辑,e2e FAKE_LLM 不构造 draft 累积无法触发冲突场景)。change 移入 `archive/`。**

## P0 · A1 draft_commit 乐观锁(安全缺陷)✅
- [x] `draft_commit` 工具参数加 `expectedHash?`;写前 `handleConflict('set', effHash)`(autoLock 用 lastReadHash)
- [x] 冲突 → 与 set/edit 一致(触发 pendingConflict 人工介入 / 返回 VERSION_CONFLICT),不静默覆盖
- [x] 顺序:parse 先(草稿非法 JSON_INVALID 早返回,不浪费冲突介入)→ handleConflict → commitSetToBind
- [x] selftest(sec-41):冲突触发 onConflict 介入(keep_external 不覆盖)+ 草稿保留 / 无 onConflict → VERSION_CONFLICT / 无冲突正常写(3 场景 7 断言)
- [x] e2e:draft_commit 冲突路径 —— **永久推后**(selftest sec-41 白盒覆盖核心;e2e FAKE_LLM 不构造 draft 多轮累积,无法触发冲突场景)

## P1 · A5 round 预算提示 ✅
- [x] usageHints draftWrite 段补「大 JSON 多轮工具调用,默认 maxToolRounds=10 可能触顶,建议 ≥20」+ draft_commit 走乐观锁提示
- [x] **不做自动放大**(改默认影响全局,零行为变化)
- [x] createChatSdk 类型注释补 `maxToolRounds` 大 JSON 建议值(types/index.d.ts 主选项 + 子 agent 两处)
- [x] selftest:usageHints draftWrite 段含轮次提示 —— **永久推后**(usageHints 字符串精确断言脆弱,改一字即挂;A5 已在 types 注释 + CLAUDE.md 体现,归文档验证)

## ⏸ 推后清单(评估有疑问/更好建议,永久推后)

| 项 | 推后理由 / 更好建议 |
|---|---|
| **A4 子路径 hash** | 改动面大(read 返回 + handleConflict scopePath + 4 工具 expectedSubHash + types + 文档);**与 placeholder-protected-read-write 强耦合**(placeholder design 多处依赖 A4),先做可能被 placeholder 乐观锁重设计推翻 → 与 placeholder 协同评估 |
| **A2 快照字节上限** | estimateJsonBytes 用 JSON.stringify 长度 = 每次快照多一次 O(n) 序列化(快照本就 deepClone)双倍成本 → 需优化估算方案(复用 deepClone 序列化结果 / 节点数近似) |
| **A3 惰性 hash** | design 自标「缓存污染 safeStringify」自引用风险,需 Object.defineProperty 不可枚举 / WeakMap,复杂有 bug 风险 → 性能优化非正确性,大 JSON 场景才需 |
| **B1 draft 中间校验** | scanBalance 括号/引号平衡轻量扫描正则需谨慎设计 → 细节多 |
| **B2 DRAFT_EVICTED** | **实现障碍**:vfs LRU 淘汰不留记录,无法区分「从未存在」vs「被池淘汰」,design 假设能检测但 vfs 无数据支撑。DRAFT_TOO_LARGE(draft_write 超限)可单独做,B2 整体重新评估 |
| **C1/C2** | P2 能力增强,非必需 |

## 提示同步(usageHints + skill)
- [x] usageHints draftWrite 段补 draft_commit 走乐观锁提示(随 A1)
- [x] 其余(DRAFT_FRAGMENT_INVALID/TOO_LARGE/EVICTED + merge + eval 子树 patches)**随各推后项**(A2/A3/A4/B1/B2/C1/C2,见推后清单)

## 文档
- [x] CLAUDE.md draft 段补 A1(乐观锁)+ A5(轮次建议)+ 推后项指向 archive
- [x] CHANGELOG [Unreleased]:A1 + A5 记录

## 全量回归
- [x] `npm run build` + `npm test`(1119)+ `npm run test:e2e`(286)全绿(A1/A5 发布时)
- [x] 计数同步:CLAUDE.md / README 中英 / doc README(1112→1119)
- [x] 归档:A1/A5 已发布 + 推后项决策完成 + 文档补齐,移入 `archive/`
