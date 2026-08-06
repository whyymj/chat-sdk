# Tasks: chatdialog-component-split(ChatDialog 拆分成可拼装/可替换的原子组件库)

> 关联 `proposal.md`。独立 change,一次性全拆 + 示例 demo。每步独立验证(基线:`npm test` + `npm run test:types` + `npm run test:exports` + `npm run test:browser` 每步全绿)。

## 1. 建 `chatContext.ts`(纯新增,零组件改动)
- [ ] 定义 `chatContextKey: InjectionKey<ChatContext>` + `ChatContext` 类型 + `createChatContext(opts)` 工厂
- [ ] `createChatContext` 内部复用 `useChat`(跑一次拿 16 项),创建容器级 UI 状态:`isExpanded`/`toggleCollapse`/`debugVisible`/`openDebug`/`closeDebug`/`skillVisible`/`openSkill`/`closeSkill`/`inputText`/`send`/`keydown`/`canUndo`/`undo`/`summary`/`copyMessage`/`copiedMsg`
- [ ] 验证:`npm run test:types`

## 2. 抽 message 子原子(MessageTime/Actions/Reasoning/Steps/Bubble + MessageRow)
- [ ] `message/MessageTime.vue`:template + `.message-time` style 整段搬入,props `{ timestamp }`
- [ ] `message/MessageActions.vue`:template + `.msg-actions`/`.msg-action-btn` style 搬入,props `{ copied }`,emit `copy`/`regenerate`
- [ ] `message/MessageReasoning.vue`:`.reasoning-block` 相关 style 搬入,props `{ text, expanded }`,emit `toggle`
- [ ] `message/MessageSteps.vue`:`.steps-block`/`.step-*` 相关 style 搬入;`groupedSteps`/`stepStatusIcon`/`groupStatusIcon` 逻辑迁入,props `{ steps }`
- [ ] `message/MessageBubble.vue`:`.message-bubble`/`.typing`/`.stream-cursor` 相关 style 搬入,props `{ content, role, isPendingAssistant, showTyping }`(assistant 渲染 MessageContent,user 纯文本,typing 三点)
- [ ] `message/MessageRow.vue`:`.message-row`/`.message-avatar`/`.message-content` style 搬入,组装 5 子件;props `{ message, index, showAvatar, showTyping, isPendingAssistant, reasoningExpanded, copied }`,emit `toggle-reasoning`/`copy`/`regenerate`
- [ ] **关键:每个类名原样保留,style 随 DOM 归属走**;`.message-row.assistant:hover .msg-actions` 跨边界用 `:deep()`
- [ ] 验证:`npm run test:browser`(message-row 相关:nested-demo message-row 计数 / page-demo)

## 3. 抽 `MessageList`(chat-body)
- [ ] 空态 `.empty-state` + `v-for MessageRow` + loading 占位行 + `.error-bar`(重试/回退)搬入
- [ ] `reasoningExpanded`(Record<number,boolean>)/`isPendingAssistant`/`isReasoningExpanded`/`toggleReasoning` 迁入
- [ ] `scrollContainer` ref + `onScroll`/`onWheel` 绑 MessageList 根;`copiedMsg`/`copyMessage` 走 ctx
- [ ] ctx 注入 `retry`/`regenerate`/`canUndo`/`undo`/`formatTime`
- [ ] 验证:`npm run test:browser`(nested-demo message-row 计数 / error-recovery 回复含「正确」)

## 4. 抽 `ChatHeader`
- [ ] `.chat-header`/`.header-*`/`.action-btn`/`.debug-badge`/`.status-dot` style 搬入
- [ ] debug/skill 打开改走 `ctx.openDebug`/`ctx.openSkill`;清空走 `ctx.chat.clearMessages`;折叠走 `ctx.toggleCollapse`;close 走 `ctx.close`
- [ ] props `{ title, drawer, skillAvailable, debugLogs? }`
- [ ] 验证:`_helpers.clearChat`(`button[title="清空对话"]`)全绿 + page-demo

## 5. 抽 `ChatInput`(chat-footer)
- [ ] `.chat-footer`/`.chat-input`/`.send-btn`/`.stop-btn`/`.cap-badge`/`.undo-foot-btn` style 搬入
- [ ] `inputText`/`handleSend`/`handleKeydown` 提升进 `createChatContext`;`v-model="ctx.inputText"`
- [ ] props `{ placeholder, inputRows }`;loading/stop/summary/canUndo/undo 走 ctx
- [ ] **关键:QueuedBar「修改」写 `ctx.inputText`,必须绑同一 ref 对象**(createChatContext 创建一次,原子组件 inject 解构)
- [ ] 验证:`queue.spec`(`.chat-dialog textarea` + Enter + `.stop-btn`)+ `nested-demo`(`button.undo-foot-btn`)

## 6. 抽 `QueuedBar`/`ApprovalBar`/`ConflictBar`
- [ ] `QueuedBar`:`.queued-bar`/`.queued-*` style 搬入,零 props,用 ctx.chat.queuedTasks/removeQueuedTask/`editQueued`(写回 ctx.inputText)
- [ ] `ApprovalBar`:`.approval-bar`/`.approval-*` style 搬入,零 props,自持 `approvalArgsExpanded`;自算 `isHumanConfirm`/`approvalOptions`/`approvalArgsPreview`;ctx.chat.resolveApproval 收口
- [ ] `ConflictBar`:**纯 props 零注入**,props `{ pendingConflict?, onResolve? }`,自持 `conflictExpanded`,自算 agent/current 预览
- [ ] 验证:`queue.spec`(`.queued-bar`/`.queued-text`/`.queued-count` + 修改填回输入框)+ `human-confirm-demo`(两层确认 + 允许/拒绝/选项)+ `nested-demo`(`.approval-bar` + 允许)
- [ ] 手动:drawer 模式点关闭/遮罩仍触发 sdk onClose(risk #4)

## 7. 加 `sections` + 具名 slot
- [ ] `ChatDialogProps` 加 `sections?: ChatDialogSections`;`renderSection(k) = sections[k] !== false`(默认全开,向后兼容)
- [ ] 8 具名 slot(`#header`/`#body`/`#queued`/`#approval`/`#conflict`/`#footer`/`#debug`/`#skill`)scoped slot 收 `{ chat }`;slot 非空渲染用户实现,空渲染内置原子
- [ ] ChatDialog.vue 重写为组合容器:25 props 原样 + provide(ctx) + 8 区块骨架
- [ ] 验证:既有 spec 全绿(默认路径行为不变)

## 8. 导出 + 类型
- [ ] `src/core/index.ts` 新增导出(chatContextKey/createChatContext/ChatContext + 7 原子组件),`MessageReasoning/Steps/Bubble/Actions/Time` + `DebugDrawer` 不导出
- [ ] `types/index.d.ts`:扩展 `ChatDialogProps`(补全 19 缺字段 + `sections?`)+ 新增 `ChatDialogSections` + 原子组件 `DefineComponent<any>` 声明
- [ ] `optionsResolver.ts` `DialogConfig` 加 `sections?`;mount 时透传
- [ ] 验证:`npm run test:exports` + `npm run test:types` + `npm run build`

## 9. 示例 demo
- [ ] 新增 `examples/custom-dialog-demo`(index.html + main.ts):sections 关某块(如关 queued)+ slot 替换某块(如自定义 #footer/#approval)+ L2 自建根组件拼原子(provide ctx + ChatInput/MessageList 自由拼)
- [ ] `_shared` DevNav 导航补链接;CLAUDE.md「目录结构」examples 清单补
- [ ] 新增 `tests/browser/custom-dialog.spec.ts`(sections 关区块 + slot 替换 + L2 自建,browser 计数 +3~4)
- [ ] 验证:`npm run test:browser` 全绿 + `npm run dev` 手测新 demo + page-demo 回归

## 10. 全量回归 + 收尾
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] 计数同步:CLAUDE.md / README 中英断言计数(browser e2e 25→28~29;CLAUDE.md 测试流程小节)
- [ ] CHANGELOG [Unreleased] 段:ChatDialog 拆分记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
