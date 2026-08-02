# Tasks: checkpoint-incremental-snapshot (P1 perf)

> 关联 `proposal.md`。**风险高(restore 正确性),逐 Phase 推进,每 Phase 跑全测 + 跨轮 restore 测试**。

## Phase A — vfs 脏标记(最大头 8MB,省最多)
- [ ] `backends/vfs.ts`:VfsStore 加内部 `_dirty:boolean`;`set`/`delete`/`clear`/`hydrate`/`flush` 等所有写路径置 `_dirty=true`;导出 `consumeDirty():boolean`(读后清) + `isDirty():boolean`
- [ ] `harness/checkpoint.ts` save:`const vfsChanged = vfsStore.consumeDirty(); const vfs = vfsChanged ? clone(files) : lastVfsClone; if (vfsChanged) lastVfsClone = vfs`(闭包缓存 lastVfsClone)
- [ ] `harness/checkpoint.ts` restore:不变(用快照内 vfs clone,clone 是独立的,复用安全因 vfs 未变时 clone 仍代表当前)
- [ ] **正确性测试**(sec-17 扩展):连续 save(无 vfs 写)→ 多个 checkpoint 共用同一 vfsClone 引用;写 vfs 后 save → 新 clone;restore 到任一 → vfs 正确(vfs 未变轮引用同对象 ≠ 错,因内容一致)
- [ ] 边界:summarization/clearStorage 清 vfs 后 consumeDirty 行为;importStack 后 lastVfsClone 重置

## Phase A — bind 脏标记
- [ ] `tools/dataOps.ts`:DataOpsController 加 `_dataDirty:boolean`;`set/edit/delete/restore_data/draft_commit/importData` 写路径置脏;导出 `consumeDataDirty()`
- [ ] `harness/checkpoint.ts` save:`const bindChanged = dataOpsController?.consumeDataDirty() ?? true; windowVals[''] = bindChanged ? clone(getData()) : lastBindClone`(默认 true = 无 controller 时整体 clone,向后兼容)
- [ ] **正确性测试**:bind 写后 save 新 clone;无写 save 复用;restore 还原正确
- [ ] 边界:`sdk.setData` 运行时替换 bind → 强制下次 save clone(重置 lastBindClone + 置脏);windowProps 旧模式(slotPaths)不增量(整体 clone)

## Phase A — 验证
- [ ] 全测绿:selftest(1030+)+ e2e(263)+ browser(complex-demo/nested checkpoint 场景)
- [ ] 跨轮 restore 一致性测试(写→save→写→save→restore(id1)→restore(id2)→数据正确)
- [ ] 性能对比(可选 bench):大 JSON(几百 K)vfs 长任务,save clone 次数下降

## Phase B — messages 结构共享(险,单独评估,可能不做)
- [ ] 评估 summarization splice 与快照 length 基线冲突 → 决定清栈 or 放弃 messages 增量
- [ ] (若做)save 记 length 不 clone;restore truncate+push 增量;summarization 触发清栈
- [ ] 极限测试:压缩后 restore / 多次压缩后 restore

## 文档
- [ ] CLAUDE.md 架构要点(checkpoint 段)补「脏标记增量」
- [ ] CHANGELOG
