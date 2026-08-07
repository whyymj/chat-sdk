# Change: session-history-management(会话历史管理:对外暴露 API + checkpoint 切会话残留修复)

> 状态:proposal(未实施)。让集成方能实现「新建会话 + 多历史切换」侧边栏:补齐对外会话管理 API + 修 switchSession/onClear 的 checkpoint 栈残留(P1-5 同类)。
> 关联:`2026-08-03-arch-review-p1-fixes`(P1-5 已修 mission/workingMemory 切会话残留,本 change 延续同模式修 checkpoint + 暴露会话能力)。

## Why

集成方要做「多历史切换」时撞上的真实缺口(均有代码行号证据):

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| S1 | **checkpoint 栈切会话/清空残留** | switchSession 切新建会话时 applySnapshot 的 importStack 受 `snap.checkpoints?.length` 门禁(`createChatSdk.ts:1044`),目标 snap 无 checkpoint 则不调 → 旧栈残留;onClear(`:1615`)无任何 checkpoint 重置 | 开了 `checkpoint:true` 的集成方,切新会话/清空后 `restoreLastCheckpoint` 或 LLM `restore_last_checkpoint` 回退到**旧会话**的 messages+bind+vfs+todos → 跨会话污染(比 P1-5 的 pin 段污染更严重:整体替换,破坏性) |
| S2 | **listSessions 未对外暴露** | store 有 `listSessions(agentId): SessionMeta[]`(`storage.ts:96`),createChatSdk return(`:1736`)只暴露 switchSession | 集成方拿不到历史会话列表 → 无法做侧边栏;自己用 localStorage 记 id 与 store 内部 LRU 淘汰不同步 |
| S3 | **deleteSession 未对外暴露** | store 有 `deleteSession`(`storage.ts:100`),未暴露 | 集成方删不了历史会话(只能 `switchSession` 切换,无法清理) |
| S4 | **当前 sessionId 无法读取** | switchSession 返回新 id,但初始 mount 后 / onClear 新建后集成方拿不到当前会话 id;`core.sessionId`(`:491`)存在但 return 对象未暴露 | 侧边栏无法高亮当前会话;headless 集成方无法定位「现在在哪个会话」 |
| S5 | **onClear 新建会话不发事件** | switchSession 经 sdk-events 发 `session_restored`(`:1191`);onClear(`:1615`)不经 switchSession,无任何事件 | 集成方不知道用户点了「清空」新建会话,侧边栏列表与实际不同步(漏掉刚建的新会话) |

### 会话级状态重置完整性审计(Phase 1 前置,已初步确认)

switchSession/onClear 当前重置序列:messages / vfs / todos / memory / mission / workingMemory / debugLogs。系统审计其余中间件会话级闭包状态:

| 中间件 | 闭包状态 | 切会话是否需重置 |
|---|---|---|
| checkpoint | `stack[]` + `lastVfsClone/lastBindClone` + `nextId` | ❌ **缺(S1)** —— 唯一确认残留 |
| skills | `contentCache`(skill 全文) | ✅ 不重置(注释明确「跨轮跨会话复用」,技能定义跨会话有效) |
| permissions | `let r = ''`(局部格式化) | ✅ 无会话级状态 |
| summarization | 无独立闭包(状态在 messages) | ✅ 清 messages 即可 |
| subagent | 无会话状态 | ✅ 无需 |
| verify | `let lastUser/lastReply`(createWriteBackCheck 内,疑似跨轮去重) | ⚠️ 待 task 确认(verify 默认关,低优) |

→ **checkpoint 是唯一确认的残留**;verify 的 lastUser/lastReply 作为附带确认项(verify 默认关,即使有也是单轮去重,风险低)。

## What Changes

### Phase 1:checkpoint 切会话残留修复(S1,纯 bug 修复,无争议)
- `switchSession` + `onClear`:`if (checkpointMgr) checkpointMgr.importStack([])`(importStack 是替换语义 `stack.length=0`,传空数组 = 清栈 + 重置 `lastVfsClone/lastBindClone` 增量基线,与 mission/workingMemory reset 同模式)。
- 附带确认 verify lastUser/lastReply 是否需重置(预期不需,record 决策)。

### Phase 2:会话管理 API 对外暴露(S2/S3/S4)
- createChatSdk return 增:
  - `listSessions(): Promise<SessionMeta[]>` —— 封装 `store.listSessions(agentId)`,集成方无需感知 agentId 命名空间
  - `deleteSession(id): Promise<void>` —— 封装 `store.deleteSession`
  - `sessionId` —— getter(`get sessionId() { return core.sessionId }`,值拷贝会丢失实时性,必须 getter;inspect() 也补)
- storage 未开启时:listSessions 返回 `[]`、deleteSession no-op + warn(与 switchSession 抛错不同,查询类优雅降级)。

### Phase 3:会话切换事件(S5)
- onClear 新建会话后发 `session_restored`(携带新 sessionId + rounds:0),与 switchSession 对齐;复用现有事件类型不新增(降低集成方订阅成本)。

### Phase 4(决策点 → 见决策 3):title 编辑
- `renameSession(id, title)` —— SessionMeta 已有 title 字段,但创建后不可改;补 save title 路径(轻量)。

### Phase 5:❌ 评估后取消(data 共享而非隔离)
- **原假设**:会话级 data 独立(每会话存/恢复 data 快照),以为「新建会话不受旧影响」需要 data 隔离。
- **推翻(用户决策 2026-08-06)**:data 是**单一真相,所有会话共享最新值**(不要各备份)。这**正是 SDK 当前行为**(bind 实例级共享),无需改动 —— 新建会话也基于最新 data 继续,不恢复初始。
- **真正的「避免冲突」= 写操作互斥,不是 data 隔离**:单实例同一时刻只有一个活动会话,并发风险只在「A 生成中切 B」。解法是 **P1-2 send/switchSession/batch 串行化**(已在 `arch-review-p1-fixes` 落地,`createSerialRunner`),不是 data 备份/细粒度锁。
- 结论:Phase 5 不实施。**data 共享(现状)+ P1-2 串行化 = 正确模型**。本段保留决策推理,防后续重提。

## Impact

- **测试**:
  - S1:selftest checkpoint `importStack([])` 清栈白盒;e2e switchSession(新建)后 `restoreLastCheckpoint()` false + `list_checkpoints` 空
  - S2-S4:e2e `listSessions` 返回含已建会话 / `deleteSession` 后列表减少 / `sessionId` 反映当前(切换后更新)
  - S5:e2e onClear 后 hook 收到 `session_restored` + sessionId 正确
  - S4:e2e `renameSession` 后 listSessions 的 title 更新(若纳入)
- **行为变化**:S1 收紧(切会话不再跨会话污染,修正);S2-S4 新增 API(向后兼容);S5 新增事件(向后兼容)。
- **向后兼容**:全部为新增 API + bug 修正,无破坏性签名变更(新增 return 方法/getter)。

## 决策

1. **内置 ChatDialog 会话侧边栏延后**(独立 change):ChatDialog 已复杂(mission/冲突/skill 面板/抽屉),内置会话侧边栏 UI 是独立大改。本 change Phase 1-3 给 API + 事件,集成方能自建侧边栏;提供 `examples/session-history-demo` 示范。内置侧边栏单开 change 评估。
2. **sessionId 用 getter 不用 ref**:`get sessionId() { return core.sessionId }` 保持框架无关(Vue/reactive 由 core.sessionId 内部保证);切换通知走事件(session_restored),不引入响应式 ref(与现有 onEvent/hook 模式一致)。
3. **title 编辑纳入 Phase 4**:SessionMeta 已有 title,补 save 路径轻量;但优先级低于 S1-S5(核心是能列/能切/能删),作为收尾可选项,实现压力大可推后单独 PR。
4. **查询类 API 优雅降级**:listSessions/deleteSession 在 storage 未开启时不抛错(返回 []/no-op + warn),区别于 switchSession(写操作抛错)—— 查询不该炸。

## Non-goals

- 不做内置 ChatDialog 会话侧边栏 UI(决策 1,独立 change)。
- 不做多 agentId 跨 agent 会话聚合(本 agentId 内;跨 agent 非本 SDK 职责)。
- 不改会话存储后端实现(vfs 三池 / LRU 淘汰等不变,仅对外暴露)。
- 不重命名/重组现有 session_restored 事件(复用,不破坏订阅方)。
