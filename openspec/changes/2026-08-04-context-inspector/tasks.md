# Tasks: context-inspector(上下文查看面板)

> 关联 `proposal.md`。独立 change。用户拍板:DebugDrawer 新 tab + 常驻进度条 / beforeModel 真实快照 / 细分类。

## 1. 纯函数 `analyzeContext` + 类型
- [ ] 新建 `src/core/utils/contextAnalysis.ts`:`analyzeContext(messages, opts) → ContextSnapshot`(纯函数,**输入 BaseMessage[]**)
- [ ] `ContextCategory`/`ContextSnapshot`/`analyzeContext` 类型定义,导出(与 `describeSchemaNode` 同层的纯函数导出)
- [ ] 分类切分:遍历**全部** system 消息(含多条),按 `\n\n` 分隔 → 标记**前缀**匹配(## 可操作数据/## 能力使用提示/## 当前主线目标/## 工作记忆/【更早对话摘要】/【对话历史摘要】/【相关早期对话】);未匹配归 systemPrompt 桶
- [ ] 对话分类:最新 user → current,其余 user → history;assistant 无 tool_calls → 回复;ToolMessage → 工具结果;AIMessage.tool_calls.args → 工具参数
- [ ] token 估算:`estimateTokens`(复用 `modelCaps.ts`);toolResults 计入 content + tool_calls.args
- [ ] `occupancy`/`thresholdRatio`/`categories.pct` 计算
- [ ] selftest(新模块 sec-NN.ts 或并入现有):分类切分正确/标记识别(前缀)/兜底 systemPrompt/估算含 args/占比合计≈100%/多 system 消息

## 2. 快照中间件 `context-inspector`
- [ ] 新建 `src/core/harness/contextInspector.ts`:`createContextInspectorMiddleware(getContextWindow, thresholdRatio)`
- [ ] **`wrapModelCall`** 写 `state.contextSnapshot = analyzeContext(req.messages, opts)`(每轮覆盖;req.messages 是 replaceSystem + trim 后的最终消息)
- [ ] `HarnessState` 增 `contextSnapshot?: ContextSnapshot` 字段
- [ ] `capabilities.contextInspector`(默认开)注册进 `capabilities.ts`;关 → 不装中间件
- [ ] `createChatSdk` 装配:`contextWindow`(modelCaps)+ `thresholdRatio`(resolveContextOptions)传入;装载序经 `MIDDLEWARE_PRIORITY` 数值 priority 或自然尾随
- [ ] selftest:wrapModelCall 快照写入(含 replaceSystem 后 system 段)/关 capability 不采集/快照每轮覆盖

## 3. 压缩统计引用(复用现有 lastCompression)
- [ ] `context.compression` 直接取 `core.agent.getState().lastCompression`(已存在,不新增写入路径)
- [ ] selftest:压缩触发后 snapshot.compression 反映 lastCompression/未触发 undefined

## 4. SDK API
- [ ] `createChatSdk` 返回对象增 `inspectContext(): ContextSnapshot | undefined`
- [ ] `inspect()` 的 AgentInfo 增 `context?: ContextSnapshot`
- [ ] `capabilities.contextInspector:false` → `inspectContext()` undefined + `inspect().context` undefined
- [ ] e2e(events.mjs 或新模块):`inspectContext()` 返回 + `inspect().context` 反映 + 关 capability 后 undefined

## 5. ChatDialog 常驻进度条
- [ ] ChatDialog 加 `context` prop;header 下渲染「📊」占用进度条(occupancy% + 总 token)
- [ ] 色阶绿(occupancy < 阈值)/黄(≥阈值)/红(≥1);悬停 tooltip 总 token/窗口/最近压缩 strategy
- [ ] `capabilities.contextInspector:false` 时不显示
- [ ] **注:拆分完成(`chatdialog-component-split`)后,此区块挪 `#context` slot;当前先内置 prop 版**

## 6. DebugDrawer「📊 上下文」tab
- [ ] DebugDrawer 加 `context` 信息获取(tab 列表增 context,同 trace/info 条件显示)
- [ ] 面板:总览进度条(occupancy%/阈值线)+ 分类横向 bar(按 tokens 降序)+ 压缩信息(roundsTotal/Summarized/Recalled/strategy)+ usage 累计(prompt/completion/total)
- [ ] browser:进度条渲染 + DebugDrawer 上下文 tab 分类展示(spec 断言计数更新)

## 7. 文档
- [ ] `doc/usage-guide.md` 补「上下文查看面板」小节:`inspectContext()` + 进度条/tab 说明 + capabilities 开关
- [ ] README 中英补能力 + 用法片段
- [ ] CLAUDE.md 架构要点补 context-inspector 中间件 + 分类标记约定(改 augmentPrompt header 需同步 contextAnalysis)

## 8. 全量回归 + 收尾
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:context-inspector 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
