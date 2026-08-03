# Tasks: checkpoint-incremental-snapshot (P1 perf)

> 关联 `proposal.md`。**✅ MVP(Phase A)完成 2026-08-03**:vfs+bind 脏标记增量,省每轮深拷贝。messages 保持整体 clone(Phase B 单独评估,正确性优先)。

## Phase A — vfs 脏标记(最大头 8MB,省最多)
- [x] `backends/vfs.ts`:VfsStore 加 `_dirty`(初始 true);Proxy set/deleteProperty handler 置脏(**统一捕获 vfsWrite/vfsEdit/vfsJsonPatch/offload 所有 store.files[k]=,零遗漏**);hydrate/clear(raw 绕过 Proxy)手动置脏;导出 `consumeDirty()`(读后清)+ `isDirty()`
- [x] `harness/checkpoint.ts` save:`vfsStore.consumeDirty()` 脏或 `lastVfsClone===undefined` 才 clone 新基线 + 缓存,否则复用(闭包 lastVfsClone)
- [x] `harness/checkpoint.ts` restore:重置 lastVfsClone(测试驱动:restore 改 vfs 虽经 Proxy 标脏,重置双保险)
- [x] **正确性测试**(sec-17 块 A):consumeDirty 读后清/未变轮共享 clone 引用/写后新 clone/restore 到未变轮 vfs 正确
- [x] 边界:importStack 后重置 lastVfsClone(防恢复栈与缓存基线不一致)

## Phase A — bind 脏标记
- [x] `tools/dataOps.ts`:DataOpsController 加 `markDataDirty`/`consumeDataDirty`(初始脏 true);全写路径标脏 —— set_data/write(set)/draft_commit 经 `commitSetToBind` 新增 `onWrite` 回调(dryRun 不触发);edit_data/delete_data/restore_data/handleConflict·restore 成功后;eval_script transform 3 模式(子树/patches/整体);write(del/edit·patches);controller.set·update 内置;importData 经 controller.markDataDirty
- [x] `harness/checkpoint.ts` save:`consumeDataDirty` 脏或缓存空才 clone(无 controller 返 true=整体 clone 向后兼容);windowProps 旧模式(slotPaths)不增量
- [x] **正确性测试**(sec-17 块 B/C):各写路径标脏 + dryRun/只读不标 + 跨轮 restore 一致性
- [x] 边界:`sdk.setData` 运行时替换 bind → controller.set 标脏(下次 save 必 clone 新基线)

## Phase A — 验证
- [x] 全测绿:selftest **1030→1055** + e2e 283 + browser 25(nested-demo checkpoint 回滚场景2 不破)
- [x] 跨轮 restore 一致性测试(sec-17 块 C):写→save→写→save→restore(id1)→restore(id2)→restore(id3)→bind/vfs 数据一致 + restore 后 save 基线重建(**测试驱动发现并修复 restore 不重置增量基线 bug**)
- [ ] 性能对比(可选 bench):大 JSON(几百 K)vfs 长任务,save clone 次数下降 —— 留 TODO;perf 改动对外行为不变,正确性靠 sec-17 跨轮 restore 覆盖

## Phase B — messages 结构共享(险,单独评估,可能不做)
- [ ] 评估 summarization splice 与快照 length 基线冲突 → 决定清栈 or 放弃 messages 增量(MVP 不做,正确性优先)
- [ ] (若做)save 记 length 不 clone;restore truncate+push 增量;summarization 触发清栈
- [ ] 极限测试:压缩后 restore / 多次压缩后 restore

## 文档
- [x] CLAUDE.md 架构要点(checkpoint 段)补「脏标记增量」
- [x] CHANGELOG [Unreleased] Performance + Tests 段
