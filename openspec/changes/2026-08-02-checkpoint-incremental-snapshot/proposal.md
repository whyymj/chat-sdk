# Change: checkpoint-incremental-snapshot (P1 perf)

> checkpoint save 从「每轮整体深 clone bind+messages+vfs」改为「脏标记增量」:未变部分复用上次快照,省 80%+ clone。
> **来源**:4 agent 交叉审查 perf-security HIGH(checkpoint 每轮 clone vfs 8MB × maxCheckpoints 5)+ arch 认同。
> **状态:proposal(未实施)**。风险高(restore 正确性),需专项会话 + 充分测试。

## Why
checkpoint 是会话级回退核心(restore_last_checkpoint / 异常回退 / automation send 错误恢复 / UI 一键回退 全依赖)。当前 `save()`(checkpoint.ts:136)每轮 beforeModel 首次触发,**无脑整体深 clone** 4 样:
- `clone(getData())` bind 主数据(几百 K ~ 数 MB)
- `clone(messages)` 对话历史(累积增长)
- `clone(vfsStore.files)` 虚拟文件系统(**默认 8MB**)
- `clone(todos)`

大 JSON 场景(complex-demo 70 组件 / huge 800 组件 / 几百 K)**每轮数十 MB clone**,长任务几十轮累积;structuredClone 几百 K 单次 50-200ms。**而大多数轮次 vfs/bind 根本没变**(agent 只 read / 局部 patch),clone 是纯浪费。

## What Changes
1. **vfs 脏标记**:`VfsStore` 加内部 `_dirty: boolean`;所有写路径(`set`/`delete`/`clear`/`hydrate`)置 `_dirty=true`。暴露 `consumeDirty(): boolean`(读后清) + 只读 `isDirty()`
2. **checkpoint save vfs 增量**:save 时 `if (vfsStore.consumeDirty()) vfsClone = clone(files) + 缓存;else 复用上次 vfsClone`。bind 同理(dataOps controller 暴露 `consumeDataDirty()`,set/edit/delete/restore/draft_commit/importData 置脏)
3. **messages 结构共享**:save 时只记 `length`(不整体 clone);restore 时 `messages.splice(length)` truncate + 从快照 push 增量(本轮 user + assistant)。**注意**:summarization 压缩 splice messages 时,需同步更新已存快照的 length 基线(或快照存 messages 引用快照,压缩时 invalidate)
4. **todos**:体积小,保持整体 clone(优化收益低,保留简单 + 正确)

## Impact
- **改造**:`backends/vfs.ts`(VfsStore 加 _dirty + 写路径置脏 + consumeDirty)、`harness/checkpoint.ts`(save 用脏标记复用 + messages 结构共享 + restore 适配)、`tools/dataOps.ts`(controller 加 consumeDataDirty + 写路径置脏)、`sdk/createChatSdk.ts`(dataOps controller 透传 checkpoint)
- **风险(高)**:restore 正确性。若脏标记漏置(某写路径没标)或复用了被后续 mutate 的引用 → restore 还原错误状态 → **静默数据错乱**(比性能问题严重)。必须:① 摸清**所有** vfs/bind 写路径标脏 ② messages 结构共享时 summarization 压缩的基线同步 ③ 补足跨轮 restore 一致性测试
- **性能基准**:加 `tests/perf/checkpoint-clone.bench.ts`(可选)对比 before/after clone 次数 + 耗时(大 JSON 长任务)
- **向后兼容**:对外 API 零变(save/restore/canRestore 不变);纯内部优化

## 决策
1. **脏标记方案(非 hash 比对)**:vfs 是 reactive mutate 对象,hash(JSON.stringify)与 clone 同 O(size),不省。必须脏标记(write 时置位,save 时检查)。代价:每条写路径记得置脏(漏置 = bug)
2. **bind 脏标记经 dataOps controller**:bind 写只经 set/edit/delete/restore/draft_commit/importData(全在 dataOps),controller 统一置脏最稳(不漏)。windowProps 旧模式(slotPaths)暂不增量(用整体 clone,向后兼容)
3. **messages 结构共享最险**:summarization 在 afterModel splice messages(压缩)→ 已存快照的 length 基线失效。方案:summarization 触发时,**清空 checkpoint 栈**(压缩后历史已变,旧快照基线无意义;压缩本身是兜底,清栈可接受)或快照存 messages 的深 clone(回退整体 clone,放弃 messages 增量)。**MVP 先不做 messages 增量**(只做 vfs + bind 脏标记,省大头),messages 保持整体 clone(正确性优先)
4. **分阶段**:Phase A vfs 脏标记(最大头 8MB,省最多)+ bind 脏标记;Phase B messages 结构共享(险,单独评估)

## Non-goals
- 不做 checkpoint 跨会话持久化(断点续跑 SessionSnapshot.checkpoints 已做,本 change 只优化内存 save 性能)
- 不做 checkpoint 压缩(快照本身不压缩,只省 clone 次数)
- MVP 不做 messages 结构共享(见决策 3,险,留 Phase B)
