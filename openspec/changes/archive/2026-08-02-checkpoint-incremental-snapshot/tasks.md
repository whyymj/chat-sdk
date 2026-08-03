# Tasks: checkpoint-incremental-snapshot (P1 perf)

> 关联 `proposal.md`。**风险高(restore 正确性),逐 Phase 推进,每 Phase 跑全测 + 跨轮 restore 测试**。
>
> 📦 **2026-08-03 核对收尾**:Phase A 全部完成并随 2.21.0 发布(selftest 1030→1055 / e2e 263 / browser 全绿);
> Phase B(messages 结构共享)按 proposal 决策 3 **有意延后**(正确性优先,留未来评估);性能 bench 为可选项未做。
> **本 change 实质完成,可归档。**

## Phase A — vfs 脏标记(最大头 8MB,省最多)
- [x] `backends/vfs.ts`:VfsStore 加内部 `_dirty:boolean`;`set`/`delete`/`clear`/`hydrate`/`flush` 等所有写路径置 `_dirty=true`;导出 `consumeDirty():boolean`(读后清) + `isDirty():boolean`
  - ✅ vfs.ts L130/L132/L158/L167/L176/L177/L184/L197:Proxy set/delete 统一置脏(零遗漏覆盖所有工具写)+ hydrate/clear 手动置脏 + consumeDirty/isDirty 导出
- [x] `harness/checkpoint.ts` save:`const vfsChanged = vfsStore.consumeDirty(); const vfs = vfsChanged ? clone(files) : lastVfsClone; if (vfsChanged) lastVfsClone = vfs`(闭包缓存 lastVfsClone)
  - ✅ checkpoint.ts L163-165:consumeDirty 读后清 + 缓存空/脏才 clone(L144 `lastVfsClone` 闭包)
- [x] `harness/checkpoint.ts` restore:不变(用快照内 vfs clone,clone 是独立的,复用安全因 vfs 未变时 clone 仍代表当前)
  - ✅ checkpoint.ts L209:`Object.assign(files, clone(cp.vfs))` —— restore 用快照内独立 clone
- [x] **正确性测试**(sec-17 扩展):连续 save(无 vfs 写)→ 多个 checkpoint 共用同一 vfsClone 引用;写 vfs 后 save → 新 clone;restore 到任一 → vfs 正确(vfs 未变轮引用同对象 ≠ 错,因内容一致)
  - ✅ sec-17.ts L206-233(vfs 脏标记增量段):无 vfs 写复用 clone 引用 / 写后新 clone / restore 共享安全
- [x] 边界:summarization/clearStorage 清 vfs 后 consumeDirty 行为;importStack 后 lastVfsClone 重置
  - ✅ vfs.ts L184(hydrate)/L197(clear)置脏 + checkpoint.ts L214-215(restore)/L226-227(importStack)重置 lastVfsClone

## Phase A — bind 脏标记
- [x] `tools/dataOps.ts`:DataOpsController 加 `_dataDirty:boolean`;`set/edit/delete/restore_data/draft_commit/importData` 写路径置脏;导出 `consumeDataDirty()`
  - ✅ dataOps.ts L223-235:`_dataDirty`/`markDataDirty`/`consumeDataDirty`;写点清单注释(L225-226)+ 全写路径标脏:commitSetToBind onWrite(L317/L779/L886)/edit(L355/L559/L572/L766)/delete(L395/L593/L751)/restore(L443)/controller.set·update(L232-233)
- [x] `harness/checkpoint.ts` save:`const bindChanged = dataOpsController?.consumeDataDirty() ?? true; windowVals[''] = bindChanged ? clone(getData()) : lastBindClone`(默认 true = 无 controller 时整体 clone,向后兼容)
  - ✅ checkpoint.ts L153-157:consumeDataDirty 读后清(无 controller 默认 true 向后兼容)+ 缓存空/脏才 clone(L145 `lastBindClone`)
- [x] **正确性测试**:bind 写后 save 新 clone;无写 save 复用;restore 还原正确
  - ✅ sec-17.ts L235-258(bind 脏标记段):set/edit/delete/write·dryRun·del/controller.set 各路径标脏,只读·dryRun 不标
- [x] 边界:`sdk.setData` 运行时替换 bind → 强制下次 save clone(重置 lastBindClone + 置脏);windowProps 旧模式(slotPaths)不增量(整体 clone)
  - ✅ dataOps controller.set·update 置 markDataDirty(L232-233)+ checkpoint.ts L159-160 slotPaths 整体 clone(向后兼容)

## Phase A — 验证
- [x] 全测绿:selftest(1030+)+ e2e(263)+ browser(complex-demo/nested checkpoint 场景)
  - ✅ 2.21.0 已发布,全测绿;CHANGELOG L32:selftest 1030→1055(sec-17 增量段)/ e2e 263 / browser(complex-demo/nested checkpoint 场景)
- [x] 跨轮 restore 一致性测试(写→save→写→save→restore(id1)→restore(id2)→数据正确)
  - ✅ sec-17.ts L260-299(跨轮 restore 一致性段):写→save→写→save→restore(id1/id2/id3)→bind/vfs 数据一致 + restore 后 save 基线重建(测试驱动发现并修复了 restore 不经脏标记的兜底)
- [ ] 性能对比(可选 bench):大 JSON(几百 K)vfs 长任务,save clone 次数下降
  - ⏸ **可选,未做**(proposal 标「可选 bench」;性能收益已由设计论证 + 测试覆盖正确性,bench 非门禁)

## Phase B — messages 结构共享(险,单独评估,可能不做)
- [ ] 评估 summarization splice 与快照 length 基线冲突 → 决定清栈 or 放弃 messages 增量
  - ⏸ **有意延后**(proposal 决策 3):MVP 先不做 messages 增量,正确性优先。checkpoint.ts L171 仍 `messages: clone(messages)` 整体 clone
- [ ] (若做)save 记 length 不 clone;restore truncate+push 增量;summarization 触发清栈
  - ⏸ 同上,留未来评估
- [ ] 极限测试:压缩后 restore / 多次压缩后 restore
  - ⏸ 同上

## 文档
- [x] CLAUDE.md 架构要点(checkpoint 段)补「脏标记增量」
  - ✅ CLAUDE.md L174「脏标记增量(checkpoint-incremental-snapshot)」详段(vfs Proxy 置脏 + dataOps onWrite 收敛 + restore/importStack 重置基线 + Phase B 单独评估)
- [x] CHANGELOG
  - ✅ CHANGELOG.md L26(2.21.0 Performance 段 5 点详记)+ L32(selftest sec-17 增量断言明细)
