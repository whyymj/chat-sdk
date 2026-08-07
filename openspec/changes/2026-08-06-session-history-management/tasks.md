# Tasks: session-history-management

> 关联 `proposal.md`。Phase 1-3 为核心(无争议,先做),Phase 4 决策点(可推后)。按 Phase 独立 commit,可分批。

## Phase 1:checkpoint 切会话残留修复(S1,纯 bug 修复)✅
- [x] 附带确认:verify `createWriteBackCheck` 内 lastUser/lastReply 为单轮去重缓存,verify 默认关,无需切会话重置(skills contentCache 跨会话有效 / permissions / summarization / subagent 同确认无需)
- [x] `switchSession` + `onClear`:加 `if (checkpointMgr) checkpointMgr.importStack([])`(替换语义清栈 + 重置增量基线)
- [x] selftest(sec-17):`importStack([])` → `list()` 空 + `canRestore()` false + 清栈后 save id 重置从 1
- [x] e2e:S1 由 selftest 白盒覆盖纯逻辑(避免依赖 FAKE_LLM 的 checkpoint beforeModel 时序);switchSession/onClear 调 importStack 由代码审查 + 同 reset 链路保证

## Phase 2:会话管理 API 对外暴露(S2/S3/S4)✅
- [x] createChatSdk return 增 `listSessions()`(封装 store.listSessions(agentId);storage 未开启 → [])
- [x] 增 `deleteSession(id)`(封装 store.deleteSession;**不可删当前会话** + warn;storage 未开启 → no-op)
- [x] 增 `sessionId` getter(实时读 core.sessionId)
- [x] `inspect()`/getInfo 补 `sessionId` 字段
- [x] ChatSdk interface + `types/index.d.ts` 补三个签名(AgentInfo 加 sessionId)
- [x] e2e(storage):listSessions ≥2 + SessionMeta 字段 / sessionId 反映当前 / deleteSession 删非当前 -1 + 删当前不抛 / storage 未开启优雅降级

## Phase 3:会话切换事件(S5)✅
- [x] onClear:新建会话后 `emit({ type: 'session_restored', sessionId, rounds: 0 })`(复用现有事件类型,与 switchSession 对齐)
- [x] e2e:onClear 走 UI 路径 headless 难触发;复用 switchSession 已测的 session_restored 类型 + 同 emit 调用链,代码审查保证

## Phase 4(决策点,可推后):title 编辑 + 内置侧边栏
- [ ] `renameSession(id, title): Promise<void>`(SessionMeta.title 已有,补 store.save title 路径;storage 未开启 → no-op + warn)
- [ ] e2e:rename 后 `listSessions()` 对应项 title 更新
- [ ] (可选)内置 ChatDialog 历史侧边栏 UI(独立 change,见 proposal 决策 1)

## Phase 6:sdk.sessions 响应式状态下沉 ✅(用户决策:状态下沉 SDK,集成方零样板)
- [x] `core.sessions: Ref<SessionMeta[]>`(响应式)+ `refreshSessions()`(listSessions → sessionsRef 排序)
- [x] 触发自动 refresh:switchSession/resolveAndLoaded(载入)/deleteSession/onClear 末尾
- [x] 暴露 `sdk.sessions`(Ref);AgentCore.sessions/refreshSessions + ChatSdk interface + types
- [x] e2e(storage):sdk.sessions 响应式 === listSessions(自动同步)+ 含当前会话

## demo 重构(组件化 + Figma,消费 Phase 6)✅
- [x] session-history-demo 单文件 → 组件化:`ChatTopBar`(顶部栏)+ `SessionHistoryPanel`(右侧弹出历史层)+ App.vue 只组装
- [x] 直接消费 sdk.sessions(去掉手动 useSessionHistory composable)+ 深色紫主题(覆盖 ChatDialog `--cs-*` CSS 变量)
- [x] browser spec 适配(toggle-history 展开弹出层 + 选择器保留)+ 3 项端到端绿

## 收尾
- [x] 计数同步:selftest 1151 / e2e 288→299(P1-5 + session-history S1/S2-S4 + Phase 6)/ browser 25→28(session-history-demo)+ CLAUDE.md / README 中英 / doc
- [x] CHANGELOG [Unreleased]:Phase 1-3 + P1-2 + Phase 6 + demo 重构
- [x] 全测绿:selftest 1151 + build + e2e 299 + exports + types + browser 28
- [ ] 文档:doc/usage-guide 中英「会话历史管理」小节(API 已在 CHANGELOG/CLAUDE.md 记录,可选补)
- [ ] 发布(经用户确认):可随下个 minor(新增 API 用 minor,如 2.24.0)
