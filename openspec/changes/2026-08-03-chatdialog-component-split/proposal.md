# Change: chatdialog-component-split(ChatDialog 拆分成可拼装/可替换的原子组件库)

> 用户诉求(2026-08-03):「最好能将对话框拆分成 UI 组件,可以自己选择一部分功能自己拼装,又可以替换成自己实现的功能模块;如果当前组件需要重构,也可以直接设想规划一下」。
> **状态**:proposal(未实施)。独立 change,一次性全拆 + 配示例 demo,不与其他 P0/P1 修复捆绑。

## Why

`ChatDialog.vue`(785 行单文件)把 8 个功能区块揉在一起:header / 消息列表(含 message-row 内联 5 种子结构)/ 排队区 / 人工确认条 / 乐观锁冲突条 / 输入区 / 调试抽屉 / Skill 面板。当前定制路径只有三条,都不够:

| 现状路径 | 局限 |
|---|---|
| 覆盖 `--cs-*` CSS 变量换主题 | 只能换皮,不能换结构 |
| `showAvatar`/`showTyping`/`drawer`/`inputRows` 等 prop | 只能开关几个展示位,不能增删区块 |
| `ui:false` + 自建 UI | 从零重建整个对话框,内置 8 区块能力(确认条/冲突条/排队区/思考折叠)全要自己重写,复用不了 |

`useChat` 已是纯状态层(不耦合 DOM/样式,返回 state/sendMessage/stop/pendingApproval/queuedTasks 等 16 项),但 ChatDialog 只把它当内部实现,没有暴露给集成方拼装 —— **状态层已抽好,展示层整块是黑的**。

集成方真实诉求:**自定义消息气泡、换掉确认条的样式、关掉排队区、加自己的工具栏/面板** —— 现有一个都做不到,只能 `ui:false` 全重写。

## What Changes

把 ChatDialog 拆成分层可拼装的原子组件库,满足「可拼装 + 可替换」,不破坏现有测试契约。

### 架构:新增 `chatContext.ts` 作枢纽
- `chatContextKey: InjectionKey<ChatContext>`(provide/inject 注入)
- `createChatContext(opts)`:内部跑一次 `useChat(opts)` + 创建容器级 UI 状态(`isExpanded`/`debugVisible`/`skillVisible`/`inputText`/`copiedMsg`/`summary`/`canUndo` 等)
- **状态传递混合制**:`useChat` 实例 + 跨块 UI 状态走 provide/inject(被 5/7 区块共用,下钻会让容器 ~100 条 prop;slot 替换的 vnode 挂在 provider 子树下,与内置组件无差别注入同一份运行时);纯展示配置(title/placeholder/rows/头像)走 props

### 组件拆分(8 区块 + 6 消息子件)
```
src/core/composables/chatContext.ts   [新增] 枢纽
src/core/components/
  ChatDialog.vue          [重写] 组合容器:25 props 原样 + sections + 8 具名 slot + provide(ctx)
  ChatHeader.vue / MessageList.vue / QueuedBar.vue / ApprovalBar.vue / ConflictBar.vue / ChatInput.vue   [新增]
  message/MessageRow.vue + MessageReasoning/Steps/Bubble/Actions/Time.vue   [新增]
  MessageContent.vue / CodePreview.vue / DebugDrawer.vue / SkillPanel.vue   [不变]
```

### 两个替换层级(同一套机制)
- **L1 替换单个区块**:容器上 `#header`/`#body`/`#queued`/`#approval`/`#conflict`/`#footer`/`#debug`/`#skill` 具名 slot,scoped slot 收到 `{ chat }`(整个 ChatContext)
- **L2 替换整个对话框**:导出 `chatContextKey` + `createChatContext()` + 原子组件,集成方 `provide(chatContextKey, createChatContext(opts))` 后自由拼,零 prop 接线

### `sections` prop 与 slot 双机制
- `sections?: { header?, body?, queued?, approval?, conflict?, footer?, debug?, skill? }` 管「这块要不要」(默认全开,向后兼容)
- 具名 slot 管「这块换成谁的实现」(slot 非空 → 渲染用户实现,空 → 内置原子)
- 两者不冲突:sections[k]===false 连 slot 一起关;slot 提供的区块也要能被 sections 关掉

### 导出与类型(用户拍板:核心 8 个 + context)
- `src/core/index.ts` 新增导出:`chatContextKey`/`createChatContext`/`ChatContext` + `ChatHeader`/`MessageList`/`MessageRow`/`QueuedBar`/`ApprovalBar`/`ConflictBar`/`ChatInput`
- `MessageReasoning/Steps/Bubble/Actions/Time` + `DebugDrawer` 保持内部(消息实现细节;L2 自定义消息用 `#body` slot 或 `MessageRow` 够)
- `types/index.d.ts`:扩展 `ChatDialogProps`(补全 19 个缺字段 + `sections?`)+ 新增 `ChatDialogSections` + 原子组件 `DefineComponent<any>` 声明
- **⚠️ `tests/exports-consistency.mjs` 强制 src/core/index.ts 每个导出名在 types/index.d.ts 存在** —— 新增导出必须同步 d.ts,否则 `test:exports` 红

### `DialogConfig` 透传
- `optionsResolver.ts` 的 `DialogConfig` 加 `sections?`,mount 时透传给 ChatDialog(纯增量,向后兼容)
- 不引入「分段 props」(如 `headerProps`),保持 25 扁平 props 向后兼容;分段 props 留 v2 可选增强

## Impact

- **测试**:每步迁移用既有 spec 验证(类名/结构契约不破坏);新增 `tests/browser/custom-dialog.spec.ts`(sections 关区块 + slot 替换 + L2 自建根组件,新 demo 配套,浏览器 e2e 计数 +3~4);selftest/e2e 逻辑层不触及(纯 UI 重构)。导出名新增 → exports-consistency 自动要求 d.ts 同步。
- **行为变化**:默认路径(sections 全开 + 无 slot)行为与现在**完全一致**(向后兼容);仅新增可拼装/可替换能力,不改变默认渲染。`ChatDialogProps` 扩展是增量(补全字段,不破坏现有 7 字段)。
- **向后兼容**:ChatDialog 默认导出保留(createChatSdk 默认导入 + index.ts `default as` + dist 导出名 + d.ts 声明四层联动);25 props 原样留容器;根类名 `.chat-dialog` + 各原子组件复用原类名 → 浏览器 e2e 全绿。`--cs-*` 主题变量仍定义在 `.chat-dialog` 根,经 CSS 自定义属性跨组件边界天然继承。

## 决策

1. **状态传递混合制**:useChat 实例 + 跨块 UI 状态 provide/inject(可替换的死角是 slot 用户拿不到状态,必须注入);纯展示配置 props(调用点可见、可静态传入)。纯展示原子组件(ConflictBar)全 props 零注入,可单测可独立用。
2. **slot + sections 双机制**:关掉确认条是产品决策(`sections.approval:false`),换掉确认条是集成方定制(`#approval` slot),不可互相替代,两者都要。
3. **导出核心 8 个 + context**:消息内部子件与 DebugDrawer 保持内部 —— 导出面克制,types 维护成本低;L2 自定义消息用 `#body` slot 或 `MessageRow` 足够。
4. **scoped CSS 跨边界归属一致**:`.message-row.assistant:hover .msg-actions` 类「祖先+后代」选择器,拆分后后代在子组件不再带父 scope 属性 → 类名归属必须与 DOM 归属一致(谁渲染 `.msg-actions` 谁写规则),确需跨边界用 `:deep()`。
5. **drawer onClose 回退**:容器仍是多根 fragment,继续 `emit('close')`;抽屉模式点关闭/遮罩仍触发 sdk onClose(步骤 6 后手动验证)。

## Non-goals

- 不做 P0/P1 架构债修复(独立 change:`2026-08-03-fix-write-safety-bypass` + `2026-08-03-arch-review-p1-fixes`)。
- 不做「分段 props」收敛(`headerProps`/`inputProps` 对象)—— 保持 25 扁平 props 向后兼容,留 v2 可选增强。
- 不改 useChat 签名(纯状态层已够用,拆分只在展示层)。
- 不动 DebugDrawer/SkillPanel 内部(已独立组件,本次只是让 ChatDialog 用 slot 可替换它们)。
